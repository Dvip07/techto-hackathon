/**
 * Unit tests for the Notification Engine.
 *
 * Tests notification dispatching, priority mapping, quiet hours, and creep alerts.
 * Requirements: 7.5, 12.4, 15.7, 20.4
 */

import { describe, it, expect, beforeEach } from "vitest";
import { NotificationEngine } from "./notification-engine";
import type { PrioritizedItem, CreepAlert } from "../types/outputs";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockPrioritizedItem(overrides: Partial<PrioritizedItem> = {}): PrioritizedItem {
  return {
    id: "item-1",
    featureArea: "renewals",
    title: "Netflix renewing in 3 days",
    description: "$15.99/monthly renewal (auto-renewal)",
    urgencyScore: 7,
    financialImpact: 191.88,
    suggestedActions: [
      { type: "set_reminder", label: "Set reminder", draftAvailable: false },
    ],
    relatedVendor: "Netflix",
    dueDate: new Date("2025-02-15"),
    createdAt: new Date(),
    ...overrides,
  };
}

function createMockCreepAlert(overrides: Partial<CreepAlert> = {}): CreepAlert {
  return {
    id: "creep-1",
    detectedAt: new Date(),
    periodMonths: 3,
    startingMonthlySpend: 87,
    currentMonthlySpend: 107,
    absoluteIncrease: 20,
    percentageIncrease: 23,
    newSubscriptionsAdded: [],
    priceIncreasesDetected: [],
    insight: "Your subscriptions grew 23% in 3 months — from $87 to $107/month",
    acknowledged: false,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("NotificationEngine", () => {
  let engine: NotificationEngine;

  beforeEach(() => {
    engine = new NotificationEngine();
  });

  describe("dispatchNotification", () => {
    it("should dispatch a notification for items meeting minimum urgency", async () => {
      const item = createMockPrioritizedItem({ urgencyScore: 7 });
      await engine.dispatchNotification(item);

      const notifications = engine.getAllNotifications();
      expect(notifications.length).toBe(1);
      expect(notifications[0].title).toBe("Netflix renewing in 3 days");
    });

    it("should NOT dispatch for items below minimum urgency threshold", async () => {
      const item = createMockPrioritizedItem({ urgencyScore: 3 });
      await engine.dispatchNotification(item);

      const notifications = engine.getAllNotifications();
      expect(notifications.length).toBe(0);
    });

    it("should map urgency 9-10 to critical priority", async () => {
      const item = createMockPrioritizedItem({ urgencyScore: 10 });
      await engine.dispatchNotification(item);

      const notifications = engine.getAllNotifications();
      expect(notifications[0].priority).toBe("critical");
    });

    it("should map urgency 7-8 to high priority", async () => {
      const item = createMockPrioritizedItem({ urgencyScore: 7 });
      await engine.dispatchNotification(item);

      const notifications = engine.getAllNotifications();
      expect(notifications[0].priority).toBe("high");
    });

    it("should map urgency 5-6 to medium priority", async () => {
      const item = createMockPrioritizedItem({ urgencyScore: 5 });
      await engine.dispatchNotification(item);

      const notifications = engine.getAllNotifications();
      expect(notifications[0].priority).toBe("medium");
    });

    it("should include vendor and financial impact in notification", async () => {
      const item = createMockPrioritizedItem({
        relatedVendor: "Spotify",
        financialImpact: 120,
      });
      await engine.dispatchNotification(item);

      const notifications = engine.getAllNotifications();
      expect(notifications[0].vendor).toBe("Spotify");
      expect(notifications[0].financialImpact).toBe(120);
    });

    it("should respect custom minimum urgency threshold", async () => {
      engine = new NotificationEngine({ minimumUrgencyScore: 8 });

      const item = createMockPrioritizedItem({ urgencyScore: 7 });
      await engine.dispatchNotification(item);

      expect(engine.getAllNotifications().length).toBe(0);
    });
  });

  describe("dispatchCreepAlert", () => {
    it("should dispatch a creep alert notification", async () => {
      const alert = createMockCreepAlert();
      await engine.dispatchCreepAlert(alert);

      const notifications = engine.getAllNotifications();
      expect(notifications.length).toBe(1);
      expect(notifications[0].title).toContain("Creep Alert");
      expect(notifications[0].priority).toBe("high");
    });

    it("should include spend growth details in body", async () => {
      const alert = createMockCreepAlert({
        startingMonthlySpend: 87,
        currentMonthlySpend: 107,
        percentageIncrease: 23,
      });
      await engine.dispatchCreepAlert(alert);

      const notifications = engine.getAllNotifications();
      expect(notifications[0].body).toContain("$87.00");
      expect(notifications[0].body).toContain("$107.00");
      expect(notifications[0].body).toContain("23.0%");
    });

    it("should NOT dispatch for acknowledged alerts", async () => {
      const alert = createMockCreepAlert({ acknowledged: true });
      await engine.dispatchCreepAlert(alert);

      expect(engine.getAllNotifications().length).toBe(0);
    });

    it("should NOT dispatch when creep alerts are disabled", async () => {
      engine = new NotificationEngine({ creepAlertEnabled: false });

      const alert = createMockCreepAlert();
      await engine.dispatchCreepAlert(alert);

      expect(engine.getAllNotifications().length).toBe(0);
    });

    it("should include new subscription vendors in body when present", async () => {
      const alert = createMockCreepAlert({
        newSubscriptionsAdded: [
          {
            id: "sub-1",
            vendor: "NewApp",
            vendorDomain: "newapp.com",
            amount: 10,
            currency: "USD",
            billingFrequency: "monthly",
            category: "software-saas",
            status: "active-used",
            usageScore: 5,
            wasteScore: 0,
            firstSeenDate: new Date(),
            lastPaymentDate: new Date(),
            nextRenewalDate: null,
            autoRenews: true,
            trialEndsDate: null,
            annualPlanAvailable: false,
            annualPlanAmount: null,
            annualSavingsIfSwitched: null,
            priceChangeHistory: [],
            sourceMessageIds: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });
      await engine.dispatchCreepAlert(alert);

      const notifications = engine.getAllNotifications();
      expect(notifications[0].body).toContain("NewApp");
    });
  });

  describe("markAsRead", () => {
    it("should mark a notification as read", async () => {
      const item = createMockPrioritizedItem({ urgencyScore: 7 });
      await engine.dispatchNotification(item);

      const notifications = engine.getAllNotifications();
      engine.markAsRead(notifications[0].id);

      const unread = engine.getUnreadNotifications();
      expect(unread.length).toBe(0);
    });
  });

  describe("dismiss", () => {
    it("should dismiss a notification", async () => {
      const item = createMockPrioritizedItem({ urgencyScore: 7 });
      await engine.dispatchNotification(item);

      const notifications = engine.getAllNotifications();
      engine.dismiss(notifications[0].id);

      const unread = engine.getUnreadNotifications();
      expect(unread.length).toBe(0);
    });
  });

  describe("getUnreadNotifications", () => {
    it("should return unread notifications sorted by priority", async () => {
      await engine.dispatchNotification(createMockPrioritizedItem({ id: "a", urgencyScore: 5 }));
      await engine.dispatchNotification(createMockPrioritizedItem({ id: "b", urgencyScore: 9 }));
      await engine.dispatchNotification(createMockPrioritizedItem({ id: "c", urgencyScore: 7 }));

      const unread = engine.getUnreadNotifications();
      expect(unread.length).toBe(3);
      expect(unread[0].priority).toBe("critical"); // urgency 9
      expect(unread[1].priority).toBe("high");     // urgency 7
      expect(unread[2].priority).toBe("medium");   // urgency 5
    });
  });

  describe("preferences", () => {
    it("should allow updating preferences", () => {
      engine.updatePreferences({ minimumUrgencyScore: 3 });
      const prefs = engine.getPreferences();
      expect(prefs.minimumUrgencyScore).toBe(3);
    });

    it("should use push channel for critical items when push is enabled", async () => {
      engine = new NotificationEngine({ enabledChannels: ["dashboard", "push"] });

      const item = createMockPrioritizedItem({ urgencyScore: 10 });
      await engine.dispatchNotification(item);

      const notifications = engine.getAllNotifications();
      expect(notifications[0].channel).toBe("push");
    });
  });
});
