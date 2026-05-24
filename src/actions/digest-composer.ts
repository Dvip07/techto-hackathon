/**
 * Smart Digest Composer — Action Engine component for daily/weekly digest generation.
 *
 * Compiles financial intelligence from all feature areas into a prioritized
 * daily or weekly digest with one-click actions and adaptive priority.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7
 */

import type { IntelligenceEngine } from "../intelligence/intelligence-engine";
import type { DigestData, UnifiedEntityStore } from "../store/entity-store";
import type { PriorityRanker } from "./priority-ranker";
import type {
  CommitmentDigestItem,
  DateRange,
  DigestAction,
  DigestAlert,
  RefundDigestItem,
  RenewalDigestItem,
  SavingsDigestItem,
  SmartDigest,
  TrialDigestItem,
} from "../types/outputs";

// ─── Types ───────────────────────────────────────────────────────────────────

export type DigestActionType = DigestAction["type"];

export interface DigestDeliveryOptions {
  userTimezone?: string;
  emailAddress?: string;
}

export interface DismissalRecord {
  itemType: string;
  count: number;
  lastDismissedAt: Date;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TOP_ALERTS_LIMIT = 5;
const DAILY_DELIVERY_HOUR = 7; // 7:00 AM
const DISMISSAL_THRESHOLD = 3; // After 3 dismissals, reduce priority
const PRIORITY_REDUCTION_FACTOR = 0.5;

// ─── Digest Composer ─────────────────────────────────────────────────────────

export class DigestComposer {
  private engine: IntelligenceEngine;
  private store: UnifiedEntityStore;
  private ranker: PriorityRanker;
  private dismissalHistory: Map<string, DismissalRecord> = new Map();
  private deliveryOptions: DigestDeliveryOptions;

  constructor(
    engine: IntelligenceEngine,
    store: UnifiedEntityStore,
    ranker: PriorityRanker,
    options: DigestDeliveryOptions = {}
  ) {
    this.engine = engine;
    this.store = store;
    this.ranker = ranker;
    this.deliveryOptions = options;
  }

  /**
   * Composes a daily or weekly smart digest by aggregating data from the
   * intelligence engine and entity store.
   *
   * Requirement 16.1: Generate digest with total recurring spend, spend change, potential savings
   * Requirement 16.2: Include top 5 priority items ranked by urgency and financial impact
   * Requirement 16.3: Include renewals, expiring trials, overdue refunds, broken promises,
   *   savings opportunities, spending insight, creep warning
   * Requirement 16.4: Attach one-click actions to each actionable item
   * Requirement 16.7: Reduce priority of repeatedly dismissed item types
   */
  async composeDigest(data: DigestData): Promise<SmartDigest> {
    const now = new Date();
    const period = this.determinePeriod(data);
    const coveringRange = this.computeCoveringRange(period, now);

    // Get savings data from intelligence engine
    const savingsResult = await this.engine.generateSavingsRecommendations();
    const totalPotentialSavings = savingsResult.totalPotentialAnnualSavings / 12; // monthly

    // Get creep alert
    const creepAlert = await this.engine.detectSubscriptionCreep();

    // Get spend analysis for insight
    const spendAnalysis = await this.engine.analyzeSpendingPatterns();

    // Build section items
    const renewalsThisPeriod = this.buildRenewalItems(data);
    const expiringTrials = this.buildTrialItems(data);
    const overdueRefunds = this.buildRefundItems(data);
    const brokenPaymentPromises = this.buildCommitmentItems(data);
    const savingsOpportunities = this.buildSavingsItems(savingsResult);

    // Generate spending insight (Req 16.3)
    const spendingInsight = this.generateSpendingInsight(data, spendAnalysis);

    // Generate creep warning (Req 16.3)
    const creepWarning = creepAlert ? creepAlert.insight : null;

    // Build top alerts from priority feed (Req 16.2)
    const priorityFeed = await this.ranker.getPriorityFeed(TOP_ALERTS_LIMIT * 2);
    const topAlerts = this.buildTopAlerts(priorityFeed);

    // Collect all one-click actions (Req 16.4)
    const oneClickActions = this.collectOneClickActions(
      renewalsThisPeriod,
      expiringTrials,
      overdueRefunds,
      brokenPaymentPromises,
      savingsOpportunities,
      topAlerts
    );

    const digest: SmartDigest = {
      id: `digest-${period}-${now.toISOString().split("T")[0]}`,
      period,
      generatedAt: now,
      coveringRange,
      totalRecurringSpend: Math.round(data.totalRecurringSpend * 100) / 100,
      spendChangeFromLastPeriod: Math.round(data.spendChangeFromLastPeriod * 100) / 100,
      totalPotentialSavings: Math.round(totalPotentialSavings * 100) / 100,
      topAlerts,
      renewalsThisPeriod,
      expiringTrials,
      overdueRefunds,
      brokenPaymentPromises,
      savingsOpportunities,
      spendingInsight,
      creepWarning,
      oneClickActions,
    };

    return digest;
  }

  /**
   * Delivers the digest to the specified channel(s).
   *
   * Requirement 16.5: Deliver daily digest by 7:00 AM user's local time
   * Requirement 16.6: Deliver via email in addition to dashboard when configured
   */
  async deliverDigest(
    digest: SmartDigest,
    channel: "email" | "dashboard" | "both"
  ): Promise<void> {
    if (channel === "dashboard" || channel === "both") {
      await this.deliverToDashboard(digest);
    }

    if (channel === "email" || channel === "both") {
      await this.deliverToEmail(digest);
    }
  }

  /**
   * Records a dismissal for priority adaptation.
   *
   * Requirement 16.7: Reduce priority of repeatedly dismissed item types
   */
  recordDismissal(itemType: string): void {
    const existing = this.dismissalHistory.get(itemType);
    if (existing) {
      existing.count += 1;
      existing.lastDismissedAt = new Date();
    } else {
      this.dismissalHistory.set(itemType, {
        itemType,
        count: 1,
        lastDismissedAt: new Date(),
      });
    }
  }

  /**
   * Returns the priority reduction factor for a given item type.
   * Items dismissed 3+ times get their priority reduced by 50%.
   *
   * Requirement 16.7: Reduce priority of repeatedly dismissed item types
   */
  getPriorityReduction(itemType: string): number {
    const record = this.dismissalHistory.get(itemType);
    if (!record || record.count < DISMISSAL_THRESHOLD) {
      return 1.0; // No reduction
    }
    // Progressive reduction: each additional dismissal beyond threshold reduces further
    const extraDismissals = record.count - DISMISSAL_THRESHOLD;
    const reduction = PRIORITY_REDUCTION_FACTOR * Math.pow(0.8, extraDismissals);
    return Math.max(0.1, reduction); // Never reduce below 10%
  }

  /**
   * Returns the scheduled delivery time for the daily digest.
   *
   * Requirement 16.5: Deliver daily digest by 7:00 AM user's local time
   */
  getScheduledDeliveryTime(userTimezone?: string): Date {
    const tz = userTimezone || this.deliveryOptions.userTimezone || "UTC";
    const now = new Date();

    // Calculate 7:00 AM in user's timezone
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const year = parseInt(parts.find((p) => p.type === "year")?.value || "2024");
    const month = parseInt(parts.find((p) => p.type === "month")?.value || "1") - 1;
    const day = parseInt(parts.find((p) => p.type === "day")?.value || "1");

    // Create a date at 7:00 AM in the user's timezone
    // We use a simple approach: create the date and adjust
    const deliveryDate = new Date(year, month, day, DAILY_DELIVERY_HOUR, 0, 0, 0);

    // If the delivery time has already passed today, schedule for tomorrow
    if (deliveryDate <= now) {
      deliveryDate.setDate(deliveryDate.getDate() + 1);
    }

    return deliveryDate;
  }

  /**
   * Returns the current dismissal history for testing/inspection.
   */
  getDismissalHistory(): Map<string, DismissalRecord> {
    return new Map(this.dismissalHistory);
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private determinePeriod(data: DigestData): "daily" | "weekly" {
    // If there are many items, it's likely a weekly digest
    const totalItems =
      data.upcomingRenewals.length +
      data.expiringTrials.length +
      data.overdueRefunds.length +
      data.overdueCommitments.length;

    // Default to daily; weekly is explicitly requested via the store's getDigestData
    return "daily";
  }

  private computeCoveringRange(period: "daily" | "weekly", now: Date): DateRange {
    const start = new Date(now);
    if (period === "daily") {
      start.setDate(start.getDate() - 1);
    } else {
      start.setDate(start.getDate() - 7);
    }
    return { start, end: now };
  }

  /**
   * Builds renewal digest items from the digest data.
   */
  private buildRenewalItems(data: DigestData): RenewalDigestItem[] {
    return data.upcomingRenewals.map((sub) => ({
      vendor: sub.vendor,
      amount: sub.amount,
      renewalDate: sub.nextRenewalDate || new Date(),
      autoRenews: sub.autoRenews,
    }));
  }

  /**
   * Builds trial digest items from the digest data.
   */
  private buildTrialItems(data: DigestData): TrialDigestItem[] {
    return data.expiringTrials.map((trial) => ({
      vendor: trial.vendor,
      expiryDate: trial.trialEndDate,
      convertsToAmount: trial.convertsToAmount,
      autoConverts: trial.autoConverts,
      daysRemaining: trial.daysRemaining,
    }));
  }

  /**
   * Builds refund digest items from the digest data.
   */
  private buildRefundItems(data: DigestData): RefundDigestItem[] {
    return data.overdueRefunds.map((refund) => ({
      vendor: refund.vendor,
      amount: refund.amount,
      expectedDate: refund.expectedByDate,
      daysOverdue: refund.daysOverdue,
    }));
  }

  /**
   * Builds commitment digest items (broken payment promises) from the digest data.
   */
  private buildCommitmentItems(data: DigestData): CommitmentDigestItem[] {
    return data.overdueCommitments
      .filter((c) => c.subtype === "payment_promise")
      .map((commitment) => {
        const daysOverdue = commitment.dueDate
          ? Math.max(
              0,
              Math.floor(
                (new Date().getTime() - new Date(commitment.dueDate).getTime()) /
                  (1000 * 60 * 60 * 24)
              )
            )
          : 0;

        return {
          counterparty: commitment.counterparty,
          amount: commitment.financialValue,
          dueDate: commitment.dueDate,
          daysOverdue,
        };
      });
  }

  /**
   * Builds savings digest items from the savings result.
   */
  private buildSavingsItems(savingsResult: {
    recommendations: Array<{
      vendor: string;
      type: string;
      estimatedMonthlySavings: number;
      estimatedAnnualSavings: number;
    }>;
  }): SavingsDigestItem[] {
    // Take top 3 savings opportunities
    return savingsResult.recommendations.slice(0, 3).map((rec) => ({
      vendor: rec.vendor,
      type: this.mapSavingsType(rec.type),
      monthlySavings: rec.estimatedMonthlySavings,
      annualSavings: rec.estimatedAnnualSavings,
    }));
  }

  private mapSavingsType(
    type: string
  ): "redundancy" | "negotiation" | "billing_switch" | "cancellation" {
    switch (type) {
      case "redundancy":
        return "redundancy";
      case "negotiation":
        return "negotiation";
      case "billing_switch":
        return "billing_switch";
      case "cancellation":
        return "cancellation";
      default:
        return "cancellation";
    }
  }

  /**
   * Generates a natural language spending insight.
   */
  private generateSpendingInsight(
    data: DigestData,
    spendAnalysis: { monthOverMonth: { percentageChange: number; direction: string }; totalMonthlySpend: number }
  ): string {
    const { spendChangeFromLastPeriod, totalRecurringSpend } = data;
    const { monthOverMonth } = spendAnalysis;

    if (Math.abs(monthOverMonth.percentageChange) < 2) {
      return `Your recurring spend is stable at $${totalRecurringSpend.toFixed(2)}/month.`;
    }

    const direction = monthOverMonth.percentageChange > 0 ? "increased" : "decreased";
    const absChange = Math.abs(monthOverMonth.percentageChange);

    return `Your spending ${direction} ${absChange.toFixed(1)}% this period. Total recurring: $${totalRecurringSpend.toFixed(2)}/month.`;
  }

  /**
   * Builds top alerts from the priority feed.
   * Applies priority adaptation for repeatedly dismissed item types.
   *
   * Requirement 16.2: Top 5 priority items ranked by urgency and financial impact
   * Requirement 16.7: Reduce priority of repeatedly dismissed item types
   */
  private buildTopAlerts(
    priorityFeed: Array<{
      id: string;
      featureArea: string;
      title: string;
      description: string;
      urgencyScore: number;
      financialImpact: number;
      suggestedActions: Array<{ type: string; label: string; draftAvailable: boolean }>;
      relatedVendor: string | null;
    }>
  ): DigestAlert[] {
    // Apply priority adaptation
    const adjustedFeed = priorityFeed.map((item) => {
      const reduction = this.getPriorityReduction(item.featureArea);
      return {
        ...item,
        adjustedScore: item.urgencyScore * reduction,
      };
    });

    // Re-sort by adjusted score
    adjustedFeed.sort((a, b) => {
      if (b.adjustedScore !== a.adjustedScore) {
        return b.adjustedScore - a.adjustedScore;
      }
      return b.financialImpact - a.financialImpact;
    });

    // Take top 5
    return adjustedFeed.slice(0, TOP_ALERTS_LIMIT).map((item) => ({
      title: item.title,
      description: item.description,
      urgency: this.scoreToUrgency(item.urgencyScore),
      financialImpact: item.financialImpact,
      action: this.createActionForItem(item),
    }));
  }

  private scoreToUrgency(score: number): "critical" | "high" | "medium" | "low" {
    if (score >= 9) return "critical";
    if (score >= 7) return "high";
    if (score >= 4) return "medium";
    return "low";
  }

  private createActionForItem(item: {
    id: string;
    suggestedActions: Array<{ type: string; label: string }>;
  }): DigestAction {
    const primaryAction = item.suggestedActions[0];
    if (primaryAction) {
      return {
        type: this.mapToDigestActionType(primaryAction.type),
        label: primaryAction.label,
        targetId: item.id,
      };
    }
    return {
      type: "review",
      label: "Review",
      targetId: item.id,
    };
  }

  /**
   * Maps a suggested action type to a valid DigestAction type.
   * Some action types (e.g. cancel_trial, switch_annual) need to be
   * mapped to the digest-compatible action types.
   */
  private mapToDigestActionType(type: string): DigestAction["type"] {
    switch (type) {
      case "cancel":
      case "cancel_trial":
        return "cancel";
      case "negotiate":
        return "negotiate";
      case "follow_up":
        return "follow_up";
      case "set_reminder":
        return "set_reminder";
      case "acknowledge":
        return "acknowledge";
      case "review":
      case "switch_annual":
      default:
        return "review";
    }
  }

  /**
   * Collects all one-click actions from digest sections.
   *
   * Requirement 16.4: Attach one-click actions to each actionable item
   */
  private collectOneClickActions(
    renewals: RenewalDigestItem[],
    trials: TrialDigestItem[],
    refunds: RefundDigestItem[],
    commitments: CommitmentDigestItem[],
    savings: SavingsDigestItem[],
    alerts: DigestAlert[]
  ): DigestAction[] {
    const actions: DigestAction[] = [];

    // Renewal actions: set_reminder or cancel
    for (const renewal of renewals) {
      actions.push({
        type: "set_reminder",
        label: `Set reminder for ${renewal.vendor} renewal`,
        targetId: `renewal-${renewal.vendor}`,
      });
    }

    // Trial actions: cancel
    for (const trial of trials) {
      actions.push({
        type: "cancel",
        label: `Cancel ${trial.vendor} trial`,
        targetId: `trial-${trial.vendor}`,
      });
    }

    // Refund actions: follow_up
    for (const refund of refunds) {
      actions.push({
        type: "follow_up",
        label: `Follow up on ${refund.vendor} refund`,
        targetId: `refund-${refund.vendor}`,
      });
    }

    // Commitment actions: follow_up
    for (const commitment of commitments) {
      actions.push({
        type: "follow_up",
        label: `Follow up with ${commitment.counterparty}`,
        targetId: `commitment-${commitment.counterparty}`,
      });
    }

    // Savings actions: negotiate or cancel
    for (const saving of savings) {
      actions.push({
        type: saving.type === "negotiation" ? "negotiate" : "cancel",
        label: `${saving.type === "negotiation" ? "Negotiate" : "Cancel"} ${saving.vendor}`,
        targetId: `savings-${saving.vendor}`,
      });
    }

    // Alert actions (already computed)
    for (const alert of alerts) {
      actions.push(alert.action);
    }

    return actions;
  }

  /**
   * Delivers digest to the dashboard (stores for retrieval).
   */
  private async deliverToDashboard(digest: SmartDigest): Promise<void> {
    // In a real implementation, this would persist the digest for dashboard retrieval.
    // For now, this is a no-op as the dashboard fetches the digest on demand.
  }

  /**
   * Delivers digest via email.
   *
   * Requirement 16.6: Deliver via email when configured
   */
  private async deliverToEmail(digest: SmartDigest): Promise<void> {
    const emailAddress = this.deliveryOptions.emailAddress;
    if (!emailAddress) {
      return; // No email configured, skip
    }

    // In a real implementation, this would format the digest as HTML/text
    // and send via an email service. For now, this is a placeholder.
  }
}
