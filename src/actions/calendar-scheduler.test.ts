/**
 * Unit tests for the Calendar Scheduler.
 *
 * Tests scheduling logic, lead-day computation, 5-minute SLA, and batch scheduling.
 * Requirements: 7.5, 12.4, 15.7, 20.4
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CalendarScheduler } from "./calendar-scheduler";
import type { RenewalAlert } from "../types/outputs";
import type { TrialRecord } from "../types/models";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockRenewalAlert(overrides: Partial<RenewalAlert> = {}): RenewalAlert {
  return {
    id: "renewal-1",
    vendor: "Netflix",
    vendorDomain: "netflix.com",
    amount: 15.99,
    currency: "USD",
    renewalDate: new Date("2025-02-15"),
    daysUntilRenewal: 14,
    autoRenews: true,
    autoRenewalFlagged: false,
    applicableLeadTimeAlerts: [30, 7, 3, 1],
    billingFrequency: "monthly",
    category: "video-streaming",
    subscriptionId: "sub-1",
    ...overrides,
  };
}

function createMockTrial(overrides: Partial<TrialRecord> = {}): TrialRecord {
  return {
    id: "trial-1",
    vendor: "Figma",
    vendorDomain: "figma.com",
    category: "software-saas",
    trialStartDate: new Date("2025-01-01"),
    trialEndDate: new Date("2025-02-01"),
    daysRemaining: 14,
    convertsToAmount: 15,
    convertsToFrequency: "monthly",
    autoConverts: true,
    cancellationUrl: "https://figma.com/cancel",
    status: "active",
    reminderScheduled: false,
    sourceMessageId: "msg-1",
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CalendarScheduler", () => {
  let scheduler: CalendarScheduler;

  beforeEach(() => {
    scheduler = new CalendarScheduler();
  });

  describe("scheduleReminder", () => {
    it("should create a calendar event for a renewal alert", async () => {
      const alert = createMockRenewalAlert();
      const event = await scheduler.scheduleReminder(alert);

      expect(event.id).toBe("cal-renewal-renewal-1");
      expect(event.vendor).toBe("Netflix");
      expect(event.type).toBe("renewal_reminder");
      expect(event.title).toContain("Netflix");
      expect(event.title).toContain("renewal");
    });

    it("should include auto-renewal warning in description when flagged", async () => {
      const alert = createMockRenewalAlert({ autoRenewalFlagged: true });
      const event = await scheduler.scheduleReminder(alert);

      expect(event.description).toContain("Auto-renewal");
    });

    it("should set reminder minutes based on lead-time alerts", async () => {
      const alert = createMockRenewalAlert({
        applicableLeadTimeAlerts: [7, 3, 1],
      });
      const event = await scheduler.scheduleReminder(alert);

      // 7 days = 10080 min, 3 days = 4320 min, 1 day = 1440 min
      expect(event.reminderMinutesBefore).toContain(7 * 24 * 60);
      expect(event.reminderMinutesBefore).toContain(3 * 24 * 60);
      expect(event.reminderMinutesBefore).toContain(1 * 24 * 60);
    });

    it("should mark scheduledWithinDeadline true when created within 5 minutes of detection", async () => {
      const alert = createMockRenewalAlert();
      const detectionTime = new Date();
      scheduler.recordDetection(alert.id, detectionTime);

      const event = await scheduler.scheduleReminder(alert);

      expect(event.scheduledWithinDeadline).toBe(true);
    });

    it("should mark scheduledWithinDeadline false when created more than 5 minutes after detection", async () => {
      const alert = createMockRenewalAlert();
      // Detection was 10 minutes ago
      const detectionTime = new Date(Date.now() - 10 * 60 * 1000);
      scheduler.recordDetection(alert.id, detectionTime);

      const event = await scheduler.scheduleReminder(alert);

      expect(event.scheduledWithinDeadline).toBe(false);
    });

    it("should store the event for later retrieval", async () => {
      const alert = createMockRenewalAlert();
      await scheduler.scheduleReminder(alert);

      const events = scheduler.getScheduledEvents();
      expect(events.length).toBe(1);
      expect(events[0].vendor).toBe("Netflix");
    });
  });

  describe("scheduleTrialExpiryReminder", () => {
    it("should create a calendar event for a trial with default lead days (7, 3, 1)", async () => {
      const trial = createMockTrial({
        trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
        daysRemaining: 14,
      });

      const event = await scheduler.scheduleTrialExpiryReminder(trial);

      expect(event.id).toBe("cal-trial-trial-1");
      expect(event.vendor).toBe("Figma");
      expect(event.type).toBe("trial_expiry_reminder");
    });

    it("should use custom lead days when provided", async () => {
      const trial = createMockTrial({
        trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        daysRemaining: 14,
      });

      const event = await scheduler.scheduleTrialExpiryReminder(trial, [10, 5, 2]);

      // Reminder minutes should reflect custom lead days
      expect(event.reminderMinutesBefore).toContain(10 * 24 * 60);
      expect(event.reminderMinutesBefore).toContain(5 * 24 * 60);
      expect(event.reminderMinutesBefore).toContain(2 * 24 * 60);
    });

    it("should include auto-conversion info in title when trial auto-converts", async () => {
      const trial = createMockTrial({
        trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        autoConverts: true,
        convertsToAmount: 25,
        convertsToFrequency: "monthly",
      });

      const event = await scheduler.scheduleTrialExpiryReminder(trial);

      expect(event.title).toContain("auto-converts");
      expect(event.title).toContain("$25");
    });

    it("should include cancellation URL in description when available", async () => {
      const trial = createMockTrial({
        trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        cancellationUrl: "https://figma.com/cancel",
      });

      const event = await scheduler.scheduleTrialExpiryReminder(trial);

      expect(event.description).toContain("https://figma.com/cancel");
    });

    it("should mark scheduledWithinDeadline true when created promptly", async () => {
      const trial = createMockTrial({
        trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      });
      scheduler.recordDetection(trial.id, new Date());

      const event = await scheduler.scheduleTrialExpiryReminder(trial);

      expect(event.scheduledWithinDeadline).toBe(true);
    });
  });

  describe("scheduleBatchReminders", () => {
    it("should schedule all valid alerts in a batch", async () => {
      const alerts = [
        createMockRenewalAlert({ id: "r1", vendor: "Netflix" }),
        createMockRenewalAlert({ id: "r2", vendor: "Spotify" }),
        createMockRenewalAlert({ id: "r3", vendor: "GitHub" }),
      ];

      const result = await scheduler.scheduleBatchReminders(alerts);

      expect(result.totalScheduled).toBe(3);
      expect(result.totalFailed).toBe(0);
      expect(result.scheduled.length).toBe(3);
    });

    it("should report failures for alerts with missing data", async () => {
      const alerts = [
        createMockRenewalAlert({ id: "r1", vendor: "Netflix" }),
        createMockRenewalAlert({ id: "r2", vendor: "", renewalDate: undefined as any }),
      ];

      const result = await scheduler.scheduleBatchReminders(alerts);

      expect(result.totalScheduled).toBe(1);
      expect(result.totalFailed).toBe(1);
      expect(result.failed[0].reason).toContain("Missing required");
    });

    it("should return correct totals", async () => {
      const alerts = [
        createMockRenewalAlert({ id: "r1" }),
        createMockRenewalAlert({ id: "r2" }),
      ];

      const result = await scheduler.scheduleBatchReminders(alerts);

      expect(result.totalScheduled).toBe(result.scheduled.length);
      expect(result.totalFailed).toBe(result.failed.length);
    });
  });

  describe("getEvent", () => {
    it("should return a specific event by ID", async () => {
      const alert = createMockRenewalAlert({ id: "r1" });
      await scheduler.scheduleReminder(alert);

      const event = scheduler.getEvent("cal-renewal-r1");
      expect(event).toBeDefined();
      expect(event!.vendor).toBe("Netflix");
    });

    it("should return undefined for non-existent event", () => {
      const event = scheduler.getEvent("non-existent");
      expect(event).toBeUndefined();
    });
  });
});
