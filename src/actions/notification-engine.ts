/**
 * Notification Engine — Action Engine component for dispatching notifications and alerts.
 *
 * Dispatches notifications for prioritized items and creep alerts.
 * Manages notification history and delivery status.
 *
 * Requirements: 7.5, 12.4, 15.7, 20.4
 */

import type { PrioritizedItem, CreepAlert } from "../types/outputs";

// ─── Types ───────────────────────────────────────────────────────────────────

export type NotificationChannel = "dashboard" | "email" | "push";
export type NotificationPriority = "critical" | "high" | "medium" | "low";

export interface Notification {
  id: string;
  title: string;
  body: string;
  priority: NotificationPriority;
  channel: NotificationChannel;
  relatedItemId: string;
  vendor: string | null;
  financialImpact: number;
  dispatchedAt: Date;
  readAt: Date | null;
  dismissedAt: Date | null;
}

export interface NotificationPreferences {
  enabledChannels: NotificationChannel[];
  quietHoursStart: number | null; // hour (0-23)
  quietHoursEnd: number | null;   // hour (0-23)
  creepAlertEnabled: boolean;
  minimumUrgencyScore: number;    // only notify for items at or above this score
}

// ─── Notification Engine ─────────────────────────────────────────────────────

export class NotificationEngine {
  private notifications: Map<string, Notification> = new Map();
  private preferences: NotificationPreferences;

  constructor(preferences?: Partial<NotificationPreferences>) {
    this.preferences = {
      enabledChannels: ["dashboard"],
      quietHoursStart: null,
      quietHoursEnd: null,
      creepAlertEnabled: true,
      minimumUrgencyScore: 5,
      ...preferences,
    };
  }

  /**
   * Dispatches a notification for a prioritized item.
   *
   * Only dispatches if the item's urgency score meets the minimum threshold
   * and the current time is not within quiet hours.
   */
  async dispatchNotification(item: PrioritizedItem): Promise<void> {
    // Check if item meets minimum urgency threshold
    if (item.urgencyScore < this.preferences.minimumUrgencyScore) {
      return;
    }

    // Check quiet hours
    if (this.isQuietHours()) {
      return;
    }

    const priority = this.urgencyToPriority(item.urgencyScore);

    const notification: Notification = {
      id: `notif-${item.id}-${Date.now()}`,
      title: item.title,
      body: item.description,
      priority,
      channel: this.selectChannel(priority),
      relatedItemId: item.id,
      vendor: item.relatedVendor,
      financialImpact: item.financialImpact,
      dispatchedAt: new Date(),
      readAt: null,
      dismissedAt: null,
    };

    this.notifications.set(notification.id, notification);
  }

  /**
   * Dispatches a creep alert notification.
   *
   * Creep alerts are always dispatched at high priority since they represent
   * unnoticed spend growth.
   *
   * Requirement 9.4: Include breakdown of contributing subscriptions and price hikes
   */
  async dispatchCreepAlert(alert: CreepAlert): Promise<void> {
    if (!this.preferences.creepAlertEnabled) {
      return;
    }

    // Don't re-notify for acknowledged alerts
    if (alert.acknowledged) {
      return;
    }

    // Check quiet hours
    if (this.isQuietHours()) {
      return;
    }

    const body = this.buildCreepAlertBody(alert);

    const notification: Notification = {
      id: `notif-creep-${alert.id}-${Date.now()}`,
      title: "⚠️ Subscription Creep Alert",
      body,
      priority: "high",
      channel: this.selectChannel("high"),
      relatedItemId: alert.id,
      vendor: null,
      financialImpact: alert.absoluteIncrease * 12, // annualized impact
      dispatchedAt: new Date(),
      readAt: null,
      dismissedAt: null,
    };

    this.notifications.set(notification.id, notification);
  }

  /**
   * Marks a notification as read.
   */
  markAsRead(notificationId: string): void {
    const notification = this.notifications.get(notificationId);
    if (notification) {
      notification.readAt = new Date();
    }
  }

  /**
   * Dismisses a notification.
   */
  dismiss(notificationId: string): void {
    const notification = this.notifications.get(notificationId);
    if (notification) {
      notification.dismissedAt = new Date();
    }
  }

  /**
   * Returns all unread notifications sorted by priority.
   */
  getUnreadNotifications(): Notification[] {
    return Array.from(this.notifications.values())
      .filter((n) => n.readAt === null && n.dismissedAt === null)
      .sort((a, b) => this.priorityWeight(b.priority) - this.priorityWeight(a.priority));
  }

  /**
   * Returns all notifications (for testing/inspection).
   */
  getAllNotifications(): Notification[] {
    return Array.from(this.notifications.values());
  }

  /**
   * Updates notification preferences.
   */
  updatePreferences(updates: Partial<NotificationPreferences>): void {
    this.preferences = { ...this.preferences, ...updates };
  }

  /**
   * Returns current preferences.
   */
  getPreferences(): NotificationPreferences {
    return { ...this.preferences };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Maps urgency score (0-10) to notification priority.
   */
  private urgencyToPriority(urgencyScore: number): NotificationPriority {
    if (urgencyScore >= 9) return "critical";
    if (urgencyScore >= 7) return "high";
    if (urgencyScore >= 5) return "medium";
    return "low";
  }

  /**
   * Selects the appropriate notification channel based on priority.
   */
  private selectChannel(priority: NotificationPriority): NotificationChannel {
    const channels = this.preferences.enabledChannels;

    // Critical and high priority: prefer push if available, then email
    if (priority === "critical" || priority === "high") {
      if (channels.includes("push")) return "push";
      if (channels.includes("email")) return "email";
    }

    // Default to dashboard
    return "dashboard";
  }

  /**
   * Checks if the current time is within configured quiet hours.
   */
  private isQuietHours(referenceTime?: Date): boolean {
    const { quietHoursStart, quietHoursEnd } = this.preferences;

    if (quietHoursStart === null || quietHoursEnd === null) {
      return false;
    }

    const now = referenceTime ?? new Date();
    const currentHour = now.getHours();

    // Handle overnight quiet hours (e.g., 22:00 - 07:00)
    if (quietHoursStart > quietHoursEnd) {
      return currentHour >= quietHoursStart || currentHour < quietHoursEnd;
    }

    // Handle same-day quiet hours (e.g., 01:00 - 06:00)
    return currentHour >= quietHoursStart && currentHour < quietHoursEnd;
  }

  /**
   * Builds the notification body for a creep alert.
   */
  private buildCreepAlertBody(alert: CreepAlert): string {
    const lines: string[] = [alert.insight];

    if (alert.newSubscriptionsAdded.length > 0) {
      const newVendors = alert.newSubscriptionsAdded.map((s) => s.vendor).join(", ");
      lines.push(`New subscriptions: ${newVendors}`);
    }

    if (alert.priceIncreasesDetected.length > 0) {
      lines.push(`${alert.priceIncreasesDetected.length} price increase(s) detected`);
    }

    lines.push(
      `Monthly spend grew from $${alert.startingMonthlySpend.toFixed(2)} to $${alert.currentMonthlySpend.toFixed(2)} (+${alert.percentageIncrease.toFixed(1)}%)`
    );

    return lines.join("\n");
  }

  /**
   * Returns a numeric weight for priority sorting.
   */
  private priorityWeight(priority: NotificationPriority): number {
    switch (priority) {
      case "critical": return 4;
      case "high": return 3;
      case "medium": return 2;
      case "low": return 1;
    }
  }
}
