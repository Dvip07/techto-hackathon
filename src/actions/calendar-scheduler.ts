/**
 * Calendar Scheduler — Action Engine component for scheduling reminders via Google Calendar MCP.
 *
 * Schedules renewal reminders, trial expiry countdown reminders, and batch reminders.
 * Simulates Google Calendar MCP integration (actual MCP connection wired later).
 *
 * Requirements: 7.5, 12.4, 15.7, 20.4
 */

import type { RenewalAlert } from "../types/outputs";
import type { TrialRecord } from "../types/models";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  startDate: Date;
  endDate: Date;
  reminderMinutesBefore: number[];
  vendor: string;
  type: "renewal_reminder" | "trial_expiry_reminder" | "obligation_deadline";
  createdAt: Date;
  scheduledWithinDeadline: boolean; // true if created within 5 minutes of detection
}

export interface ReminderScheduleResult {
  scheduled: CalendarEvent[];
  failed: FailedReminder[];
  totalScheduled: number;
  totalFailed: number;
}

export interface FailedReminder {
  alertId: string;
  vendor: string;
  reason: string;
}

// ─── Calendar Scheduler ──────────────────────────────────────────────────────

export class CalendarScheduler {
  private events: Map<string, CalendarEvent> = new Map();
  private detectionTimestamps: Map<string, Date> = new Map();

  /**
   * Records the detection time for a renewal or trial to verify the 5-minute SLA.
   *
   * Requirement 20.4: Create calendar reminder within 5 minutes of detection
   */
  recordDetection(alertId: string, detectedAt?: Date): void {
    this.detectionTimestamps.set(alertId, detectedAt ?? new Date());
  }

  /**
   * Schedules a single renewal reminder as a calendar event.
   *
   * Requirement 12.4: When a renewal or deadline is detected, create a calendar reminder
   *   within 5 minutes of detection
   * Requirement 20.4: Create the corresponding calendar reminder within 5 minutes of detection
   */
  async scheduleReminder(alert: RenewalAlert): Promise<CalendarEvent> {
    const now = new Date();
    const detectionTime = this.detectionTimestamps.get(alert.id) ?? now;

    // Compute reminder date: the day before renewal
    const reminderDate = new Date(alert.renewalDate);
    reminderDate.setDate(reminderDate.getDate() - 1);

    // If reminder date is in the past, schedule for today
    const startDate = reminderDate > now ? reminderDate : now;

    const event: CalendarEvent = {
      id: `cal-renewal-${alert.id}`,
      title: `${alert.vendor} renewal in ${alert.daysUntilRenewal} day${alert.daysUntilRenewal === 1 ? "" : "s"}`,
      description: this.buildRenewalDescription(alert),
      startDate,
      endDate: new Date(startDate.getTime() + 30 * 60 * 1000), // 30 min event
      reminderMinutesBefore: this.computeReminderMinutes(alert.applicableLeadTimeAlerts),
      vendor: alert.vendor,
      type: "renewal_reminder",
      createdAt: now,
      scheduledWithinDeadline: this.isWithinFiveMinutes(detectionTime, now),
    };

    this.events.set(event.id, event);
    return event;
  }

  /**
   * Schedules trial expiry reminders at configurable lead days (default: 7, 3, 1).
   *
   * Requirement 7.5: Schedule countdown reminders at configurable intervals
   *   defaulting to 7 days, 3 days, and 1 day before expiry
   * Requirement 12.4: Create calendar reminder within 5 minutes of detection
   */
  async scheduleTrialExpiryReminder(
    trial: TrialRecord,
    leadDays: number[] = [7, 3, 1]
  ): Promise<CalendarEvent> {
    const now = new Date();
    const detectionTime = this.detectionTimestamps.get(trial.id) ?? now;

    // Sort lead days descending so the earliest reminder is the event start
    const sortedLeadDays = [...leadDays].sort((a, b) => b - a);

    // The calendar event is set to the earliest applicable reminder date
    const earliestLeadDay = this.findEarliestApplicableLeadDay(trial, sortedLeadDays, now);
    const reminderDate = new Date(trial.trialEndDate);
    reminderDate.setDate(reminderDate.getDate() - earliestLeadDay);

    // If the earliest reminder date is in the past, use now
    const startDate = reminderDate > now ? reminderDate : now;

    const conversionInfo = trial.autoConverts && trial.convertsToAmount !== null
      ? ` — auto-converts to $${trial.convertsToAmount}/${trial.convertsToFrequency ?? "month"}`
      : "";

    const event: CalendarEvent = {
      id: `cal-trial-${trial.id}`,
      title: `${trial.vendor} trial expiring${conversionInfo}`,
      description: this.buildTrialDescription(trial, sortedLeadDays),
      startDate,
      endDate: new Date(startDate.getTime() + 30 * 60 * 1000),
      reminderMinutesBefore: sortedLeadDays.map((d) => d * 24 * 60), // Convert days to minutes
      vendor: trial.vendor,
      type: "trial_expiry_reminder",
      createdAt: now,
      scheduledWithinDeadline: this.isWithinFiveMinutes(detectionTime, now),
    };

    this.events.set(event.id, event);
    return event;
  }

  /**
   * Schedules reminders for a batch of renewal alerts.
   *
   * Requirement 12.4: Create calendar reminders within 5 minutes of detection
   */
  async scheduleBatchReminders(alerts: RenewalAlert[]): Promise<ReminderScheduleResult> {
    const scheduled: CalendarEvent[] = [];
    const failed: FailedReminder[] = [];

    for (const alert of alerts) {
      try {
        // Validate the alert has required data
        if (!alert.renewalDate || !alert.vendor) {
          failed.push({
            alertId: alert.id,
            vendor: alert.vendor ?? "unknown",
            reason: "Missing required renewal date or vendor",
          });
          continue;
        }

        const event = await this.scheduleReminder(alert);
        scheduled.push(event);
      } catch (error) {
        failed.push({
          alertId: alert.id,
          vendor: alert.vendor,
          reason: error instanceof Error ? error.message : "Unknown scheduling error",
        });
      }
    }

    return {
      scheduled,
      failed,
      totalScheduled: scheduled.length,
      totalFailed: failed.length,
    };
  }

  /**
   * Returns all scheduled events (for testing/inspection).
   */
  getScheduledEvents(): CalendarEvent[] {
    return Array.from(this.events.values());
  }

  /**
   * Returns a specific event by ID.
   */
  getEvent(eventId: string): CalendarEvent | undefined {
    return this.events.get(eventId);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Checks if the calendar event was created within 5 minutes of detection.
   *
   * Requirement 20.4: Create calendar reminder within 5 minutes of detection
   */
  private isWithinFiveMinutes(detectionTime: Date, creationTime: Date): boolean {
    const diffMs = creationTime.getTime() - detectionTime.getTime();
    return diffMs >= 0 && diffMs <= 5 * 60 * 1000; // 5 minutes in ms
  }

  /**
   * Finds the earliest lead day that is still in the future relative to now.
   */
  private findEarliestApplicableLeadDay(
    trial: TrialRecord,
    sortedLeadDays: number[],
    now: Date
  ): number {
    const trialEnd = trial.trialEndDate instanceof Date
      ? trial.trialEndDate
      : new Date(trial.trialEndDate);

    for (const leadDay of sortedLeadDays) {
      const reminderDate = new Date(trialEnd);
      reminderDate.setDate(reminderDate.getDate() - leadDay);
      if (reminderDate > now) {
        return leadDay;
      }
    }

    // If all lead days are in the past, use the smallest one
    return sortedLeadDays[sortedLeadDays.length - 1];
  }

  /**
   * Converts lead-time alert days to reminder minutes for calendar notifications.
   */
  private computeReminderMinutes(leadTimeAlerts: number[]): number[] {
    // Convert days to minutes for calendar reminder notifications
    return leadTimeAlerts.map((days) => days * 24 * 60);
  }

  /**
   * Builds a description string for a renewal reminder calendar event.
   */
  private buildRenewalDescription(alert: RenewalAlert): string {
    const lines: string[] = [
      `Vendor: ${alert.vendor}`,
      `Amount: $${alert.amount.toFixed(2)}/${alert.billingFrequency}`,
      `Renewal Date: ${alert.renewalDate.toISOString().split("T")[0]}`,
    ];

    if (alert.autoRenewalFlagged) {
      lines.push("⚠️ Auto-renewal is enabled (not explicitly opted in)");
    }

    if (alert.autoRenews) {
      lines.push("This subscription will auto-renew unless cancelled.");
    }

    return lines.join("\n");
  }

  /**
   * Builds a description string for a trial expiry reminder calendar event.
   */
  private buildTrialDescription(trial: TrialRecord, leadDays: number[]): string {
    const lines: string[] = [
      `Vendor: ${trial.vendor}`,
      `Trial End Date: ${trial.trialEndDate instanceof Date ? trial.trialEndDate.toISOString().split("T")[0] : new Date(trial.trialEndDate).toISOString().split("T")[0]}`,
      `Days Remaining: ${trial.daysRemaining}`,
    ];

    if (trial.autoConverts) {
      lines.push(`⚠️ Auto-converts to paid plan`);
      if (trial.convertsToAmount !== null) {
        lines.push(`Conversion Amount: $${trial.convertsToAmount}/${trial.convertsToFrequency ?? "month"}`);
      }
    }

    if (trial.cancellationUrl) {
      lines.push(`Cancel here: ${trial.cancellationUrl}`);
    }

    lines.push(`Reminder schedule: ${leadDays.join(", ")} days before expiry`);

    return lines.join("\n");
  }
}
