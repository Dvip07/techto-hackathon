/**
 * Usage Signal Collector
 *
 * Collects engagement signals from vendor emails to determine whether
 * the user is actively using a subscription. Computes usage scores,
 * applies recency decay, and detects zombie subscriptions.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

import type { AnalyzedMessage, UsageIndicator } from "../types/signals";
import type { SubscriptionRecord } from "../types/models";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface UsageProfile {
  vendor: string;
  totalEmailsFromVendor: number;
  emailsOpened: number;
  lastInteractionDate: Date;
  interactionTypes: InteractionType[];
  loginAlerts: number;
  usageReports: number;
  featureAnnouncements: number;
  supportInteractions: number;
  newsletterEngagements: number;
  engagementDecayRate: number;
}

export type InteractionType =
  | "login_alert"
  | "usage_report"
  | "receipt"
  | "feature_update"
  | "support_ticket"
  | "newsletter_open";

export interface ZombieSubscription {
  subscription: SubscriptionRecord;
  usageScore: number;
  lastEngagementDate: Date;
  daysSinceLastEngagement: number;
  monthlyWaste: number;
  annualWaste: number;
  recommendation: string;
}

// ─── Signal Weights (Requirement 5.2) ────────────────────────────────────────

const SIGNAL_WEIGHTS: Record<UsageIndicator, number> = {
  login_alert: 3,
  usage_report: 2.5,
  support_interaction: 3,
  feature_update: 1,
  newsletter_engagement: 0.5,
};

// ─── Constants ───────────────────────────────────────────────────────────────

const RECENCY_DECAY_DAYS = 90;
const ZOMBIE_NO_ENGAGEMENT_DAYS = 60;
const MAX_USAGE_SCORE = 10;

// ─── Implementation ──────────────────────────────────────────────────────────

export class UsageSignalCollector {
  /**
   * Collects engagement signals per vendor from analyzed messages.
   * Builds a UsageProfile summarizing all engagement indicators.
   *
   * Requirement 5.1: Compute a usage score between 0 and 10 for each subscription
   */
  collectSignals(vendor: string, messages: AnalyzedMessage[]): UsageProfile {
    const vendorMessages = messages.filter(
      (msg) =>
        msg.senderDomain.toLowerCase().includes(vendor.toLowerCase()) ||
        msg.sender.toLowerCase().includes(vendor.toLowerCase())
    );

    let loginAlerts = 0;
    let usageReports = 0;
    let featureAnnouncements = 0;
    let supportInteractions = 0;
    let newsletterEngagements = 0;
    const interactionTypes: InteractionType[] = [];
    let lastInteractionDate = new Date(0);

    for (const msg of vendorMessages) {
      for (const indicator of msg.usageIndicators) {
        switch (indicator) {
          case "login_alert":
            loginAlerts++;
            interactionTypes.push("login_alert");
            break;
          case "usage_report":
            usageReports++;
            interactionTypes.push("usage_report");
            break;
          case "feature_update":
            featureAnnouncements++;
            interactionTypes.push("feature_update");
            break;
          case "support_interaction":
            supportInteractions++;
            interactionTypes.push("support_ticket");
            break;
          case "newsletter_engagement":
            newsletterEngagements++;
            interactionTypes.push("newsletter_open");
            break;
        }
      }

      // Track the most recent interaction date from messages with usage indicators
      if (msg.usageIndicators.length > 0) {
        const msgDate =
          msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp);
        if (msgDate > lastInteractionDate) {
          lastInteractionDate = msgDate;
        }
      }
    }

    // If no interactions found, use the most recent vendor email date
    if (lastInteractionDate.getTime() === 0 && vendorMessages.length > 0) {
      for (const msg of vendorMessages) {
        const msgDate =
          msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp);
        if (msgDate > lastInteractionDate) {
          lastInteractionDate = msgDate;
        }
      }
    }

    // Compute engagement decay rate (Requirement 5.6)
    const engagementDecayRate = this.computeDecayRate(vendorMessages);

    return {
      vendor,
      totalEmailsFromVendor: vendorMessages.length,
      emailsOpened: vendorMessages.filter(
        (m) => m.usageIndicators.length > 0
      ).length,
      lastInteractionDate,
      interactionTypes,
      loginAlerts,
      usageReports,
      featureAnnouncements,
      supportInteractions,
      newsletterEngagements,
      engagementDecayRate,
    };
  }

  /**
   * Computes a usage score between 0 and 10 based on weighted signal scoring
   * with recency decay factor.
   *
   * Requirement 5.1: Score between 0 and 10
   * Requirement 5.2: Weighted scoring
   * Requirement 5.3: Recency decay factor reduces score linearly to zero over 90 days
   */
  computeUsageScore(profile: UsageProfile, referenceDate?: Date): number {
    const now = referenceDate ?? new Date();

    // Calculate raw weighted score from signals
    const rawScore =
      profile.loginAlerts * SIGNAL_WEIGHTS.login_alert +
      profile.usageReports * SIGNAL_WEIGHTS.usage_report +
      profile.supportInteractions * SIGNAL_WEIGHTS.support_interaction +
      profile.featureAnnouncements * SIGNAL_WEIGHTS.feature_update +
      profile.newsletterEngagements * SIGNAL_WEIGHTS.newsletter_engagement;

    // If no signals at all, score is 0
    if (rawScore === 0) {
      return 0;
    }

    // Apply recency decay factor (Requirement 5.3)
    // Reduces score linearly to zero over 90 days since last interaction
    const daysSinceLastInteraction = this.daysBetween(
      profile.lastInteractionDate,
      now
    );
    const recencyFactor = this.computeRecencyDecayFactor(daysSinceLastInteraction);

    // Normalize the raw score to 0-10 range and apply recency decay
    // Use a logarithmic scale to prevent scores from clustering at max
    const normalizedScore = Math.min(MAX_USAGE_SCORE, rawScore);
    const finalScore = normalizedScore * recencyFactor;

    // Clamp to 0-10 range and round to 1 decimal
    return Math.round(Math.max(0, Math.min(MAX_USAGE_SCORE, finalScore)) * 10) / 10;
  }

  /**
   * Detects zombie subscriptions: subscriptions with usage score 0
   * and no engagement for 60+ days.
   *
   * Requirement 5.4: Flag as zombie when score is 0 and no engagement for 60+ days
   * Requirement 5.5: Compute total monthly and annual dollar waste
   */
  detectZombieSubscriptions(
    subscriptions: SubscriptionRecord[],
    profiles?: Map<string, UsageProfile>,
    referenceDate?: Date
  ): ZombieSubscription[] {
    const now = referenceDate ?? new Date();
    const zombies: ZombieSubscription[] = [];

    for (const sub of subscriptions) {
      // Get the usage profile for this subscription if available
      const profile = profiles?.get(sub.vendor) ?? profiles?.get(sub.vendorDomain);

      let usageScore: number;
      let lastEngagementDate: Date;

      if (profile) {
        usageScore = this.computeUsageScore(profile, now);
        lastEngagementDate = profile.lastInteractionDate;
      } else {
        // No profile means no engagement signals at all
        usageScore = 0;
        lastEngagementDate = sub.lastPaymentDate ?? sub.firstSeenDate;
      }

      const daysSinceLastEngagement = this.daysBetween(lastEngagementDate, now);

      // Zombie criteria: score 0 AND no engagement for 60+ days
      if (usageScore === 0 && daysSinceLastEngagement >= ZOMBIE_NO_ENGAGEMENT_DAYS) {
        const monthlyWaste = this.computeMonthlyAmount(sub);
        const annualWaste = monthlyWaste * 12;

        zombies.push({
          subscription: sub,
          usageScore,
          lastEngagementDate,
          daysSinceLastEngagement,
          monthlyWaste,
          annualWaste,
          recommendation: this.generateZombieRecommendation(sub, daysSinceLastEngagement),
        });
      }
    }

    return zombies;
  }

  /**
   * Computes total monthly and annual dollar waste across all zombie subscriptions.
   *
   * Requirement 5.5
   */
  computeTotalWaste(zombies: ZombieSubscription[]): {
    monthlyWaste: number;
    annualWaste: number;
  } {
    const monthlyWaste = zombies.reduce((sum, z) => sum + z.monthlyWaste, 0);
    return {
      monthlyWaste: Math.round(monthlyWaste * 100) / 100,
      annualWaste: Math.round(monthlyWaste * 12 * 100) / 100,
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Computes the recency decay factor.
   * Returns 1.0 for recent interactions (0 days), linearly decreasing to 0.0 at 90 days.
   * Returns 0 for interactions older than 90 days.
   *
   * Requirement 5.3
   */
  private computeRecencyDecayFactor(daysSinceLastInteraction: number): number {
    if (daysSinceLastInteraction <= 0) {
      return 1.0;
    }
    if (daysSinceLastInteraction >= RECENCY_DECAY_DAYS) {
      return 0;
    }
    return 1 - daysSinceLastInteraction / RECENCY_DECAY_DAYS;
  }

  /**
   * Computes the engagement decay rate for a vendor.
   * Measures how quickly engagement is dropping by comparing
   * recent signal density to historical signal density.
   *
   * Requirement 5.6: Track engagement decay rate per subscription
   */
  private computeDecayRate(messages: AnalyzedMessage[]): number {
    if (messages.length < 2) {
      return 0;
    }

    // Sort messages by timestamp
    const sorted = [...messages]
      .filter((m) => m.usageIndicators.length > 0)
      .sort((a, b) => {
        const dateA = a.timestamp instanceof Date ? a.timestamp : new Date(a.timestamp);
        const dateB = b.timestamp instanceof Date ? b.timestamp : new Date(b.timestamp);
        return dateA.getTime() - dateB.getTime();
      });

    if (sorted.length < 2) {
      return 0;
    }

    // Split into two halves and compare signal density
    const midpoint = Math.floor(sorted.length / 2);
    const firstHalf = sorted.slice(0, midpoint);
    const secondHalf = sorted.slice(midpoint);

    const firstHalfStart = firstHalf[0].timestamp instanceof Date
      ? firstHalf[0].timestamp
      : new Date(firstHalf[0].timestamp);
    const firstHalfEnd = firstHalf[firstHalf.length - 1].timestamp instanceof Date
      ? firstHalf[firstHalf.length - 1].timestamp
      : new Date(firstHalf[firstHalf.length - 1].timestamp);
    const secondHalfStart = secondHalf[0].timestamp instanceof Date
      ? secondHalf[0].timestamp
      : new Date(secondHalf[0].timestamp);
    const secondHalfEnd = secondHalf[secondHalf.length - 1].timestamp instanceof Date
      ? secondHalf[secondHalf.length - 1].timestamp
      : new Date(secondHalf[secondHalf.length - 1].timestamp);

    const firstHalfDays = Math.max(1, this.daysBetween(firstHalfStart, firstHalfEnd));
    const secondHalfDays = Math.max(1, this.daysBetween(secondHalfStart, secondHalfEnd));

    const firstHalfDensity = firstHalf.length / firstHalfDays;
    const secondHalfDensity = secondHalf.length / secondHalfDays;

    if (firstHalfDensity === 0) {
      return 0;
    }

    // Positive decay rate means engagement is declining
    // Negative means engagement is increasing
    return Math.round(((firstHalfDensity - secondHalfDensity) / firstHalfDensity) * 100) / 100;
  }

  /**
   * Computes the monthly equivalent amount for a subscription
   * regardless of its billing frequency.
   */
  private computeMonthlyAmount(sub: SubscriptionRecord): number {
    switch (sub.billingFrequency) {
      case "weekly":
        return sub.amount * 4.33;
      case "monthly":
        return sub.amount;
      case "quarterly":
        return sub.amount / 3;
      case "semi-annual":
        return sub.amount / 6;
      case "annual":
        return sub.amount / 12;
      case "one-time":
        return 0;
      default:
        return sub.amount;
    }
  }

  /**
   * Generates a human-readable recommendation for a zombie subscription.
   */
  private generateZombieRecommendation(
    sub: SubscriptionRecord,
    daysSinceEngagement: number
  ): string {
    const monthlyAmount = this.computeMonthlyAmount(sub);
    const monthsUnused = Math.floor(daysSinceEngagement / 30);

    if (monthlyAmount > 20) {
      return `Cancel ${sub.vendor} immediately — you haven't used it in ${monthsUnused} months and it costs $${monthlyAmount.toFixed(2)}/month.`;
    }
    if (monthsUnused >= 3) {
      return `Consider cancelling ${sub.vendor} — no engagement for ${monthsUnused} months. You've wasted approximately $${(monthlyAmount * monthsUnused).toFixed(2)}.`;
    }
    return `${sub.vendor} shows no usage for ${daysSinceEngagement} days. Review whether you still need this subscription.`;
  }

  /**
   * Calculates the number of days between two dates.
   */
  private daysBetween(start: Date, end: Date): number {
    const startTime = start instanceof Date ? start.getTime() : new Date(start).getTime();
    const endTime = end instanceof Date ? end.getTime() : new Date(end).getTime();
    return Math.floor((endTime - startTime) / (1000 * 60 * 60 * 24));
  }
}
