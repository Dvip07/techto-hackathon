/**
 * Priority Ranker — Action Engine component for urgency scoring and priority feed.
 *
 * Assigns urgency scores (0-10) to all insights based on financial impact and
 * time sensitivity, then ranks them for the priority feed.
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.5
 */

import type { FeatureArea } from "../types/enums";
import type { TrialRecord, SubscriptionRecord, RefundRecord, FinancialCommitment, FinancialObligation } from "../types/models";
import type {
  PrioritizedItem,
  SuggestedAction,
  BillingOptimization,
  CreepAlert,
  NegotiationOpportunity,
  RenewalAlert,
  SavingsRecommendation,
  SpendAnalysis,
} from "../types/outputs";
import type { IntelligenceEngine, RefundTrackingResult, TrialExpiryResult } from "../intelligence/intelligence-engine";

// ─── Constants ───────────────────────────────────────────────────────────────

const TRIAL_URGENT_HOURS = 48;
const TRIAL_HIGH_COST_THRESHOLD = 20; // $20/month

// ─── Priority Ranker ─────────────────────────────────────────────────────────

export class PriorityRanker {
  private engine: IntelligenceEngine;

  constructor(engine: IntelligenceEngine) {
    this.engine = engine;
  }

  /**
   * Aggregates insights from all 13 feature areas, assigns urgency scores,
   * and returns a priority-ranked feed.
   *
   * Requirement 18.1: Assign urgency score 0-10 based on financial impact and time sensitivity
   * Requirement 18.4: Rank all items by urgency score descending
   * Requirement 18.5: Break ties by financial impact (higher first)
   */
  async getPriorityFeed(limit: number): Promise<PrioritizedItem[]> {
    const items: PrioritizedItem[] = [];

    // Gather insights from all 13 feature areas in parallel
    const [
      subscriptionScan,
      trialExpiry,
      savingsResult,
      billingOptimizations,
      creepAlert,
      refundTracking,
      paymentPromises,
      renewalAlerts,
      spendAnalysis,
      commitmentTracking,
      obligationWatch,
    ] = await Promise.all([
      this.engine.scanSubscriptions(),
      this.engine.trackTrialExpiries(),
      this.engine.generateSavingsRecommendations(),
      this.engine.findBillingOptimizations(),
      this.engine.detectSubscriptionCreep(),
      this.engine.trackRefundsAndCredits(),
      this.engine.trackPaymentPromises(),
      this.engine.computeUpcomingRenewals(),
      this.engine.analyzeSpendingPatterns(),
      this.engine.trackFinancialCommitments(),
      this.engine.watchObligations(),
    ]);

    // Feature 1: Subscriptions — zombie subscriptions
    for (const sub of subscriptionScan.zombieSubscriptions) {
      items.push(this.createZombieSubscriptionItem(sub));
    }

    // Feature 1: Subscriptions — price increases
    for (const sub of subscriptionScan.priceIncreasedSubscriptions) {
      items.push(this.createPriceIncreaseItem(sub));
    }

    // Feature 2: Usage scoring — handled via zombie subscriptions above

    // Feature 3: Savings recommendations
    for (const rec of savingsResult.recommendations) {
      items.push(this.createSavingsItem(rec));
    }

    // Feature 4: Free trial expiry
    for (const entry of trialExpiry.trialsByUrgency) {
      items.push(this.createTrialExpiryItem(entry.trial, entry.urgencyScore));
    }

    // Feature 5: Billing optimizations
    for (const opt of billingOptimizations) {
      items.push(this.createBillingOptimizationItem(opt));
    }

    // Feature 6: Subscription creep
    if (creepAlert) {
      items.push(this.createCreepAlertItem(creepAlert));
    }

    // Feature 7: Refund tracking
    for (const refund of refundTracking.overdueRefunds) {
      items.push(this.createOverdueRefundItem(refund));
    }

    // Feature 8: Payment promises
    for (const promise of paymentPromises.overduePromises) {
      items.push(this.createOverduePaymentPromiseItem(promise));
    }

    // Feature 9: Renewal reminders
    for (const alert of renewalAlerts) {
      items.push(this.createRenewalAlertItem(alert));
    }

    // Feature 10: Spend patterns — anomalies
    if (spendAnalysis.anomalies.length > 0) {
      items.push(this.createSpendAnomalyItem(spendAnalysis));
    }

    // Feature 11: Financial commitments — overdue
    for (const commitment of commitmentTracking.overdue) {
      items.push(this.createOverdueCommitmentItem(commitment));
    }

    // Feature 12: Obligations — high risk
    for (const obligation of obligationWatch.highRiskObligations) {
      items.push(this.createHighRiskObligationItem(obligation));
    }

    // Feature 13: Digest — handled separately by the Digest Composer

    // Requirement 18.4: Rank by urgency score descending
    // Requirement 18.5: Break ties by financial impact (higher first)
    items.sort((a, b) => {
      if (b.urgencyScore !== a.urgencyScore) {
        return b.urgencyScore - a.urgencyScore;
      }
      return b.financialImpact - a.financialImpact;
    });

    // Return limited results
    return items.slice(0, limit);
  }

  /**
   * Computes the urgency score for a trial based on time sensitivity and cost.
   *
   * Requirement 18.2: Trial expiring within 48 hours that auto-converts → urgency 10
   * Requirement 18.3: Trial auto-converting to plan >$20/month → urgency 9
   */
  computeTrialUrgency(trial: TrialRecord, referenceDate?: Date): number {
    const now = referenceDate ?? new Date();
    const endDate = trial.trialEndDate instanceof Date
      ? trial.trialEndDate
      : new Date(trial.trialEndDate);
    const hoursRemaining = (endDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Already expired — no urgency
    if (hoursRemaining <= 0) {
      return 0;
    }

    // Requirement 18.2: Expires within 48 hours and auto-converts → urgency 10
    if (hoursRemaining <= TRIAL_URGENT_HOURS && trial.autoConverts) {
      return 10;
    }

    // Requirement 18.3: Auto-converts to plan >$20/month → urgency 9
    if (trial.autoConverts && trial.convertsToAmount !== null) {
      const monthlyAmount = this.trialConversionToMonthly(trial);
      if (monthlyAmount > TRIAL_HIGH_COST_THRESHOLD) {
        return 9;
      }
    }

    // Expiring within 7 days with auto-conversion
    if (trial.daysRemaining <= 7 && trial.autoConverts) {
      return 7;
    }

    // Expiring within 7 days without auto-conversion
    if (trial.daysRemaining <= 7) {
      return 5;
    }

    // Active trial with auto-conversion
    if (trial.autoConverts) {
      return 3;
    }

    // Active trial without auto-conversion
    return 1;
  }

  /**
   * Assigns a general urgency score based on financial impact and time sensitivity.
   *
   * Requirement 18.1: Assign urgency score 0-10 based on financial impact and time sensitivity
   */
  computeUrgencyScore(financialImpact: number, daysUntilDeadline: number | null): number {
    let score = 0;

    // Financial impact component (0-5 points)
    if (financialImpact >= 100) {
      score += 5;
    } else if (financialImpact >= 50) {
      score += 4;
    } else if (financialImpact >= 20) {
      score += 3;
    } else if (financialImpact >= 10) {
      score += 2;
    } else if (financialImpact > 0) {
      score += 1;
    }

    // Time sensitivity component (0-5 points)
    if (daysUntilDeadline !== null) {
      if (daysUntilDeadline <= 1) {
        score += 5;
      } else if (daysUntilDeadline <= 3) {
        score += 4;
      } else if (daysUntilDeadline <= 7) {
        score += 3;
      } else if (daysUntilDeadline <= 14) {
        score += 2;
      } else if (daysUntilDeadline <= 30) {
        score += 1;
      }
    }

    return Math.min(10, score);
  }

  // ─── Item Creation Helpers ─────────────────────────────────────────────────

  private createTrialExpiryItem(trial: TrialRecord, urgencyScore: number): PrioritizedItem {
    const monthlyAmount = this.trialConversionToMonthly(trial);
    const actions: SuggestedAction[] = [
      { type: "cancel_trial", label: "Cancel trial", draftAvailable: true },
      { type: "set_reminder", label: "Set reminder", draftAvailable: false },
    ];

    return {
      id: `priority-trial-${trial.id}`,
      featureArea: "trials",
      title: `${trial.vendor} trial expiring${trial.daysRemaining <= 2 ? " soon" : ""}`,
      description: trial.autoConverts
        ? `Trial converts to $${monthlyAmount.toFixed(2)}/mo in ${trial.daysRemaining} day${trial.daysRemaining === 1 ? "" : "s"}`
        : `Trial expires in ${trial.daysRemaining} day${trial.daysRemaining === 1 ? "" : "s"}`,
      urgencyScore,
      financialImpact: monthlyAmount * 12, // Annual impact
      suggestedActions: actions,
      relatedVendor: trial.vendor,
      dueDate: trial.trialEndDate,
      createdAt: new Date(),
    };
  }

  private createZombieSubscriptionItem(sub: SubscriptionRecord): PrioritizedItem {
    const monthlyAmount = this.subscriptionToMonthly(sub);
    return {
      id: `priority-zombie-${sub.id}`,
      featureArea: "usage-scoring",
      title: `${sub.vendor} — unused subscription`,
      description: `You're paying $${monthlyAmount.toFixed(2)}/mo but haven't used ${sub.vendor} in 60+ days`,
      urgencyScore: this.computeUrgencyScore(monthlyAmount * 12, null),
      financialImpact: monthlyAmount * 12,
      suggestedActions: [
        { type: "cancel", label: "Cancel subscription", draftAvailable: true },
        { type: "review", label: "Review usage", draftAvailable: false },
      ],
      relatedVendor: sub.vendor,
      dueDate: null,
      createdAt: new Date(),
    };
  }

  private createPriceIncreaseItem(sub: SubscriptionRecord): PrioritizedItem {
    const latestChange = sub.priceChangeHistory[sub.priceChangeHistory.length - 1];
    const increase = latestChange ? latestChange.newAmount - latestChange.previousAmount : 0;
    return {
      id: `priority-price-${sub.id}`,
      featureArea: "subscriptions",
      title: `${sub.vendor} price increased`,
      description: latestChange
        ? `Price went from $${latestChange.previousAmount.toFixed(2)} to $${latestChange.newAmount.toFixed(2)} (${latestChange.percentageChange.toFixed(1)}% increase)`
        : `Price increase detected for ${sub.vendor}`,
      urgencyScore: this.computeUrgencyScore(increase * 12, null),
      financialImpact: increase * 12,
      suggestedActions: [
        { type: "negotiate", label: "Negotiate price", draftAvailable: true },
        { type: "cancel", label: "Cancel subscription", draftAvailable: true },
      ],
      relatedVendor: sub.vendor,
      dueDate: null,
      createdAt: new Date(),
    };
  }

  private createSavingsItem(rec: SavingsRecommendation): PrioritizedItem {
    return {
      id: `priority-savings-${rec.id}`,
      featureArea: "savings",
      title: `Save on ${rec.vendor}`,
      description: rec.reason,
      urgencyScore: this.computeUrgencyScore(rec.estimatedAnnualSavings, null),
      financialImpact: rec.estimatedAnnualSavings,
      suggestedActions: [
        {
          type: rec.type === "redundancy" ? "cancel" : "negotiate",
          label: rec.type === "redundancy" ? "Cancel redundant" : "Negotiate",
          draftAvailable: rec.draftAvailable,
        },
        { type: "review", label: "Review details", draftAvailable: false },
      ],
      relatedVendor: rec.vendor,
      dueDate: null,
      createdAt: new Date(),
    };
  }

  private createBillingOptimizationItem(opt: BillingOptimization): PrioritizedItem {
    return {
      id: `priority-billing-${opt.id}`,
      featureArea: "billing-optimizer",
      title: `Switch ${opt.vendor} to annual`,
      description: opt.recommendation,
      urgencyScore: this.computeUrgencyScore(opt.annualSavings, null),
      financialImpact: opt.annualSavings,
      suggestedActions: [
        { type: "switch_annual", label: "Switch to annual", draftAvailable: false },
        { type: "review", label: "Review details", draftAvailable: false },
      ],
      relatedVendor: opt.vendor,
      dueDate: null,
      createdAt: new Date(),
    };
  }

  private createCreepAlertItem(alert: CreepAlert): PrioritizedItem {
    return {
      id: `priority-creep-${alert.id}`,
      featureArea: "creep-alert",
      title: "Subscription spend is creeping up",
      description: alert.insight,
      urgencyScore: this.computeUrgencyScore(alert.absoluteIncrease * 12, null),
      financialImpact: alert.absoluteIncrease * 12,
      suggestedActions: [
        { type: "review", label: "Review subscriptions", draftAvailable: false },
        { type: "acknowledge", label: "Acknowledge", draftAvailable: false },
      ],
      relatedVendor: null,
      dueDate: null,
      createdAt: alert.detectedAt,
    };
  }

  private createOverdueRefundItem(refund: RefundRecord): PrioritizedItem {
    return {
      id: `priority-refund-${refund.id}`,
      featureArea: "refunds",
      title: `Overdue refund from ${refund.vendor}`,
      description: `$${refund.amount.toFixed(2)} refund is ${refund.daysOverdue} days overdue`,
      urgencyScore: this.computeUrgencyScore(refund.amount, -refund.daysOverdue),
      financialImpact: refund.amount,
      suggestedActions: [
        { type: "follow_up", label: "Send follow-up", draftAvailable: true },
        { type: "review", label: "Review details", draftAvailable: false },
      ],
      relatedVendor: refund.vendor,
      dueDate: refund.expectedByDate,
      createdAt: new Date(),
    };
  }

  private createOverduePaymentPromiseItem(promise: {
    commitmentId: string;
    counterparty: string;
    amount: number | null;
    daysOverdue: number;
    description: string;
    dueDate: Date | null;
  }): PrioritizedItem {
    const amount = promise.amount ?? 0;
    return {
      id: `priority-promise-${promise.commitmentId}`,
      featureArea: "payment-promises",
      title: `Overdue payment from ${promise.counterparty}`,
      description: `${promise.description} — ${promise.daysOverdue} days overdue${amount > 0 ? ` ($${amount.toFixed(2)})` : ""}`,
      urgencyScore: this.computeUrgencyScore(amount, -promise.daysOverdue),
      financialImpact: amount,
      suggestedActions: [
        { type: "follow_up", label: "Send follow-up", draftAvailable: true },
        { type: "review", label: "Review details", draftAvailable: false },
      ],
      relatedVendor: promise.counterparty,
      dueDate: promise.dueDate,
      createdAt: new Date(),
    };
  }

  private createRenewalAlertItem(alert: RenewalAlert): PrioritizedItem {
    const urgency = this.computeUrgencyScore(alert.amount * 12, alert.daysUntilRenewal);
    return {
      id: `priority-renewal-${alert.id}`,
      featureArea: "renewals",
      title: `${alert.vendor} renewing in ${alert.daysUntilRenewal} day${alert.daysUntilRenewal === 1 ? "" : "s"}`,
      description: `$${alert.amount.toFixed(2)}/${alert.billingFrequency} renewal${alert.autoRenewalFlagged ? " (auto-renewal)" : ""}`,
      urgencyScore: urgency,
      financialImpact: alert.amount * 12,
      suggestedActions: [
        { type: "set_reminder", label: "Set reminder", draftAvailable: false },
        { type: "cancel", label: "Cancel subscription", draftAvailable: true },
      ],
      relatedVendor: alert.vendor,
      dueDate: alert.renewalDate,
      createdAt: new Date(),
    };
  }

  private createSpendAnomalyItem(analysis: SpendAnalysis): PrioritizedItem {
    const topAnomaly = analysis.anomalies[0];
    return {
      id: `priority-anomaly-${topAnomaly.month}-${Date.now()}`,
      featureArea: "patterns",
      title: "Spending anomaly detected",
      description: topAnomaly.description,
      urgencyScore: this.computeUrgencyScore(topAnomaly.amount, null),
      financialImpact: topAnomaly.amount,
      suggestedActions: [
        { type: "review", label: "Review patterns", draftAvailable: false },
      ],
      relatedVendor: topAnomaly.vendor ?? null,
      dueDate: null,
      createdAt: new Date(),
    };
  }

  private createOverdueCommitmentItem(commitment: FinancialCommitment): PrioritizedItem {
    const amount = commitment.financialValue ?? 0;
    return {
      id: `priority-commitment-${commitment.id}`,
      featureArea: "commitments",
      title: `Overdue commitment: ${commitment.counterparty}`,
      description: commitment.description,
      urgencyScore: this.computeUrgencyScore(amount, null),
      financialImpact: amount,
      suggestedActions: [
        { type: "follow_up", label: "Send follow-up", draftAvailable: true },
        { type: "review", label: "Review details", draftAvailable: false },
      ],
      relatedVendor: commitment.counterparty,
      dueDate: commitment.dueDate,
      createdAt: commitment.createdAt,
    };
  }

  private createHighRiskObligationItem(obligation: FinancialObligation): PrioritizedItem {
    const riskDescription = obligation.riskFlags.join(", ");
    return {
      id: `priority-obligation-${obligation.id}`,
      featureArea: "obligations",
      title: `High-risk contract: ${obligation.contractName}`,
      description: `Risk flags: ${riskDescription}. Financial exposure: $${obligation.financialExposure.toFixed(2)}`,
      urgencyScore: this.computeUrgencyScore(obligation.financialExposure, null),
      financialImpact: obligation.financialExposure,
      suggestedActions: [
        { type: "review", label: "Review contract", draftAvailable: false },
        { type: "set_reminder", label: "Set deadline reminder", draftAvailable: false },
      ],
      relatedVendor: obligation.parties[0] ?? null,
      dueDate: null,
      createdAt: obligation.createdAt,
    };
  }

  // ─── Utility Methods ───────────────────────────────────────────────────────

  private trialConversionToMonthly(trial: TrialRecord): number {
    if (trial.convertsToAmount === null) return 0;

    switch (trial.convertsToFrequency) {
      case "weekly":
        return trial.convertsToAmount * 4.33;
      case "monthly":
        return trial.convertsToAmount;
      case "quarterly":
        return trial.convertsToAmount / 3;
      case "semi-annual":
        return trial.convertsToAmount / 6;
      case "annual":
        return trial.convertsToAmount / 12;
      case "one-time":
        return 0;
      default:
        return trial.convertsToAmount;
    }
  }

  private subscriptionToMonthly(sub: SubscriptionRecord): number {
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
}
