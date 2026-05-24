/**
 * Dashboard API — Unified API serving all dashboard tabs from the same backend.
 *
 * Delegates to the Intelligence Engine, Entity Store, and Action Engine components.
 * Implements the DashboardAPI interface from the design document.
 *
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 19.9
 */

import type { IntelligenceEngine, RefundTrackingResult } from "../intelligence/intelligence-engine";
import type { UnifiedEntityStore } from "../store/entity-store";
import type { PriorityRanker } from "../actions/priority-ranker";
import type { DraftGenerator } from "../actions/draft-generator";
import type { CalendarScheduler } from "../actions/calendar-scheduler";
import type { DigestComposer } from "../actions/digest-composer";
import type { NotificationEngine } from "../actions/notification-engine";
import type { UsageSignalCollector, ZombieSubscription } from "../classifier/usage-signal-collector";
import type { TrialRecord, SubscriptionRecord } from "../types/models";
import type {
  BillingOptimization,
  CalendarEntry,
  CommitmentTrackingResult,
  CreepAlert,
  DateRange,
  DraftType,
  EmailDraft,
  MoMComparison,
  NegotiationOpportunity,
  ObligationWatchResult,
  PaymentPromiseResult,
  PrioritizedItem,
  RecurringSpendSnapshot,
  RenewalAlert,
  SavingsRecommendation,
  SmartDigest,
  SpendAnalysis,
} from "../types/outputs";

// ─── Dashboard-Specific Types ────────────────────────────────────────────────

export interface SubscriptionOverviewData {
  totalSubscriptions: number;
  totalMonthlyRecurring: number;
  totalAnnualRecurring: number;
  activeCount: number;
  zombieCount: number;
  trialCount: number;
  priceIncreasedCount: number;
  renewingSoonCount: number;
  subscriptions: SubscriptionRecord[];
}

export interface UsageScoringResult {
  subscriptions: Array<{
    subscription: SubscriptionRecord;
    usageScore: number;
    wasteScore: number;
  }>;
  averageUsageScore: number;
  totalMonthlyWaste: number;
  totalAnnualWaste: number;
}

export interface SavingsSummary {
  totalPotentialMonthlySavings: number;
  totalPotentialAnnualSavings: number;
  recommendationCount: number;
  negotiationCount: number;
  billingOptimizationCount: number;
}

// ─── Dashboard API Dependencies ──────────────────────────────────────────────

export interface DashboardAPIDependencies {
  intelligenceEngine: IntelligenceEngine;
  entityStore: UnifiedEntityStore;
  priorityRanker: PriorityRanker;
  draftGenerator: DraftGenerator;
  calendarScheduler: CalendarScheduler;
  digestComposer: DigestComposer;
  notificationEngine: NotificationEngine;
  usageSignalCollector?: UsageSignalCollector;
}

// ─── Dashboard API Implementation ───────────────────────────────────────────

export class DashboardAPI {
  private engine: IntelligenceEngine;
  private store: UnifiedEntityStore;
  private ranker: PriorityRanker;
  private draftGenerator: DraftGenerator;
  private calendarScheduler: CalendarScheduler;
  private digestComposer: DigestComposer;
  private notificationEngine: NotificationEngine;
  private usageSignalCollector?: UsageSignalCollector;

  private dismissedItems: Set<string> = new Set();
  private leadTimeConfig: Map<string, number[]> = new Map();
  private approvedDrafts: Set<string> = new Set();
  private generatedDrafts: Map<string, EmailDraft> = new Map();

  constructor(deps: DashboardAPIDependencies) {
    this.engine = deps.intelligenceEngine;
    this.store = deps.entityStore;
    this.ranker = deps.priorityRanker;
    this.draftGenerator = deps.draftGenerator;
    this.calendarScheduler = deps.calendarScheduler;
    this.digestComposer = deps.digestComposer;
    this.notificationEngine = deps.notificationEngine;
    this.usageSignalCollector = deps.usageSignalCollector;
  }

  // ─── Global Endpoints ────────────────────────────────────────────────────

  /**
   * Returns the priority feed with dismissed items filtered out.
   *
   * Requirement 19.1: Priority feed as primary view
   */
  async getPriorityFeed(limit: number): Promise<PrioritizedItem[]> {
    const feed = await this.ranker.getPriorityFeed(limit + this.dismissedItems.size);
    return feed
      .filter((item) => !this.dismissedItems.has(item.id))
      .slice(0, limit);
  }

  /**
   * Returns the financial calendar for a given date range.
   *
   * Requirement 19.1: Financial calendar widget
   */
  async getFinancialCalendar(range: DateRange): Promise<CalendarEntry[]> {
    return this.store.getFinancialCalendar(range);
  }

  /**
   * Returns the smart digest for the specified period.
   *
   * Requirement 19.1: Smart digest summary
   */
  async getSmartDigest(period: "daily" | "weekly"): Promise<SmartDigest> {
    const digestData = await this.store.getDigestData(period);
    return this.digestComposer.composeDigest(digestData);
  }

  /**
   * Dismisses an item from the priority feed and records the dismissal
   * for priority adaptation.
   *
   * Requirement 19.9: Dismiss functionality for priority adjustment
   */
  async dismissItem(itemId: string): Promise<void> {
    this.dismissedItems.add(itemId);
    // Record dismissal in the digest composer for priority adaptation
    this.digestComposer.recordDismissal(itemId);
  }

  // ─── Subscriptions Tab Endpoints ─────────────────────────────────────────

  /**
   * Returns subscription overview data including totals and status counts.
   *
   * Requirement 19.2: Subscriptions tab with scanner + usage + trials
   */
  async getSubscriptionOverview(): Promise<SubscriptionOverviewData> {
    const scanResult = await this.engine.scanSubscriptions();

    return {
      totalSubscriptions: scanResult.subscriptions.length,
      totalMonthlyRecurring: scanResult.totalRecurringMonthly,
      totalAnnualRecurring: scanResult.totalRecurringAnnual,
      activeCount: (scanResult.byStatus["active-used"]?.length ?? 0) +
        (scanResult.byStatus["active-unused"]?.length ?? 0),
      zombieCount: scanResult.zombieSubscriptions.length,
      trialCount: scanResult.activeTrialSubscriptions.length,
      priceIncreasedCount: scanResult.priceIncreasedSubscriptions.length,
      renewingSoonCount: scanResult.renewingSoonSubscriptions.length,
      subscriptions: scanResult.subscriptions,
    };
  }

  /**
   * Returns usage scores for all subscriptions.
   *
   * Requirement 19.2: Usage scores per subscription
   */
  async getUsageScores(): Promise<UsageScoringResult> {
    const subscriptions = await this.store.getActiveSubscriptions();

    const scoredSubscriptions = subscriptions.map((sub) => ({
      subscription: sub,
      usageScore: sub.usageScore,
      wasteScore: sub.wasteScore,
    }));

    const totalScores = scoredSubscriptions.reduce((sum, s) => sum + s.usageScore, 0);
    const averageUsageScore = scoredSubscriptions.length > 0
      ? Math.round((totalScores / scoredSubscriptions.length) * 100) / 100
      : 0;

    // Calculate waste from zombie/low-usage subscriptions
    const wasteSubscriptions = scoredSubscriptions.filter((s) => s.usageScore <= 2);
    const totalMonthlyWaste = wasteSubscriptions.reduce(
      (sum, s) => sum + s.subscription.amount,
      0
    );

    return {
      subscriptions: scoredSubscriptions,
      averageUsageScore,
      totalMonthlyWaste: Math.round(totalMonthlyWaste * 100) / 100,
      totalAnnualWaste: Math.round(totalMonthlyWaste * 12 * 100) / 100,
    };
  }

  /**
   * Returns active trials.
   *
   * Requirement 19.2: Active trials with countdown timers
   */
  async getActiveTrials(): Promise<TrialRecord[]> {
    const trialResult = await this.engine.trackTrialExpiries();
    return trialResult.activeTrials;
  }

  /**
   * Returns zombie subscriptions (paying but zero engagement).
   *
   * Requirement 19.2: Highlight zombie subscriptions with waste amount
   */
  async getZombieSubscriptions(): Promise<ZombieSubscription[]> {
    const zombieSubs = await this.store.getZombieSubscriptions();

    return zombieSubs.map((sub) => ({
      subscription: sub,
      usageScore: sub.usageScore,
      lastEngagementDate: sub.updatedAt,
      daysSinceLastEngagement: Math.floor(
        (Date.now() - sub.updatedAt.getTime()) / (1000 * 60 * 60 * 24)
      ),
      monthlyWaste: sub.amount,
      annualWaste: sub.amount * 12,
      recommendation: `Cancel ${sub.vendor} to save $${(sub.amount * 12).toFixed(2)}/year. No engagement detected in 60+ days.`,
    }));
  }

  // ─── Savings Tab Endpoints ───────────────────────────────────────────────

  /**
   * Returns savings recommendations ranked by annual savings.
   *
   * Requirement 19.3: Savings recommendations ranked by annual savings
   */
  async getSavingsRecommendations(): Promise<SavingsRecommendation[]> {
    const result = await this.engine.generateSavingsRecommendations();
    return result.recommendations;
  }

  /**
   * Returns billing optimization opportunities.
   *
   * Requirement 19.3: Billing optimization opportunities with break-even info
   */
  async getBillingOptimizations(): Promise<BillingOptimization[]> {
    return this.engine.findBillingOptimizations();
  }

  /**
   * Returns negotiation opportunities with context.
   *
   * Requirement 19.3: Negotiation opportunities with context
   */
  async getNegotiationOpportunities(): Promise<NegotiationOpportunity[]> {
    return this.engine.generateNegotiationOpportunities();
  }

  /**
   * Returns total potential savings summary.
   *
   * Requirement 19.3: Total potential savings summary at top
   */
  async getTotalPotentialSavings(): Promise<SavingsSummary> {
    const [savingsResult, billingOptimizations] = await Promise.all([
      this.engine.generateSavingsRecommendations(),
      this.engine.findBillingOptimizations(),
    ]);

    const billingMonthlySavings = billingOptimizations.reduce(
      (sum, opt) => sum + opt.monthlySavings,
      0
    );
    const billingAnnualSavings = billingOptimizations.reduce(
      (sum, opt) => sum + opt.annualSavings,
      0
    );

    return {
      totalPotentialMonthlySavings: Math.round(
        (savingsResult.totalPotentialMonthlySavings + billingMonthlySavings) * 100
      ) / 100,
      totalPotentialAnnualSavings: Math.round(
        (savingsResult.totalPotentialAnnualSavings + billingAnnualSavings) * 100
      ) / 100,
      recommendationCount: savingsResult.recommendations.length,
      negotiationCount: savingsResult.negotiationOpportunities.length,
      billingOptimizationCount: billingOptimizations.length,
    };
  }

  // ─── Reminders Tab Endpoints ─────────────────────────────────────────────

  /**
   * Returns upcoming renewals with lead-time countdown.
   *
   * Requirement 19.4: Upcoming renewals with lead-time countdown
   */
  async getUpcomingRenewals(): Promise<RenewalAlert[]> {
    return this.engine.computeUpcomingRenewals();
  }

  /**
   * Returns expiring trials with auto-conversion warnings.
   *
   * Requirement 19.4: Expiring trials with auto-conversion warnings
   */
  async getExpiringTrials(): Promise<TrialRecord[]> {
    const trialResult = await this.engine.trackTrialExpiries();
    return trialResult.expiringSoon;
  }

  /**
   * Configures custom lead-time days for a specific vendor.
   *
   * Requirement 19.4 / 12.5: Allow user to configure custom lead-time days per vendor
   */
  async configureLeadTime(vendor: string, days: number[]): Promise<void> {
    this.leadTimeConfig.set(vendor, [...days].sort((a, b) => b - a));
  }

  /**
   * Returns the configured lead time for a vendor, or the default.
   */
  getLeadTimeConfig(vendor: string): number[] {
    return this.leadTimeConfig.get(vendor) ?? [30, 7, 3, 1];
  }

  // ─── Patterns Tab Endpoints ──────────────────────────────────────────────

  /**
   * Returns spend pattern analysis.
   *
   * Requirement 19.5: Spend trend charts
   */
  async getSpendPatterns(): Promise<SpendAnalysis> {
    return this.engine.analyzeSpendingPatterns();
  }

  /**
   * Returns month-over-month comparison.
   *
   * Requirement 19.5: Month-over-month comparison with percentage change
   */
  async getMonthOverMonthComparison(): Promise<MoMComparison> {
    const analysis = await this.engine.analyzeSpendingPatterns();
    return analysis.monthOverMonth;
  }

  /**
   * Returns subscription creep data.
   *
   * Requirement 19.5: Creep alerts with breakdown and acknowledge action
   */
  async getSubscriptionCreepData(): Promise<CreepAlert | null> {
    return this.engine.detectSubscriptionCreep();
  }

  /**
   * Returns recurring spend timeline.
   *
   * Requirement 19.5: Recurring spend timeline
   */
  async getRecurringSpendTimeline(): Promise<RecurringSpendSnapshot[]> {
    return this.store.getTotalRecurringSpend();
  }

  // ─── Commitments Tab Endpoints ───────────────────────────────────────────

  /**
   * Returns financial commitment tracking results.
   *
   * Requirement 19.6: Financial commitment status with follow-up actions
   */
  async getFinancialCommitments(): Promise<CommitmentTrackingResult> {
    return this.engine.trackFinancialCommitments();
  }

  /**
   * Returns payment promise tracking results.
   *
   * Requirement 19.6: Payment promises with status
   */
  async getPaymentPromises(): Promise<PaymentPromiseResult> {
    return this.engine.trackPaymentPromises();
  }

  /**
   * Returns pending refund tracking results.
   *
   * Requirement 19.6: Pending refunds with expected dates and overdue flags
   */
  async getPendingRefunds(): Promise<RefundTrackingResult> {
    return this.engine.trackRefundsAndCredits();
  }

  // ─── Obligations Tab Endpoint ────────────────────────────────────────────

  /**
   * Returns obligation watch results with risk flags and deadlines.
   *
   * Requirement 19.7: Contracts with risk flag badges, financial exposure, deadlines
   */
  async getObligationWatch(): Promise<ObligationWatchResult> {
    return this.engine.watchObligations();
  }

  // ─── Action Endpoints ────────────────────────────────────────────────────

  /**
   * Approves a previously generated draft for sending.
   *
   * Requirement 19.8: One-click actions / 17.6: User approval before sending
   */
  async approveDraft(draftId: string): Promise<void> {
    const draft = this.generatedDrafts.get(draftId);
    if (!draft) {
      throw new Error(`Draft not found: ${draftId}`);
    }
    this.approvedDrafts.add(draftId);
  }

  /**
   * Requests generation of a new draft for a given type and target.
   *
   * Requirement 19.8: One-click action buttons for cancel, negotiate, follow-up
   */
  async requestDraft(type: DraftType, targetId: string): Promise<EmailDraft> {
    let draft: EmailDraft;

    switch (type) {
      case "cancellation": {
        const subscriptions = await this.store.getSubscriptions();
        const sub = subscriptions.find((s) => s.id === targetId);
        if (!sub) throw new Error(`Subscription not found: ${targetId}`);
        draft = await this.draftGenerator.generateCancellationDraft(sub);
        break;
      }
      case "negotiation": {
        const subscriptions = await this.store.getSubscriptions();
        const sub = subscriptions.find((s) => s.id === targetId);
        if (!sub) throw new Error(`Subscription not found: ${targetId}`);
        draft = await this.draftGenerator.generateNegotiationDraft(sub, "price_increase");
        break;
      }
      case "refund_follow_up": {
        const refunds = await this.store.getPendingRefunds();
        const overdueRefunds = await this.store.getOverdueRefunds();
        const allRefunds = [...refunds, ...overdueRefunds];
        const refund = allRefunds.find((r) => r.id === targetId);
        if (!refund) throw new Error(`Refund not found: ${targetId}`);
        draft = await this.draftGenerator.generateRefundFollowUpDraft(refund);
        break;
      }
      case "trial_cancellation": {
        const trials = await this.store.getActiveTrials();
        const trial = trials.find((t) => t.id === targetId);
        if (!trial) throw new Error(`Trial not found: ${targetId}`);
        draft = await this.draftGenerator.generateTrialCancellationDraft(trial);
        break;
      }
      case "payment_follow_up": {
        const commitments = await this.store.getOpenCommitments();
        const overdueCommitments = await this.store.getOverdueCommitments();
        const allCommitments = [...commitments, ...overdueCommitments];
        const commitment = allCommitments.find((c) => c.id === targetId);
        if (!commitment) throw new Error(`Commitment not found: ${targetId}`);
        draft = await this.draftGenerator.generateFollowUpDraft(commitment);
        break;
      }
      default:
        throw new Error(`Unknown draft type: ${type}`);
    }

    // Store the generated draft for later approval
    this.generatedDrafts.set(draft.id, draft);
    return draft;
  }

  /**
   * Marks a refund as received.
   *
   * Requirement 19.8: Action to mark refund received
   */
  async markRefundReceived(refundId: string): Promise<void> {
    await this.store.markRefundReceived(refundId);
  }

  /**
   * Acknowledges a creep alert to suppress repeated notifications.
   *
   * Requirement 19.8: Acknowledge action for creep alerts
   */
  async acknowledgeCreepAlert(alertId: string): Promise<void> {
    // The intelligence engine handles acknowledgment internally
    // We call detectSubscriptionCreep which checks acknowledged state
    // For now, we store the acknowledgment and it will be checked on next detection
    this.engine.acknowledgeCreepAlert(alertId);
  }

  // ─── Utility Methods ─────────────────────────────────────────────────────

  /**
   * Returns the set of dismissed item IDs (for testing/inspection).
   */
  getDismissedItems(): Set<string> {
    return new Set(this.dismissedItems);
  }

  /**
   * Returns all generated drafts (for testing/inspection).
   */
  getGeneratedDrafts(): Map<string, EmailDraft> {
    return new Map(this.generatedDrafts);
  }

  /**
   * Returns whether a draft has been approved.
   */
  isDraftApproved(draftId: string): boolean {
    return this.approvedDrafts.has(draftId);
  }
}
