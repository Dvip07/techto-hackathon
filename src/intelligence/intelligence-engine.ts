/**
 * Intelligence Engine — Subscription & Spend Scanner + Free Trial Expiry Tracker
 *
 * Orchestrates all feature areas against the shared entity store.
 * This file implements the core subscription scanning, status classification,
 * price change detection, category classification, and free trial expiry tracking.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 7.1, 7.2, 7.3, 7.4, 7.6
 */

import type { SubscriptionCategory, SubscriptionStatus, RiskFlag } from "../types/enums";
import type { FinancialCommitment, FinancialObligation, ObligationDeadline, PriceChange, RefundRecord, SubscriptionRecord, TrialRecord } from "../types/models";
import type { UnifiedEntityStore } from "../store/entity-store";
import type { AnalyzedMessage } from "../types/signals";
import type {
  BillingOptimization,
  CategorySpend,
  CommitmentTrackingResult,
  CommitmentTotals,
  CreepAlert,
  DateRange,
  FinancialCalendarResult,
  MonthlySpend,
  MoMComparison,
  NegotiationOpportunity,
  NegotiationReason,
  ObligationRiskItem,
  ObligationWatchResult,
  ObligationWatchSummary,
  PaymentPromiseItem,
  PaymentPromiseResult,
  QoQComparison,
  RecurringSpendSnapshot,
  RenewalAlert,
  SavingsRecommendation,
  SavingsResult,
  SpendAnalysis,
  SpendAnomaly,
} from "../types/outputs";

// ─── Result Types ────────────────────────────────────────────────────────────

export interface SubscriptionScanResult {
  subscriptions: SubscriptionRecord[];
  totalRecurringMonthly: number;
  totalRecurringAnnual: number;
  byStatus: Record<SubscriptionStatus, SubscriptionRecord[]>;
  byCategory: Record<SubscriptionCategory, SubscriptionRecord[]>;
  zombieSubscriptions: SubscriptionRecord[];
  priceIncreasedSubscriptions: SubscriptionRecord[];
  renewingSoonSubscriptions: SubscriptionRecord[];
  activeTrialSubscriptions: SubscriptionRecord[];
  recentPriceChanges: PriceChangeDetail[];
  scanDate: Date;
}

export interface PriceChangeDetail {
  vendor: string;
  vendorDomain: string;
  previousAmount: number;
  newAmount: number;
  percentageChange: number;
  detectedDate: Date;
  subscriptionId: string;
}

/**
 * Result of the free trial expiry tracking analysis.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.6
 */
export interface TrialExpiryResult {
  activeTrials: TrialRecord[];
  expiringSoon: TrialRecord[]; // within 7 days
  urgentTrials: TrialRecord[]; // within 48 hours
  totalPotentialCharges: number;
  trialsByUrgency: { trial: TrialRecord; urgencyScore: number }[];
}

/**
 * Result of the refund and credit tracking analysis.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.5, 10.6
 */
export interface RefundTrackingResult {
  pendingRefunds: RefundRecord[];
  overdueRefunds: RefundRecord[];
  totalPendingAmount: number;
  totalOverdueAmount: number;
  totalTrackedRefunds: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ZOMBIE_NO_ENGAGEMENT_DAYS = 60;
const RENEWING_SOON_DAYS = 30;
const TRIAL_EXPIRING_SOON_DAYS = 7;
const TRIAL_URGENT_HOURS = 48;
const TRIAL_HIGH_COST_THRESHOLD = 20; // $20/month
const REFUND_EXPECTED_DAYS = 14; // 14 days from promise date
const REFUND_OVERDUE_GRACE_DAYS = 14; // 14 days past expected date

// Subscription Creep Detection constants
const CREEP_PERCENTAGE_THRESHOLD = 15; // 15% growth over 90 days
const CREEP_PERIOD_DAYS = 90;
const CREEP_NEW_SUBSCRIPTION_THRESHOLD = 3; // 3+ new subscriptions in 30 days
const CREEP_NEW_SUBSCRIPTION_WINDOW_DAYS = 30;

// ─── Intelligence Engine ─────────────────────────────────────────────────────

export class IntelligenceEngine {
  private store: UnifiedEntityStore;
  private acknowledgedCreepAlerts: Set<string> = new Set();

  constructor(store: UnifiedEntityStore) {
    this.store = store;
  }

  /**
   * Scans all subscriptions and produces a complete subscription scan result.
   * Queries the entity store, classifies statuses, detects price changes,
   * and categorizes all subscriptions.
   *
   * Requirement 4.1: Maintain a live subscription ledger with vendor, amount,
   *   billing frequency, category, and status
   * Requirement 4.5: Assign status to each subscription
   */
  async scanSubscriptions(): Promise<SubscriptionScanResult> {
    const now = new Date();

    // Get all subscriptions from the store
    const allSubscriptions = await this.store.getSubscriptions();

    // Get messages for engagement analysis
    const messages = await this.store.queryMessages({});

    // Classify status for each subscription
    const classifiedSubscriptions = allSubscriptions.map((sub) =>
      this.classifySubscriptionStatus(sub, messages, now)
    );

    // Update subscriptions in the store with new statuses
    for (const sub of classifiedSubscriptions) {
      await this.store.upsertSubscription(sub);
    }

    // Group by status
    const byStatus = this.groupByStatus(classifiedSubscriptions);

    // Group by category
    const byCategory = this.groupByCategory(classifiedSubscriptions);

    // Extract recent price changes
    const recentPriceChanges = this.extractRecentPriceChanges(classifiedSubscriptions);

    // Calculate totals
    const totalRecurringMonthly = this.calculateTotalMonthlyRecurring(classifiedSubscriptions);
    const totalRecurringAnnual = totalRecurringMonthly * 12;

    return {
      subscriptions: classifiedSubscriptions,
      totalRecurringMonthly,
      totalRecurringAnnual,
      byStatus,
      byCategory,
      zombieSubscriptions: byStatus["zombie"] || [],
      priceIncreasedSubscriptions: byStatus["price-increased"] || [],
      renewingSoonSubscriptions: byStatus["renewing-soon"] || [],
      activeTrialSubscriptions: byStatus["trial-active"] || [],
      recentPriceChanges,
      scanDate: now,
    };
  }

  /**
   * Tracks free trial expiries, computes days remaining, assigns urgency scores,
   * and surfaces cancellation URLs.
   *
   * Requirement 7.1: Create trial record with start date, end date, conversion amount, auto-conversion flag
   * Requirement 7.2: Compute days remaining until expiry
   * Requirement 7.3: Auto-converts to paid plan >$20/month → urgency 9
   * Requirement 7.4: Expires within 48 hours → urgency 10
   * Requirement 7.6: Store and surface cancellation URL from original trial email
   */
  async trackTrialExpiries(): Promise<TrialExpiryResult> {
    const now = new Date();

    // Query active trials from the store
    const activeTrials = await this.store.getActiveTrials();

    // Update days remaining and status transitions for each trial
    const updatedTrials: TrialRecord[] = [];
    for (const trial of activeTrials) {
      const updated = this.updateTrialStatus(trial, now);
      // Persist the updated trial back to the store
      await this.store.insertTrial(updated);
      updatedTrials.push(updated);
    }

    // Filter trials expiring within 7 days
    const expiringSoon = updatedTrials.filter(
      (trial) => trial.daysRemaining <= TRIAL_EXPIRING_SOON_DAYS && trial.daysRemaining > 0
    );

    // Filter trials expiring within 48 hours
    const urgentTrials = updatedTrials.filter((trial) => {
      const hoursRemaining = this.hoursUntilExpiry(trial.trialEndDate, now);
      return hoursRemaining <= TRIAL_URGENT_HOURS && hoursRemaining > 0;
    });

    // Calculate total potential charges from auto-converting trials
    const totalPotentialCharges = updatedTrials
      .filter((trial) => trial.autoConverts && trial.convertsToAmount !== null)
      .reduce((sum, trial) => {
        const monthlyAmount = this.trialConversionToMonthly(trial);
        return sum + monthlyAmount;
      }, 0);

    // Compute urgency scores for all active trials
    const trialsByUrgency = updatedTrials
      .map((trial) => ({
        trial,
        urgencyScore: this.computeTrialUrgency(trial, now),
      }))
      .sort((a, b) => b.urgencyScore - a.urgencyScore);

    return {
      activeTrials: updatedTrials,
      expiringSoon,
      urgentTrials,
      totalPotentialCharges: Math.round(totalPotentialCharges * 100) / 100,
      trialsByUrgency,
    };
  }

  /**
   * Updates a trial's status and days remaining based on the current date.
   * Handles status transitions: active → expiring_soon → expired → cancelled
   *
   * Requirement 7.2: Compute days remaining until expiry
   */
  updateTrialStatus(trial: TrialRecord, referenceDate?: Date): TrialRecord {
    const now = referenceDate ?? new Date();
    const endDate =
      trial.trialEndDate instanceof Date
        ? trial.trialEndDate
        : new Date(trial.trialEndDate);

    const daysRemaining = this.daysBetween(now, endDate);
    const hoursRemaining = this.hoursUntilExpiry(endDate, now);

    // Determine status transition
    let status = trial.status;

    if (status === "cancelled") {
      // Cancelled stays cancelled
      return { ...trial, daysRemaining: Math.max(0, daysRemaining) };
    }

    if (daysRemaining <= 0) {
      status = "expired";
    } else if (hoursRemaining <= TRIAL_URGENT_HOURS || daysRemaining <= TRIAL_EXPIRING_SOON_DAYS) {
      status = "expiring_soon";
    } else {
      status = "active";
    }

    return {
      ...trial,
      daysRemaining: Math.max(0, daysRemaining),
      status,
    };
  }

  /**
   * Computes the urgency score for a trial.
   *
   * Requirement 7.3: Auto-converts to paid plan >$20/month → urgency 9
   * Requirement 7.4: Expires within 48 hours → urgency 10
   */
  computeTrialUrgency(trial: TrialRecord, referenceDate?: Date): number {
    const now = referenceDate ?? new Date();
    const hoursRemaining = this.hoursUntilExpiry(trial.trialEndDate, now);

    // Requirement 7.4: Expires within 48 hours → urgency 10
    if (hoursRemaining <= TRIAL_URGENT_HOURS && hoursRemaining > 0) {
      return 10;
    }

    // Requirement 7.3: Auto-converts to paid plan >$20/month → urgency 9
    if (trial.autoConverts && trial.convertsToAmount !== null) {
      const monthlyAmount = this.trialConversionToMonthly(trial);
      if (monthlyAmount > TRIAL_HIGH_COST_THRESHOLD) {
        return 9;
      }
    }

    // Already expired
    if (hoursRemaining <= 0) {
      return 0;
    }

    // Expiring within 7 days with auto-conversion
    if (trial.daysRemaining <= TRIAL_EXPIRING_SOON_DAYS && trial.autoConverts) {
      return 7;
    }

    // Expiring within 7 days without auto-conversion
    if (trial.daysRemaining <= TRIAL_EXPIRING_SOON_DAYS) {
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
   * Converts a trial's conversion amount to its monthly equivalent.
   */
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

  /**
   * Computes hours remaining until a trial expires.
   */
  private hoursUntilExpiry(endDate: Date, now: Date): number {
    const end = endDate instanceof Date ? endDate : new Date(endDate);
    const nowTime = now instanceof Date ? now : new Date(now);
    return (end.getTime() - nowTime.getTime()) / (1000 * 60 * 60);
  }

  /**
   * Classifies the status of a subscription based on engagement signals,
   * price changes, renewal dates, trial status, and cancellation.
   *
   * Requirement 4.2: Classify as zombie when no engagement for 60+ days
   * Requirement 4.3: Detect price changes between invoice cycles
   * Requirement 4.5: Assign status (active-used, active-unused, zombie,
   *   price-increased, renewing-soon, trial-active, cancelled, unknown)
   */
  classifySubscriptionStatus(
    sub: SubscriptionRecord,
    messages: AnalyzedMessage[],
    referenceDate?: Date
  ): SubscriptionRecord {
    const now = referenceDate ?? new Date();
    const status = this.determineStatus(sub, messages, now);

    return {
      ...sub,
      status,
      updatedAt: now,
    };
  }

  /**
   * Determines the subscription status based on multiple signals.
   * Priority order:
   * 1. cancelled (explicit cancellation)
   * 2. trial-active (has active trial)
   * 3. price-increased (recent price change detected)
   * 4. renewing-soon (renewal within 30 days)
   * 5. zombie (no engagement for 60+ days)
   * 6. active-used (has engagement signals)
   * 7. active-unused (active but low engagement)
   * 8. unknown (insufficient data)
   */
  private determineStatus(
    sub: SubscriptionRecord,
    messages: AnalyzedMessage[],
    now: Date
  ): SubscriptionStatus {
    // Check if cancelled
    if (sub.status === "cancelled") {
      return "cancelled";
    }

    // Check if trial is active
    if (sub.trialEndsDate && sub.trialEndsDate > now) {
      return "trial-active";
    }

    // Check for recent price increase
    if (this.hasRecentPriceIncrease(sub, now)) {
      return "price-increased";
    }

    // Check if renewing soon (within 30 days)
    if (this.isRenewingSoon(sub, now)) {
      return "renewing-soon";
    }

    // Check engagement for zombie/active classification
    const daysSinceLastEngagement = this.getDaysSinceLastEngagement(
      sub,
      messages,
      now
    );

    // Zombie: no engagement for 60+ days
    if (daysSinceLastEngagement >= ZOMBIE_NO_ENGAGEMENT_DAYS) {
      return "zombie";
    }

    // Active with engagement
    if (sub.usageScore > 3) {
      return "active-used";
    }

    // Active but low/no usage
    if (sub.usageScore > 0) {
      return "active-unused";
    }

    // If we have recent messages from the vendor, it's active-unused
    if (daysSinceLastEngagement < ZOMBIE_NO_ENGAGEMENT_DAYS) {
      return "active-unused";
    }

    return "unknown";
  }

  /**
   * Checks if a subscription has had a price increase in the last 90 days.
   *
   * Requirement 4.3: Detect price changes between invoice cycles
   */
  private hasRecentPriceIncrease(sub: SubscriptionRecord, now: Date): boolean {
    if (sub.priceChangeHistory.length === 0) {
      return false;
    }

    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    return sub.priceChangeHistory.some((change) => {
      const changeDate =
        change.detectedDate instanceof Date
          ? change.detectedDate
          : new Date(change.detectedDate);
      return changeDate >= ninetyDaysAgo && change.newAmount > change.previousAmount;
    });
  }

  /**
   * Checks if a subscription is renewing within the configured lead time.
   */
  private isRenewingSoon(sub: SubscriptionRecord, now: Date): boolean {
    if (!sub.nextRenewalDate) {
      return false;
    }

    const renewalDate =
      sub.nextRenewalDate instanceof Date
        ? sub.nextRenewalDate
        : new Date(sub.nextRenewalDate);

    const daysUntilRenewal = this.daysBetween(now, renewalDate);
    return daysUntilRenewal >= 0 && daysUntilRenewal <= RENEWING_SOON_DAYS;
  }

  /**
   * Computes the number of days since the last engagement signal from a vendor.
   *
   * Requirement 4.2: No email engagement signals for 60+ days → zombie
   */
  private getDaysSinceLastEngagement(
    sub: SubscriptionRecord,
    messages: AnalyzedMessage[],
    now: Date
  ): number {
    // Find messages from this vendor's domain
    const vendorMessages = messages.filter(
      (msg) =>
        msg.senderDomain.toLowerCase() === sub.vendorDomain.toLowerCase()
    );

    if (vendorMessages.length === 0) {
      // No messages at all — use firstSeenDate as baseline
      return this.daysBetween(sub.firstSeenDate, now);
    }

    // Find the most recent message with usage indicators
    let lastEngagementDate: Date | null = null;

    for (const msg of vendorMessages) {
      if (msg.usageIndicators.length > 0) {
        const msgDate =
          msg.timestamp instanceof Date
            ? msg.timestamp
            : new Date(msg.timestamp);
        if (!lastEngagementDate || msgDate > lastEngagementDate) {
          lastEngagementDate = msgDate;
        }
      }
    }

    // If no engagement signals found, use the most recent message date
    if (!lastEngagementDate) {
      let lastMessageDate: Date = sub.firstSeenDate;
      for (const msg of vendorMessages) {
        const msgDate =
          msg.timestamp instanceof Date
            ? msg.timestamp
            : new Date(msg.timestamp);
        if (msgDate > lastMessageDate) {
          lastMessageDate = msgDate;
        }
      }
      return this.daysBetween(lastMessageDate, now);
    }

    return this.daysBetween(lastEngagementDate, now);
  }

  /**
   * Detects price changes between invoice cycles and calculates percentage change.
   *
   * Requirement 4.3: Record previous amount, new amount, percentage change,
   *   and detection date in the subscription price change history
   */
  detectPriceChange(
    currentAmount: number,
    previousAmount: number,
    detectedDate: Date,
    sourceMessageId: string
  ): PriceChange | null {
    if (currentAmount === previousAmount || previousAmount <= 0) {
      return null;
    }

    const percentageChange =
      ((currentAmount - previousAmount) / previousAmount) * 100;

    return {
      previousAmount,
      newAmount: currentAmount,
      detectedDate,
      percentageChange: Math.round(percentageChange * 100) / 100,
      sourceMessageId,
    };
  }

  /**
   * Classifies a subscription into one of the defined categories.
   *
   * Requirement 4.4: Classify each subscription into defined categories
   */
  classifyCategory(
    vendor: string,
    vendorDomain: string,
    existingCategory?: SubscriptionCategory
  ): SubscriptionCategory {
    // If already classified, return existing
    if (existingCategory && existingCategory !== "other") {
      return existingCategory;
    }

    // Domain-based classification
    const domain = vendorDomain.toLowerCase();
    const vendorLower = vendor.toLowerCase();

    // Music streaming
    if (
      this.matchesAny(domain, vendorLower, [
        "spotify",
        "apple music",
        "tidal",
        "deezer",
        "pandora",
        "soundcloud",
        "youtube music",
        "amazon music",
      ])
    ) {
      return "music-streaming";
    }

    // Video streaming
    if (
      this.matchesAny(domain, vendorLower, [
        "netflix",
        "hulu",
        "disney",
        "hbo",
        "paramount",
        "peacock",
        "prime video",
        "crunchyroll",
        "youtube premium",
        "apple tv",
      ])
    ) {
      return "video-streaming";
    }

    // Productivity
    if (
      this.matchesAny(domain, vendorLower, [
        "notion",
        "slack",
        "asana",
        "trello",
        "monday",
        "todoist",
        "evernote",
        "microsoft 365",
        "google workspace",
        "linear",
        "clickup",
        "basecamp",
      ])
    ) {
      return "productivity";
    }

    // Gaming (check before cloud-storage to avoid "xbox" matching "box")
    if (
      this.matchesAny(domain, vendorLower, [
        "xbox",
        "playstation",
        "nintendo",
        "steam",
        "epic games",
        "ea play",
        "game pass",
        "twitch",
      ])
    ) {
      return "gaming";
    }

    // Cloud storage
    if (
      this.matchesAny(domain, vendorLower, [
        "dropbox",
        "google one",
        "icloud",
        "onedrive",
        "backblaze",
        "mega",
      ]) ||
      domain === "box.com" ||
      vendorLower === "box"
    ) {
      return "cloud-storage";
    }

    // Fitness
    if (
      this.matchesAny(domain, vendorLower, [
        "peloton",
        "strava",
        "fitbit",
        "myfitnesspal",
        "headspace",
        "calm",
        "noom",
        "whoop",
      ])
    ) {
      return "fitness";
    }

    // News & media
    if (
      this.matchesAny(domain, vendorLower, [
        "nytimes",
        "wsj",
        "washington post",
        "medium",
        "substack",
        "economist",
        "bloomberg",
        "reuters",
        "atlantic",
      ])
    ) {
      return "news-media";
    }

    // Software/SaaS
    if (
      this.matchesAny(domain, vendorLower, [
        "github",
        "gitlab",
        "figma",
        "adobe",
        "canva",
        "vercel",
        "aws",
        "heroku",
        "digitalocean",
        "jetbrains",
        "cursor",
        "copilot",
        "anthropic",
        "openai",
        "datadog",
        "sentry",
        "postman",
      ])
    ) {
      return "software-saas";
    }

    // Security/VPN
    if (
      this.matchesAny(domain, vendorLower, [
        "nordvpn",
        "expressvpn",
        "1password",
        "lastpass",
        "bitwarden",
        "dashlane",
        "surfshark",
        "proton",
        "mullvad",
      ])
    ) {
      return "security-vpn";
    }

    // Food delivery
    if (
      this.matchesAny(domain, vendorLower, [
        "doordash",
        "uber eats",
        "grubhub",
        "instacart",
        "hellofresh",
        "blue apron",
        "postmates",
      ])
    ) {
      return "food-delivery";
    }

    // Education
    if (
      this.matchesAny(domain, vendorLower, [
        "coursera",
        "udemy",
        "skillshare",
        "masterclass",
        "duolingo",
        "brilliant",
        "khan academy",
        "pluralsight",
        "linkedin learning",
      ])
    ) {
      return "education";
    }

    // Utilities
    if (
      this.matchesAny(domain, vendorLower, [
        "electric",
        "gas",
        "water",
        "internet",
        "phone",
        "mobile",
        "comcast",
        "verizon",
        "at&t",
        "t-mobile",
      ])
    ) {
      return "utilities";
    }

    // Insurance
    if (
      this.matchesAny(domain, vendorLower, [
        "geico",
        "state farm",
        "allstate",
        "progressive",
        "lemonade",
        "insurance",
      ])
    ) {
      return "insurance";
    }

    return "other";
  }

  // ─── Smart Savings & Negotiation Engine ──────────────────────────────────────

  /**
   * Generates savings recommendations by detecting redundant subscriptions
   * in the same functional category and ranking by annual savings descending.
   *
   * Requirement 6.1: Detect redundancy when 2+ active subscriptions in same category
   * Requirement 6.4: Compute total potential monthly and annual savings
   * Requirement 6.5: Make one-click draft available
   * Requirement 6.6: Rank by annual savings descending
   */
  async generateSavingsRecommendations(): Promise<SavingsResult> {
    const activeSubscriptions = await this.store.getActiveSubscriptions();
    const recommendations: SavingsRecommendation[] = [];

    // Detect redundancy by functional category (Req 6.1)
    const byCategory = this.groupByCategory(activeSubscriptions);

    for (const [category, subs] of Object.entries(byCategory)) {
      if (subs.length < 2) continue;

      // Sort by usage score descending — recommend cancelling the lower-scored ones
      const sorted = [...subs].sort((a, b) => b.usageScore - a.usageScore);

      // For each pair, recommend cancelling the lower usage one
      for (let i = 1; i < sorted.length; i++) {
        const keeper = sorted[0];
        const candidate = sorted[i];
        const monthlyAmount = this.toMonthlyAmount(candidate);
        const annualSavings = monthlyAmount * 12;

        recommendations.push({
          id: `savings-redundancy-${candidate.id}`,
          type: "redundancy",
          vendor: candidate.vendor,
          category: category as SubscriptionCategory,
          currentMonthlyAmount: monthlyAmount,
          estimatedMonthlySavings: monthlyAmount,
          estimatedAnnualSavings: Math.round(annualSavings * 100) / 100,
          reason: `Redundant with ${keeper.vendor} in ${category}. ${keeper.vendor} has higher usage (score: ${keeper.usageScore} vs ${candidate.usageScore}).`,
          confidence: candidate.usageScore <= 3 ? "high" : "medium",
          draftAvailable: true,
          relatedSubscriptionIds: [keeper.id, candidate.id],
        });
      }
    }

    // Generate negotiation opportunities
    const negotiationOpportunities = await this.generateNegotiationOpportunities();

    // Add negotiation-based savings recommendations
    for (const opp of negotiationOpportunities) {
      recommendations.push({
        id: `savings-negotiation-${opp.id}`,
        type: "negotiation",
        vendor: opp.vendor,
        category: this.getCategoryForVendor(activeSubscriptions, opp.vendor),
        currentMonthlyAmount: opp.currentAmount,
        estimatedMonthlySavings: opp.estimatedSavings,
        estimatedAnnualSavings: Math.round(opp.estimatedSavings * 12 * 100) / 100,
        reason: opp.context,
        confidence: opp.confidence,
        draftAvailable: true,
        relatedSubscriptionIds: [],
      });
    }

    // Rank by annual savings descending (Req 6.6)
    recommendations.sort((a, b) => b.estimatedAnnualSavings - a.estimatedAnnualSavings);

    // Compute totals (Req 6.4)
    const totalPotentialMonthlySavings = Math.round(
      recommendations.reduce((sum, r) => sum + r.estimatedMonthlySavings, 0) * 100
    ) / 100;
    const totalPotentialAnnualSavings = Math.round(
      recommendations.reduce((sum, r) => sum + r.estimatedAnnualSavings, 0) * 100
    ) / 100;

    return {
      recommendations,
      negotiationOpportunities,
      totalPotentialMonthlySavings,
      totalPotentialAnnualSavings,
    };
  }

  /**
   * Generates negotiation opportunities triggered by:
   * - Price increases (Req 6.2)
   * - Competitor pricing (Req 6.3)
   * - Long tenure (12+ months)
   * - Low usage
   *
   * Factors in user tenure for negotiation leverage scoring.
   */
  async generateNegotiationOpportunities(): Promise<NegotiationOpportunity[]> {
    const activeSubscriptions = await this.store.getActiveSubscriptions();
    const opportunities: NegotiationOpportunity[] = [];
    const now = new Date();

    for (const sub of activeSubscriptions) {
      const tenure = this.computeTenureMonths(sub.firstSeenDate, now);

      // Trigger 1: Price increase (Req 6.2)
      if (sub.priceChangeHistory.length > 0) {
        const latestChange = sub.priceChangeHistory[sub.priceChangeHistory.length - 1];
        if (latestChange.newAmount > latestChange.previousAmount) {
          const estimatedSavings = latestChange.newAmount - latestChange.previousAmount;
          opportunities.push({
            id: `neg-price-${sub.id}`,
            vendor: sub.vendor,
            reason: "price_increase",
            currentAmount: sub.amount,
            targetAmount: latestChange.previousAmount,
            estimatedSavings: Math.round(estimatedSavings * 100) / 100,
            confidence: tenure >= 12 ? "high" : "medium",
            context: `${sub.vendor} increased price from $${latestChange.previousAmount} to $${latestChange.newAmount} (${latestChange.percentageChange.toFixed(1)}% increase). You've been a customer for ${tenure} months.`,
            draftAvailable: true,
            tenure,
          });
        }
      }

      // Trigger 2: Competitor cheaper (Req 6.3)
      const competitors = this.findCheaperCompetitors(sub, activeSubscriptions);
      for (const competitor of competitors) {
        const competitorMonthly = this.toMonthlyAmount(competitor);
        const subMonthly = this.toMonthlyAmount(sub);
        const estimatedSavings = subMonthly - competitorMonthly;

        if (estimatedSavings > 0) {
          opportunities.push({
            id: `neg-competitor-${sub.id}-${competitor.id}`,
            vendor: sub.vendor,
            reason: "competitor_cheaper",
            currentAmount: subMonthly,
            targetAmount: competitorMonthly,
            estimatedSavings: Math.round(estimatedSavings * 100) / 100,
            confidence: "medium",
            context: `${competitor.vendor} offers similar service in ${sub.category} for $${competitorMonthly.toFixed(2)}/mo vs your $${subMonthly.toFixed(2)}/mo with ${sub.vendor}.`,
            draftAvailable: true,
            tenure,
          });
        }
      }

      // Trigger 3: Long tenure discount (12+ months)
      if (tenure >= 12 && !this.hasExistingOpportunity(opportunities, sub.id, "long_tenure_discount")) {
        const estimatedSavings = Math.round(this.toMonthlyAmount(sub) * 0.15 * 100) / 100; // estimate 15% discount
        opportunities.push({
          id: `neg-tenure-${sub.id}`,
          vendor: sub.vendor,
          reason: "long_tenure_discount",
          currentAmount: this.toMonthlyAmount(sub),
          targetAmount: Math.round((this.toMonthlyAmount(sub) * 0.85) * 100) / 100,
          estimatedSavings,
          confidence: tenure >= 24 ? "high" : "medium",
          context: `You've been subscribed to ${sub.vendor} for ${tenure} months. Long-term customers often qualify for loyalty discounts.`,
          draftAvailable: true,
          tenure,
        });
      }

      // Trigger 4: Low usage
      if (sub.usageScore <= 3 && sub.usageScore >= 0) {
        const monthlyAmount = this.toMonthlyAmount(sub);
        const estimatedSavings = Math.round(monthlyAmount * 0.5 * 100) / 100; // estimate 50% downgrade savings
        opportunities.push({
          id: `neg-usage-${sub.id}`,
          vendor: sub.vendor,
          reason: "usage_low",
          currentAmount: monthlyAmount,
          targetAmount: Math.round(monthlyAmount * 0.5 * 100) / 100,
          estimatedSavings,
          confidence: sub.usageScore <= 1 ? "high" : "medium",
          context: `Your usage of ${sub.vendor} is low (score: ${sub.usageScore}/10). Consider negotiating a lower tier or cancelling.`,
          draftAvailable: true,
          tenure,
        });
      }
    }

    return opportunities;
  }

  /**
   * Computes the number of months between the first seen date and now.
   */
  private computeTenureMonths(firstSeenDate: Date, now: Date): number {
    const start = firstSeenDate instanceof Date ? firstSeenDate : new Date(firstSeenDate);
    const months =
      (now.getFullYear() - start.getFullYear()) * 12 +
      (now.getMonth() - start.getMonth());
    return Math.max(0, months);
  }

  /**
   * Finds subscriptions in the same category that are cheaper than the given subscription.
   * Used for competitor pricing comparison (Req 6.3).
   */
  private findCheaperCompetitors(
    sub: SubscriptionRecord,
    allSubscriptions: SubscriptionRecord[]
  ): SubscriptionRecord[] {
    const subMonthly = this.toMonthlyAmount(sub);
    return allSubscriptions.filter(
      (other) =>
        other.id !== sub.id &&
        other.category === sub.category &&
        this.toMonthlyAmount(other) < subMonthly
    );
  }

  /**
   * Checks if an opportunity already exists for a given subscription and reason.
   */
  private hasExistingOpportunity(
    opportunities: NegotiationOpportunity[],
    subId: string,
    reason: NegotiationReason
  ): boolean {
    return opportunities.some(
      (opp) => opp.id.includes(subId) && opp.reason === reason
    );
  }

  /**
   * Gets the category for a vendor from the active subscriptions list.
   */
  private getCategoryForVendor(
    subscriptions: SubscriptionRecord[],
    vendor: string
  ): SubscriptionCategory {
    const sub = subscriptions.find((s) => s.vendor === vendor);
    return sub?.category ?? "other";
  }

  // ─── Feature 5: Annual vs Monthly Optimizer ─────────────────────────────────

  /**
   * Identifies monthly subscriptions with annual plan alternatives and
   * calculates potential savings from switching.
   *
   * Requirement 8.1: Calculate monthly equivalent of annual plan and resulting savings
   * Requirement 8.2: Compute break-even point in months for switching
   * Requirement 8.3: Recommend switching with high confidence for 6+ months with stable usage
   * Requirement 8.4: Recommend waiting for subscriptions held fewer than 6 months
   * Requirement 8.5: Compute total annual savings across all eligible subscriptions
   * Requirement 8.6: Extract annual plan offer from vendor email and flag as available
   */
  async findBillingOptimizations(): Promise<BillingOptimization[]> {
    const now = new Date();
    const activeSubscriptions = await this.store.getActiveSubscriptions();

    const optimizations: BillingOptimization[] = [];

    for (const sub of activeSubscriptions) {
      // Only consider monthly subscriptions with annual plan available
      if (sub.billingFrequency !== "monthly" || !sub.annualPlanAvailable || !sub.annualPlanAmount) {
        continue;
      }

      const optimization = this.computeBillingOptimization(sub, now);
      if (optimization) {
        optimizations.push(optimization);
      }
    }

    // Sort by annual savings descending
    return optimizations.sort((a, b) => b.annualSavings - a.annualSavings);
  }

  /**
   * Computes a billing optimization for a single subscription.
   * Calculates savings, break-even point, and generates a recommendation.
   */
  private computeBillingOptimization(
    sub: SubscriptionRecord,
    now: Date
  ): BillingOptimization | null {
    if (!sub.annualPlanAmount || sub.annualPlanAmount <= 0) {
      return null;
    }

    const currentMonthlyAmount = sub.amount;
    const annualPlanTotalAmount = sub.annualPlanAmount;

    // Req 8.1: Calculate monthly equivalent of annual plan
    const annualPlanMonthlyEquivalent = Math.round((annualPlanTotalAmount / 12) * 100) / 100;

    // Only recommend if annual plan is actually cheaper per month
    if (annualPlanMonthlyEquivalent >= currentMonthlyAmount) {
      return null;
    }

    // Req 8.1: Calculate resulting savings
    const monthlySavings = Math.round((currentMonthlyAmount - annualPlanMonthlyEquivalent) * 100) / 100;
    const annualSavings = Math.round((currentMonthlyAmount * 12 - annualPlanTotalAmount) * 100) / 100;
    const percentageSaved = Math.round((monthlySavings / currentMonthlyAmount) * 100 * 100) / 100;

    // Req 8.2: Compute break-even point
    // Break-even = annual cost / monthly cost (how many months of monthly billing
    // equals the upfront annual cost)
    const breakEvenMonths = Math.ceil(annualPlanTotalAmount / currentMonthlyAmount);

    // Calculate months subscribed
    const firstSeenDate = sub.firstSeenDate instanceof Date
      ? sub.firstSeenDate
      : new Date(sub.firstSeenDate);
    const monthsSubscribed = this.monthsBetween(firstSeenDate, now);

    // Req 8.3 & 8.4: Determine confidence and recommendation
    const { recommendation, confidence } = this.generateBillingRecommendation(
      sub.vendor,
      monthsSubscribed,
      sub.usageScore,
      monthlySavings,
      annualSavings
    );

    return {
      id: `billing-opt-${sub.id}`,
      vendor: sub.vendor,
      currentFrequency: "monthly",
      currentMonthlyAmount,
      annualPlanMonthlyEquivalent,
      annualPlanTotalAmount,
      monthlySavings,
      annualSavings,
      percentageSaved,
      breakEvenMonths,
      monthsSubscribed,
      recommendation,
      confidence,
    };
  }

  /**
   * Generates a recommendation and confidence level for a billing optimization.
   *
   * Requirement 8.3: High confidence when held 6+ months with stable usage
   * Requirement 8.4: Recommend waiting when held fewer than 6 months
   */
  private generateBillingRecommendation(
    vendor: string,
    monthsSubscribed: number,
    usageScore: number,
    monthlySavings: number,
    annualSavings: number
  ): { recommendation: string; confidence: "high" | "medium" | "low" } {
    // Req 8.4: Fewer than 6 months — recommend waiting
    if (monthsSubscribed < 6) {
      return {
        recommendation: `You've had ${vendor} for ${monthsSubscribed} month${monthsSubscribed === 1 ? "" : "s"}. Consider waiting until you've used it longer before committing to annual billing.`,
        confidence: "low",
      };
    }

    // Req 8.3: 6+ months with stable usage (usageScore > 3 indicates stable usage)
    if (usageScore > 3) {
      return {
        recommendation: `You've had ${vendor} for ${monthsSubscribed} months. Switching to annual saves $${annualSavings.toFixed(2)}/year.`,
        confidence: "high",
      };
    }

    // 6+ months but low/unstable usage — medium confidence
    return {
      recommendation: `You've had ${vendor} for ${monthsSubscribed} months but usage is low. Switching to annual would save $${annualSavings.toFixed(2)}/year, but consider if you'll keep using it.`,
      confidence: "medium",
    };
  }

  /**
   * Calculates the number of months between two dates.
   */
  private monthsBetween(start: Date, end: Date): number {
    const startTime = start instanceof Date ? start : new Date(start);
    const endTime = end instanceof Date ? end : new Date(end);
    const months =
      (endTime.getFullYear() - startTime.getFullYear()) * 12 +
      (endTime.getMonth() - startTime.getMonth());
    return Math.max(0, months);
  }

  // ─── Feature 7: Refund & Credit Tracker ─────────────────────────────────────

  /**
   * Tracks refunds and credits by querying pending and overdue refunds,
   * setting expected-by dates, marking overdue refunds, and computing totals.
   *
   * Requirement 10.1: Create refund record with status processing or received
   * Requirement 10.2: Set expected-by date to 14 days from promise date when no specific date given
   * Requirement 10.3: Mark refund as overdue when not confirmed within 14 days of expected date
   * Requirement 10.5: Update refund record with actual received date when confirmed
   * Requirement 10.6: Track total amount of pending and overdue refunds
   */
  async trackRefundsAndCredits(): Promise<RefundTrackingResult> {
    const now = new Date();

    // Query pending and overdue refunds from the entity store
    const pendingRefunds = await this.store.getPendingRefunds();
    const existingOverdueRefunds = await this.store.getOverdueRefunds();

    // Process pending refunds: check if any should be marked overdue
    const stillPending: RefundRecord[] = [];
    const newlyOverdue: RefundRecord[] = [];

    for (const refund of pendingRefunds) {
      // Requirement 10.2: Set expected-by date to 14 days from promise date when no specific date given
      const updatedRefund = this.ensureExpectedByDate(refund);

      // Requirement 10.3: Mark as overdue when not confirmed within 14 days of expected date
      if (this.isRefundOverdue(updatedRefund, now)) {
        const overdueRefund: RefundRecord = {
          ...updatedRefund,
          status: "overdue",
          daysOverdue: this.computeRefundDaysOverdue(updatedRefund.expectedByDate, now),
        };
        newlyOverdue.push(overdueRefund);
        // Persist the status change
        await this.store.insertRefund(overdueRefund);
      } else {
        stillPending.push(updatedRefund);
      }
    }

    // Update days overdue for existing overdue refunds
    const updatedOverdueRefunds: RefundRecord[] = [];
    for (const refund of existingOverdueRefunds) {
      const updated: RefundRecord = {
        ...refund,
        daysOverdue: this.computeRefundDaysOverdue(refund.expectedByDate, now),
      };
      updatedOverdueRefunds.push(updated);
      // Persist updated days overdue
      await this.store.insertRefund(updated);
    }

    // Combine all overdue refunds (existing + newly overdue)
    const allOverdueRefunds = [...updatedOverdueRefunds, ...newlyOverdue];

    // Requirement 10.6: Track total pending and overdue amounts
    const totalPendingAmount = Math.round(
      stillPending.reduce((sum, r) => sum + r.amount, 0) * 100
    ) / 100;

    const totalOverdueAmount = Math.round(
      allOverdueRefunds.reduce((sum, r) => sum + r.amount, 0) * 100
    ) / 100;

    return {
      pendingRefunds: stillPending,
      overdueRefunds: allOverdueRefunds,
      totalPendingAmount,
      totalOverdueAmount,
      totalTrackedRefunds: stillPending.length + allOverdueRefunds.length,
    };
  }

  /**
   * Ensures a refund has an expected-by date set.
   * If no specific expected date is given, sets it to 14 days from the promise date.
   *
   * Requirement 10.2: Set expected-by date to 14 days from promise date when no specific date given
   */
  private ensureExpectedByDate(refund: RefundRecord): RefundRecord {
    // If expectedByDate is already set and valid, return as-is
    if (refund.expectedByDate) {
      return refund;
    }

    // Set expected-by to 14 days from promise date
    const promiseDate = refund.promisedDate ?? new Date();
    const expectedByDate = new Date(promiseDate);
    expectedByDate.setDate(expectedByDate.getDate() + REFUND_EXPECTED_DAYS);

    return {
      ...refund,
      expectedByDate,
    };
  }

  /**
   * Determines if a refund is overdue.
   * A refund is overdue when not confirmed within 14 days of the expected date.
   *
   * Requirement 10.3: Mark refund as overdue when not confirmed within 14 days of expected date
   */
  private isRefundOverdue(refund: RefundRecord, now: Date): boolean {
    if (refund.status === "received" || refund.status === "disputed") {
      return false;
    }

    const expectedByDate = refund.expectedByDate instanceof Date
      ? refund.expectedByDate
      : new Date(refund.expectedByDate);

    // Overdue when current date exceeds expected date + 14 days grace period
    const overdueThreshold = new Date(expectedByDate);
    overdueThreshold.setDate(overdueThreshold.getDate() + REFUND_OVERDUE_GRACE_DAYS);

    return now > overdueThreshold;
  }

  /**
   * Computes the number of days a refund is overdue past its expected date.
   */
  private computeRefundDaysOverdue(expectedByDate: Date, now: Date): number {
    const expected = expectedByDate instanceof Date
      ? expectedByDate
      : new Date(expectedByDate);

    const overdueThreshold = new Date(expected);
    overdueThreshold.setDate(overdueThreshold.getDate() + REFUND_OVERDUE_GRACE_DAYS);

    const daysOverdue = this.daysBetween(overdueThreshold, now);
    return Math.max(0, daysOverdue);
  }

  // ─── Feature 9: Renewal & Deadline Reminders ─────────────────────────────────

  /**
   * Computes upcoming renewal dates for all active subscriptions and surfaces
   * them with configurable lead-time alerts. Also flags auto-renewal clauses
   * the user did not explicitly opt into, and generates a unified financial
   * calendar with all upcoming charges, renewals, deadlines, trial expiries,
   * and refund expected dates.
   *
   * Requirement 12.1: Compute upcoming renewal dates with configurable lead-time
   *   alerts defaulting to [30, 7, 3, 1] days before renewal
   * Requirement 12.2: Flag auto-renewal clauses the user did not explicitly opt into
   * Requirement 12.3: Generate unified Financial Calendar containing all upcoming
   *   charges, renewals, contract deadlines, trial expiries, and refund expected dates
   */
  async computeUpcomingRenewals(
    leadTimeDays: number[] = [30, 7, 3, 1]
  ): Promise<RenewalAlert[]> {
    const now = new Date();

    // Sort lead times descending so we can determine the max look-ahead window
    const sortedLeadTimes = [...leadTimeDays].sort((a, b) => b - a);
    const maxLeadDays = sortedLeadTimes.length > 0 ? sortedLeadTimes[0] : 30;

    // Get all active subscriptions
    const activeSubscriptions = await this.store.getActiveSubscriptions();

    const alerts: RenewalAlert[] = [];

    for (const sub of activeSubscriptions) {
      // Skip subscriptions without a renewal date
      if (!sub.nextRenewalDate) {
        continue;
      }

      const renewalDate =
        sub.nextRenewalDate instanceof Date
          ? sub.nextRenewalDate
          : new Date(sub.nextRenewalDate);

      const daysUntilRenewal = this.daysBetween(now, renewalDate);

      // Only include subscriptions renewing within the max lead-time window
      if (daysUntilRenewal < 0 || daysUntilRenewal > maxLeadDays) {
        continue;
      }

      // Determine which lead-time alerts apply (Req 12.1)
      const applicableLeadTimeAlerts = sortedLeadTimes.filter(
        (leadDays) => daysUntilRenewal <= leadDays
      );

      // Flag auto-renewal if user did not explicitly opt in (Req 12.2)
      // We flag auto-renewal when the subscription auto-renews — the assumption
      // is that unless the user explicitly opted in, auto-renewal should be flagged
      const autoRenewalFlagged = sub.autoRenews;

      alerts.push({
        id: `renewal-alert-${sub.id}`,
        vendor: sub.vendor,
        vendorDomain: sub.vendorDomain,
        amount: sub.amount,
        currency: sub.currency,
        renewalDate,
        daysUntilRenewal,
        autoRenews: sub.autoRenews,
        autoRenewalFlagged,
        applicableLeadTimeAlerts,
        billingFrequency: sub.billingFrequency,
        category: sub.category,
        subscriptionId: sub.id,
      });
    }

    // Sort by days until renewal ascending (most urgent first)
    return alerts.sort((a, b) => a.daysUntilRenewal - b.daysUntilRenewal);
  }

  /**
   * Generates a unified financial calendar containing all upcoming charges,
   * renewals, contract deadlines, trial expiries, and refund expected dates.
   *
   * Requirement 12.3: Generate unified Financial_Calendar
   */
  async generateFinancialCalendar(daysAhead: number = 30): Promise<FinancialCalendarResult> {
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + daysAhead);

    const range: DateRange = { start: now, end };

    // Use the entity store's getFinancialCalendar which aggregates all event types
    const entries = await this.store.getFinancialCalendar(range);

    // Compute summary counts
    let totalUpcomingCharges = 0;
    let renewalCount = 0;
    let trialExpiryCount = 0;
    let deadlineCount = 0;
    let refundExpectedCount = 0;

    for (const entry of entries) {
      switch (entry.type) {
        case "renewal":
          renewalCount++;
          if (entry.amount) totalUpcomingCharges += entry.amount;
          break;
        case "payment_due":
          if (entry.amount) totalUpcomingCharges += entry.amount;
          break;
        case "trial_expiry":
          trialExpiryCount++;
          if (entry.amount) totalUpcomingCharges += entry.amount;
          break;
        case "contract_expiry":
        case "notice_deadline":
        case "commitment_due":
          deadlineCount++;
          break;
        case "refund_expected":
          refundExpectedCount++;
          break;
      }
    }

    return {
      entries,
      totalUpcomingCharges: Math.round(totalUpcomingCharges * 100) / 100,
      renewalCount,
      trialExpiryCount,
      deadlineCount,
      refundExpectedCount,
    };
  }

  // ─── Feature 8: Payment Promise Tracker ──────────────────────────────────────

  /**
   * Tracks inbound payment promises, marks overdue ones, detects fulfillment
   * by matching payment receipt emails to prior promises, and ranks overdue
   * promises by financial amount and days overdue.
   *
   * Requirement 11.1: Extract payment promises with confidence, promiser, amount, due date
   * Requirement 11.2: Extract implicit payment indications with lower confidence
   * Requirement 11.3: Mark as overdue when due date passes without payment receipt
   * Requirement 11.5: Rank overdue promises by financial amount and days overdue
   * Requirement 11.6: Detect fulfillment by matching payment receipt emails to prior promises
   */
  async trackPaymentPromises(): Promise<PaymentPromiseResult> {
    const now = new Date();

    // Query inbound payment commitments (type: "inbound", subtype: "payment_promise")
    const paymentPromises = await this.store.getPaymentPromises();

    // Filter to only inbound payment promises
    const inboundPromises = paymentPromises.filter(
      (c) => c.type === "inbound" && c.subtype === "payment_promise"
    );

    // Get messages to detect fulfillment via payment receipt emails
    const messages = await this.store.queryMessages({});
    const paymentReceipts = messages.filter((msg) =>
      msg.classifications.includes("payment_received")
    );

    const openPromises: PaymentPromiseItem[] = [];
    const overduePromises: PaymentPromiseItem[] = [];
    const fulfilledPromises: PaymentPromiseItem[] = [];

    for (const promise of inboundPromises) {
      // Requirement 11.6: Detect fulfillment by matching payment receipt emails
      // Match by counterparty (sender domain) and amount
      const isFulfilled = this.detectFulfillment(promise, paymentReceipts);

      if (isFulfilled) {
        // Mark as fulfilled in the store
        await this.store.updateCommitmentStatus(promise.id, "fulfilled");

        fulfilledPromises.push(
          this.toPaymentPromiseItem(promise, "fulfilled", 0)
        );
        continue;
      }

      // Requirement 11.3: Mark as overdue when due date passes without payment receipt
      const daysOverdue = this.computeDaysOverdue(promise, now);

      if (daysOverdue > 0) {
        // Update status to overdue in the store
        if (promise.status !== "overdue") {
          await this.store.updateCommitmentStatus(promise.id, "overdue");
        }

        overduePromises.push(
          this.toPaymentPromiseItem(promise, "overdue", daysOverdue)
        );
      } else {
        openPromises.push(
          this.toPaymentPromiseItem(promise, "open", 0)
        );
      }
    }

    // Requirement 11.5: Rank overdue promises by financial amount (desc) and days overdue (desc)
    overduePromises.sort((a, b) => {
      // Primary sort: financial amount descending
      const amountA = a.amount ?? 0;
      const amountB = b.amount ?? 0;
      if (amountB !== amountA) {
        return amountB - amountA;
      }
      // Secondary sort: days overdue descending
      return b.daysOverdue - a.daysOverdue;
    });

    // Calculate totals
    const totalOpenAmount = Math.round(
      openPromises.reduce((sum, p) => sum + (p.amount ?? 0), 0) * 100
    ) / 100;
    const totalOverdueAmount = Math.round(
      overduePromises.reduce((sum, p) => sum + (p.amount ?? 0), 0) * 100
    ) / 100;
    const totalFulfilledAmount = Math.round(
      fulfilledPromises.reduce((sum, p) => sum + (p.amount ?? 0), 0) * 100
    ) / 100;

    return {
      openPromises,
      overduePromises,
      fulfilledPromises,
      totalOpenAmount,
      totalOverdueAmount,
      totalFulfilledAmount,
    };
  }

  /**
   * Detects whether a payment promise has been fulfilled by matching
   * payment receipt emails to the promise by counterparty and amount.
   *
   * Requirement 11.6: Match payment receipt emails to prior promises
   */
  private detectFulfillment(
    promise: FinancialCommitment,
    paymentReceipts: AnalyzedMessage[]
  ): boolean {
    if (promise.status === "fulfilled") {
      return true;
    }

    for (const receipt of paymentReceipts) {
      // Match by counterparty: the sender domain of the receipt should match
      // the counterparty or owner of the promise
      const senderDomain = receipt.senderDomain.toLowerCase();
      const counterparty = promise.counterparty.toLowerCase();
      const owner = promise.owner.toLowerCase();

      const counterpartyMatch =
        counterparty.includes(senderDomain) ||
        senderDomain.includes(counterparty) ||
        owner.includes(senderDomain) ||
        senderDomain.includes(owner);

      if (!counterpartyMatch) {
        continue;
      }

      // Match by amount if both are available
      if (promise.financialValue !== null) {
        // Check if the receipt contains financial entities matching the amount
        const receiptMatchesAmount = receipt.financialEntities.some(
          (entity: any) =>
            entity.amount !== undefined &&
            Math.abs(entity.amount - (promise.financialValue ?? 0)) < 0.01
        );

        // Also check if the receipt timestamp is after the promise creation
        const receiptDate = receipt.timestamp instanceof Date
          ? receipt.timestamp
          : new Date(receipt.timestamp);
        const promiseDate = promise.createdAt instanceof Date
          ? promise.createdAt
          : new Date(promise.createdAt);

        if (receiptDate >= promiseDate) {
          // If we can verify amount, require it to match
          if (receiptMatchesAmount) {
            return true;
          }
          // If no financial entities to compare, match on counterparty + timing alone
          if (receipt.financialEntities.length === 0) {
            return true;
          }
        }
      } else {
        // No specific amount on the promise — match on counterparty + timing
        const receiptDate = receipt.timestamp instanceof Date
          ? receipt.timestamp
          : new Date(receipt.timestamp);
        const promiseDate = promise.createdAt instanceof Date
          ? promise.createdAt
          : new Date(promise.createdAt);

        if (receiptDate >= promiseDate) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Computes the number of days a payment promise is overdue.
   * Returns 0 if the promise is not yet overdue.
   */
  private computeDaysOverdue(promise: FinancialCommitment, now: Date): number {
    if (!promise.dueDate) {
      return 0;
    }

    const dueDate = promise.dueDate instanceof Date
      ? promise.dueDate
      : new Date(promise.dueDate);

    const diffMs = now.getTime() - dueDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    return Math.max(0, diffDays);
  }

  /**
   * Converts a FinancialCommitment to a PaymentPromiseItem.
   */
  private toPaymentPromiseItem(
    commitment: FinancialCommitment,
    status: "open" | "overdue" | "fulfilled",
    daysOverdue: number
  ): PaymentPromiseItem {
    return {
      commitmentId: commitment.id,
      counterparty: commitment.counterparty,
      amount: commitment.financialValue,
      currency: commitment.currency,
      dueDate: commitment.dueDate,
      status,
      daysOverdue,
      description: commitment.description,
      confidence: commitment.confidence,
      isImplicit: commitment.isImplicit,
      createdAt: commitment.createdAt,
      fulfilledAt: commitment.fulfilledAt,
    };
  }

  // ─── Feature 6: Subscription Creep Detection ────────────────────────────────

  /**
   * Detects subscription creep by analyzing monthly spend snapshots.
   * Triggers a CreepAlert when:
   * - Total recurring spend grows ≥15% over 90 days
   * - ≥3 new subscriptions are added within 30 days
   *
   * Includes breakdown of contributing new subscriptions and price hikes,
   * generates natural language insight, and supports alert acknowledgment.
   *
   * Requirement 9.1: Take monthly snapshots of total recurring spend
   * Requirement 9.2: Generate CreepAlert when spend grows ≥15% over 90 days
   * Requirement 9.3: Generate CreepAlert when ≥3 new subscriptions added in 30 days
   * Requirement 9.4: Include breakdown of contributing new subscriptions and price hikes
   * Requirement 9.5: Produce natural language insight
   * Requirement 9.6: Support alert acknowledgment to suppress repeated alerts
   */
  async detectSubscriptionCreep(): Promise<CreepAlert | null> {
    // Take a snapshot of current spend (Req 9.1)
    await this.takeMonthlySpendSnapshot();

    // Get all spend snapshots
    const snapshots = await this.store.getTotalRecurringSpend();

    if (snapshots.length === 0) {
      return null;
    }

    // Check for acknowledged alerts — if the most recent alert for this period
    // was acknowledged, suppress repeated alerts (Req 9.6)
    if (this.acknowledgedCreepAlerts.size > 0) {
      const currentMonth = this.getCurrentMonthKey();
      const threeMonthsAgo = this.getMonthKeyOffset(-3);
      const periodKey = `${threeMonthsAgo}_to_${currentMonth}`;
      if (this.acknowledgedCreepAlerts.has(periodKey)) {
        return null;
      }
    }

    // Check threshold 1: ≥15% spend growth over 90 days (Req 9.2)
    const spendGrowthAlert = this.checkSpendGrowthThreshold(snapshots);

    // Check threshold 2: ≥3 new subscriptions in 30 days (Req 9.3)
    const newSubsAlert = this.checkNewSubscriptionThreshold(snapshots);

    // Return the more severe alert, or whichever triggered
    if (spendGrowthAlert && newSubsAlert) {
      // Merge both alerts — use the spend growth as the base since it has dollar amounts
      return {
        ...spendGrowthAlert,
        newSubscriptionsAdded: [
          ...spendGrowthAlert.newSubscriptionsAdded,
          ...newSubsAlert.newSubscriptionsAdded.filter(
            (s) => !spendGrowthAlert.newSubscriptionsAdded.some((e) => e.id === s.id)
          ),
        ],
      };
    }

    return spendGrowthAlert || newSubsAlert;
  }

  /**
   * Takes a monthly snapshot of the current recurring spend state.
   * Stores subscription count, new additions, cancellations, and price changes.
   *
   * Requirement 9.1: Take monthly snapshots of total recurring spend
   */
  private async takeMonthlySpendSnapshot(): Promise<void> {
    const currentMonth = this.getCurrentMonthKey();
    const existingSnapshots = await this.store.getTotalRecurringSpend();

    // Don't overwrite if we already have a snapshot for this month
    const existingForMonth = existingSnapshots.find((s) => s.month === currentMonth);
    if (existingForMonth) {
      return;
    }

    // Get all subscriptions to compute current state
    const allSubscriptions = await this.store.getSubscriptions();
    const activeSubscriptions = allSubscriptions.filter((s) =>
      ["active-used", "active-unused", "zombie", "price-increased", "renewing-soon", "trial-active"].includes(s.status)
    );

    // Calculate total monthly recurring
    const totalMonthlyRecurring = activeSubscriptions.reduce(
      (sum, sub) => sum + this.toMonthlyAmount(sub),
      0
    );

    // Determine new subscriptions this month (first seen this month)
    const monthStart = new Date(
      parseInt(currentMonth.split("-")[0]),
      parseInt(currentMonth.split("-")[1]) - 1,
      1
    );
    const newThisMonth = activeSubscriptions
      .filter((sub) => {
        const firstSeen = sub.firstSeenDate instanceof Date
          ? sub.firstSeenDate
          : new Date(sub.firstSeenDate);
        return firstSeen >= monthStart;
      })
      .map((sub) => sub.vendor);

    // Determine cancelled subscriptions this month
    const cancelledThisMonth = allSubscriptions
      .filter((sub) => {
        if (sub.status !== "cancelled") return false;
        const updatedAt = sub.updatedAt instanceof Date
          ? sub.updatedAt
          : new Date(sub.updatedAt);
        return updatedAt >= monthStart;
      })
      .map((sub) => sub.vendor);

    // Collect price changes detected this month
    const priceChangesThisMonth: PriceChange[] = [];
    for (const sub of allSubscriptions) {
      for (const change of sub.priceChangeHistory) {
        const changeDate = change.detectedDate instanceof Date
          ? change.detectedDate
          : new Date(change.detectedDate);
        if (changeDate >= monthStart) {
          priceChangesThisMonth.push(change);
        }
      }
    }

    // Store the snapshot
    const snapshot: RecurringSpendSnapshot = {
      month: currentMonth,
      totalMonthlyRecurring: Math.round(totalMonthlyRecurring * 100) / 100,
      subscriptionCount: activeSubscriptions.length,
      newThisMonth,
      cancelledThisMonth,
      priceChangesThisMonth,
    };

    await this.persistSpendSnapshot(snapshot);
  }

  /**
   * Checks if total recurring spend has grown ≥15% over the last 90 days.
   *
   * Requirement 9.2: Generate CreepAlert when spend grows ≥15% over 90 days
   * Requirement 9.4: Include breakdown of contributing new subscriptions and price hikes
   * Requirement 9.5: Produce natural language insight
   */
  private checkSpendGrowthThreshold(
    snapshots: RecurringSpendSnapshot[]
  ): CreepAlert | null {
    if (snapshots.length < 2) {
      return null;
    }

    // Get the current (most recent) snapshot and the snapshot from ~3 months ago
    const currentSnapshot = snapshots[snapshots.length - 1];
    const currentSpend = currentSnapshot.totalMonthlyRecurring;

    // Find the snapshot closest to 3 months ago
    const threeMonthsAgoKey = this.getMonthKeyOffset(-3);
    const baselineSnapshot = this.findClosestSnapshot(snapshots, threeMonthsAgoKey);

    if (!baselineSnapshot) {
      // If we don't have data from 3 months ago, use the oldest available
      const oldestSnapshot = snapshots[0];
      if (oldestSnapshot.month === currentSnapshot.month) {
        return null; // Only one month of data
      }
      return this.evaluateSpendGrowth(oldestSnapshot, currentSnapshot, snapshots);
    }

    return this.evaluateSpendGrowth(baselineSnapshot, currentSnapshot, snapshots);
  }

  /**
   * Evaluates spend growth between two snapshots and generates an alert if threshold is met.
   */
  private async evaluateSpendGrowthSync(
    baseline: RecurringSpendSnapshot,
    current: RecurringSpendSnapshot,
    allSnapshots: RecurringSpendSnapshot[]
  ): Promise<CreepAlert | null> {
    return this.evaluateSpendGrowth(baseline, current, allSnapshots);
  }

  private evaluateSpendGrowth(
    baseline: RecurringSpendSnapshot,
    current: RecurringSpendSnapshot,
    allSnapshots: RecurringSpendSnapshot[]
  ): CreepAlert | null {
    const startingSpend = baseline.totalMonthlyRecurring;
    const currentSpend = current.totalMonthlyRecurring;

    if (startingSpend <= 0) {
      return null;
    }

    const absoluteIncrease = Math.round((currentSpend - startingSpend) * 100) / 100;
    const percentageIncrease = Math.round(
      ((currentSpend - startingSpend) / startingSpend) * 100 * 100
    ) / 100;

    if (percentageIncrease < CREEP_PERCENTAGE_THRESHOLD) {
      return null;
    }

    // Collect new subscriptions added during the period (Req 9.4)
    const newVendorNames = this.collectNewVendorsInPeriod(allSnapshots, baseline.month, current.month);

    // Collect price increases during the period (Req 9.4)
    const priceIncreases = this.collectPriceChangesInPeriod(allSnapshots, baseline.month, current.month);

    // Calculate period in months
    const periodMonths = this.monthDifference(baseline.month, current.month);

    // Generate natural language insight (Req 9.5)
    const insight = this.generateCreepInsight(
      percentageIncrease,
      absoluteIncrease,
      startingSpend,
      currentSpend,
      periodMonths
    );

    return {
      id: `creep-${current.month}-${Date.now()}`,
      detectedAt: new Date(),
      periodMonths,
      startingMonthlySpend: Math.round(startingSpend * 100) / 100,
      currentMonthlySpend: Math.round(currentSpend * 100) / 100,
      absoluteIncrease,
      percentageIncrease,
      newSubscriptionsAdded: [], // Will be populated with actual SubscriptionRecords by caller if needed
      priceIncreasesDetected: priceIncreases,
      insight,
      acknowledged: false,
    };
  }

  /**
   * Checks if ≥3 new subscriptions were added within the last 30 days.
   *
   * Requirement 9.3: Generate CreepAlert when ≥3 new subscriptions added in 30 days
   */
  private checkNewSubscriptionThreshold(
    snapshots: RecurringSpendSnapshot[]
  ): CreepAlert | null {
    if (snapshots.length === 0) {
      return null;
    }

    // Look at the most recent month's snapshot and possibly the previous month
    // to cover a 30-day window
    const currentSnapshot = snapshots[snapshots.length - 1];
    const previousSnapshot = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;

    // Count new subscriptions in the last 30 days (current month + possibly previous month)
    let newSubscriptionsInWindow: string[] = [...currentSnapshot.newThisMonth];

    // If we're early in the month, include previous month's new subscriptions
    const now = new Date();
    const dayOfMonth = now.getDate();
    if (dayOfMonth <= 15 && previousSnapshot) {
      // Include previous month's new subscriptions to cover the 30-day window
      newSubscriptionsInWindow = [
        ...newSubscriptionsInWindow,
        ...previousSnapshot.newThisMonth,
      ];
    }

    if (newSubscriptionsInWindow.length < CREEP_NEW_SUBSCRIPTION_THRESHOLD) {
      return null;
    }

    // We have ≥3 new subscriptions — generate alert
    const startingSpend = previousSnapshot
      ? previousSnapshot.totalMonthlyRecurring
      : currentSnapshot.totalMonthlyRecurring;
    const currentSpend = currentSnapshot.totalMonthlyRecurring;
    const absoluteIncrease = Math.round((currentSpend - startingSpend) * 100) / 100;
    const percentageIncrease = startingSpend > 0
      ? Math.round(((currentSpend - startingSpend) / startingSpend) * 100 * 100) / 100
      : 0;

    const periodMonths = 1;

    const insight = `You added ${newSubscriptionsInWindow.length} new subscriptions in the last 30 days (${newSubscriptionsInWindow.join(", ")}). Your recurring spend is now $${currentSpend.toFixed(2)}/month.`;

    return {
      id: `creep-newsubs-${currentSnapshot.month}-${Date.now()}`,
      detectedAt: new Date(),
      periodMonths,
      startingMonthlySpend: Math.round(startingSpend * 100) / 100,
      currentMonthlySpend: Math.round(currentSpend * 100) / 100,
      absoluteIncrease,
      percentageIncrease,
      newSubscriptionsAdded: [], // Will be populated with actual SubscriptionRecords
      priceIncreasesDetected: [],
      insight,
      acknowledged: false,
    };
  }

  /**
   * Acknowledges a creep alert to suppress repeated alerts for the same period.
   *
   * Requirement 9.6: Support alert acknowledgment to suppress repeated alerts
   */
  acknowledgeCreepAlert(alertId: string): void {
    // Extract the period from the alert ID and mark it as acknowledged
    const currentMonth = this.getCurrentMonthKey();
    const threeMonthsAgo = this.getMonthKeyOffset(-3);
    const periodKey = `${threeMonthsAgo}_to_${currentMonth}`;
    this.acknowledgedCreepAlerts.add(periodKey);
  }

  /**
   * Generates a natural language insight describing the subscription creep.
   *
   * Requirement 9.5: Produce natural language insight describing percentage increase,
   * absolute dollar increase, starting spend, and current spend
   */
  private generateCreepInsight(
    percentageIncrease: number,
    absoluteIncrease: number,
    startingSpend: number,
    currentSpend: number,
    periodMonths: number
  ): string {
    return `Your subscriptions grew ${percentageIncrease.toFixed(1)}% in ${periodMonths} month${periodMonths === 1 ? "" : "s"} — from $${startingSpend.toFixed(2)} to $${currentSpend.toFixed(2)}/month (up $${absoluteIncrease.toFixed(2)}/month).`;
  }

  /**
   * Collects all new vendor names added between two month snapshots.
   */
  private collectNewVendorsInPeriod(
    snapshots: RecurringSpendSnapshot[],
    startMonth: string,
    endMonth: string
  ): string[] {
    const vendors: string[] = [];
    for (const snapshot of snapshots) {
      if (snapshot.month > startMonth && snapshot.month <= endMonth) {
        vendors.push(...snapshot.newThisMonth);
      }
    }
    return vendors;
  }

  /**
   * Collects all price changes detected between two month snapshots.
   */
  private collectPriceChangesInPeriod(
    snapshots: RecurringSpendSnapshot[],
    startMonth: string,
    endMonth: string
  ): PriceChange[] {
    const changes: PriceChange[] = [];
    for (const snapshot of snapshots) {
      if (snapshot.month > startMonth && snapshot.month <= endMonth) {
        changes.push(...snapshot.priceChangesThisMonth);
      }
    }
    return changes;
  }

  /**
   * Finds the snapshot closest to the target month key.
   */
  private findClosestSnapshot(
    snapshots: RecurringSpendSnapshot[],
    targetMonth: string
  ): RecurringSpendSnapshot | null {
    // Find exact match first
    const exact = snapshots.find((s) => s.month === targetMonth);
    if (exact) return exact;

    // Find the closest snapshot that is at or before the target month
    let closest: RecurringSpendSnapshot | null = null;
    for (const snapshot of snapshots) {
      if (snapshot.month <= targetMonth) {
        closest = snapshot;
      }
    }
    return closest;
  }

  /**
   * Gets the current month as a "YYYY-MM" string.
   */
  private getCurrentMonthKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  /**
   * Gets a month key offset from the current month.
   */
  private getMonthKeyOffset(offsetMonths: number): string {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
    return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`;
  }

  /**
   * Calculates the number of months between two month keys ("YYYY-MM" format).
   */
  private monthDifference(startMonth: string, endMonth: string): number {
    const [startYear, startMo] = startMonth.split("-").map(Number);
    const [endYear, endMo] = endMonth.split("-").map(Number);
    return (endYear - startYear) * 12 + (endMo - startMo);
  }

  /**
   * Persists a spend snapshot to the entity store.
   */
  private async persistSpendSnapshot(snapshot: RecurringSpendSnapshot): Promise<void> {
    // Use the store's internal mechanism to persist snapshots
    // The store has a spend_snapshots table we can write to
    const store = this.store as any;
    if (store.db) {
      const stmt = store.db.prepare(`
        INSERT OR REPLACE INTO spend_snapshots (
          month, total_monthly_recurring, subscription_count,
          new_this_month, cancelled_this_month, price_changes_this_month
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        snapshot.month,
        snapshot.totalMonthlyRecurring,
        snapshot.subscriptionCount,
        JSON.stringify(snapshot.newThisMonth),
        JSON.stringify(snapshot.cancelledThisMonth),
        JSON.stringify(snapshot.priceChangesThisMonth),
      );
    }
  }

  // ─── Feature 10: Spend Pattern Analysis ─────────────────────────────────────

  /**
   * Analyzes spending patterns including monthly totals, category breakdowns,
   * month-over-month and quarter-over-quarter comparisons, anomaly detection,
   * natural language insights, and future spend prediction.
   *
   * Requirement 13.1: Track monthly spending totals and produce category breakdowns
   * Requirement 13.2: Compute month-over-month and quarter-over-quarter comparisons
   * Requirement 13.3: Detect spending anomalies (sudden increase, new recurring charges)
   * Requirement 13.4: Generate natural language insights describing trends
   * Requirement 13.5: Predict future monthly spend based on historical patterns
   * Requirement 13.6: Identify top spending category and percentage of total
   */
  async analyzeSpendingPatterns(): Promise<SpendAnalysis> {
    const now = new Date();

    // Get 12 months of spending data for analysis
    const monthlyTotals = await this.store.getMonthlySpendSummary(12);

    // Get category breakdown for the last 3 months
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const categoryBreakdown = await this.store.getSpendByCategory({
      start: threeMonthsAgo,
      end: now,
    });

    // Get recurring spend snapshots for anomaly detection
    const recurringSnapshots = await this.store.getTotalRecurringSpend();

    // Compute month-over-month comparison (Req 13.2)
    const monthOverMonth = this.computeMoMComparison(monthlyTotals);

    // Compute quarter-over-quarter comparison (Req 13.2)
    const quarterOverQuarter = this.computeQoQComparison(monthlyTotals);

    // Detect spending anomalies (Req 13.3)
    const anomalies = this.detectSpendAnomalies(monthlyTotals, recurringSnapshots);

    // Identify top spending category (Req 13.6)
    const topCategory = this.identifyTopCategory(categoryBreakdown);

    // Predict future monthly spend (Req 13.5)
    const predictedNextMonthSpend = this.predictNextMonthSpend(monthlyTotals);

    // Generate natural language insights (Req 13.4)
    const insights = this.generateSpendInsights(
      monthlyTotals,
      categoryBreakdown,
      monthOverMonth,
      quarterOverQuarter,
      anomalies,
      topCategory
    );

    // Calculate current total monthly spend
    const totalMonthlySpend = monthlyTotals.length > 0
      ? monthlyTotals[monthlyTotals.length - 1].totalAmount
      : 0;

    return {
      monthlyTotals,
      categoryBreakdown,
      monthOverMonth,
      quarterOverQuarter,
      anomalies,
      insights,
      predictedNextMonthSpend,
      topCategory,
      totalMonthlySpend,
      analyzedAt: now,
    };
  }

  /**
   * Computes month-over-month spend comparison.
   * Compares the most recent month to the previous month.
   *
   * Requirement 13.2
   */
  private computeMoMComparison(monthlyTotals: MonthlySpend[]): MoMComparison {
    if (monthlyTotals.length < 2) {
      const current = monthlyTotals.length > 0 ? monthlyTotals[monthlyTotals.length - 1].totalAmount : 0;
      return {
        currentMonth: current,
        previousMonth: 0,
        absoluteChange: current,
        percentageChange: 0,
        direction: "stable",
      };
    }

    const currentMonth = monthlyTotals[monthlyTotals.length - 1].totalAmount;
    const previousMonth = monthlyTotals[monthlyTotals.length - 2].totalAmount;
    const absoluteChange = Math.round((currentMonth - previousMonth) * 100) / 100;
    const percentageChange = previousMonth > 0
      ? Math.round(((currentMonth - previousMonth) / previousMonth) * 100 * 100) / 100
      : 0;

    let direction: "increasing" | "stable" | "decreasing";
    if (percentageChange > 5) {
      direction = "increasing";
    } else if (percentageChange < -5) {
      direction = "decreasing";
    } else {
      direction = "stable";
    }

    return {
      currentMonth,
      previousMonth,
      absoluteChange,
      percentageChange,
      direction,
    };
  }

  /**
   * Computes quarter-over-quarter spend comparison.
   * Sums the most recent 3 months and compares to the prior 3 months.
   *
   * Requirement 13.2
   */
  private computeQoQComparison(monthlyTotals: MonthlySpend[]): QoQComparison {
    if (monthlyTotals.length < 6) {
      // Not enough data for a full QoQ comparison
      const currentQuarter = monthlyTotals.slice(-3).reduce((sum, m) => sum + m.totalAmount, 0);
      const previousQuarter = monthlyTotals.length > 3
        ? monthlyTotals.slice(-6, -3).reduce((sum, m) => sum + m.totalAmount, 0)
        : 0;
      const absoluteChange = Math.round((currentQuarter - previousQuarter) * 100) / 100;
      const percentageChange = previousQuarter > 0
        ? Math.round(((currentQuarter - previousQuarter) / previousQuarter) * 100 * 100) / 100
        : 0;

      return {
        currentQuarter,
        previousQuarter,
        absoluteChange,
        percentageChange,
        direction: percentageChange > 5 ? "increasing" : percentageChange < -5 ? "decreasing" : "stable",
      };
    }

    const currentQuarter = monthlyTotals.slice(-3).reduce((sum, m) => sum + m.totalAmount, 0);
    const previousQuarter = monthlyTotals.slice(-6, -3).reduce((sum, m) => sum + m.totalAmount, 0);
    const absoluteChange = Math.round((currentQuarter - previousQuarter) * 100) / 100;
    const percentageChange = previousQuarter > 0
      ? Math.round(((currentQuarter - previousQuarter) / previousQuarter) * 100 * 100) / 100
      : 0;

    let direction: "increasing" | "stable" | "decreasing";
    if (percentageChange > 5) {
      direction = "increasing";
    } else if (percentageChange < -5) {
      direction = "decreasing";
    } else {
      direction = "stable";
    }

    return {
      currentQuarter,
      previousQuarter,
      absoluteChange,
      percentageChange,
      direction,
    };
  }

  /**
   * Detects spending anomalies including sudden increases (>25% MoM)
   * and new recurring charges.
   *
   * Requirement 13.3
   */
  private detectSpendAnomalies(
    monthlyTotals: MonthlySpend[],
    recurringSnapshots: RecurringSpendSnapshot[]
  ): SpendAnomaly[] {
    const anomalies: SpendAnomaly[] = [];

    // Detect sudden increases (>25% month-over-month)
    for (let i = 1; i < monthlyTotals.length; i++) {
      const current = monthlyTotals[i].totalAmount;
      const previous = monthlyTotals[i - 1].totalAmount;

      if (previous > 0) {
        const percentageChange = ((current - previous) / previous) * 100;
        if (percentageChange > 25) {
          anomalies.push({
            type: "sudden_increase",
            description: `Spending increased ${percentageChange.toFixed(1)}% from $${previous.toFixed(2)} to $${current.toFixed(2)} in ${monthlyTotals[i].month}`,
            month: monthlyTotals[i].month,
            amount: current,
            percentageChange: Math.round(percentageChange * 100) / 100,
          });
        }
      }
    }

    // Detect new recurring charges from snapshots
    for (const snapshot of recurringSnapshots) {
      if (snapshot.newThisMonth.length > 0) {
        for (const vendor of snapshot.newThisMonth) {
          anomalies.push({
            type: "new_recurring_charge",
            description: `New recurring charge detected: ${vendor} in ${snapshot.month}`,
            month: snapshot.month,
            amount: snapshot.totalMonthlyRecurring,
            vendor,
          });
        }
      }
    }

    return anomalies;
  }

  /**
   * Identifies the top spending category and its percentage of total.
   *
   * Requirement 13.6
   */
  private identifyTopCategory(
    categoryBreakdown: CategorySpend[]
  ): { category: SubscriptionCategory; percentage: number; amount: number } {
    if (categoryBreakdown.length === 0) {
      return { category: "other", percentage: 0, amount: 0 };
    }

    // categoryBreakdown is already sorted by totalAmount descending from the store
    const top = categoryBreakdown[0];
    return {
      category: top.category,
      percentage: Math.round(top.percentageOfTotal * 100) / 100,
      amount: Math.round(top.totalAmount * 100) / 100,
    };
  }

  /**
   * Predicts next month's spend using a simple linear regression
   * on the last 6 months of data (or moving average if fewer data points).
   *
   * Requirement 13.5
   */
  private predictNextMonthSpend(monthlyTotals: MonthlySpend[]): number {
    if (monthlyTotals.length === 0) {
      return 0;
    }

    if (monthlyTotals.length === 1) {
      return Math.round(monthlyTotals[0].totalAmount * 100) / 100;
    }

    // Use the last 6 months (or all available) for prediction
    const recentMonths = monthlyTotals.slice(-6);

    if (recentMonths.length < 3) {
      // Not enough data for regression — use moving average
      const avg = recentMonths.reduce((sum, m) => sum + m.totalAmount, 0) / recentMonths.length;
      return Math.round(avg * 100) / 100;
    }

    // Simple linear regression: y = mx + b
    const n = recentMonths.length;
    const xs = recentMonths.map((_, i) => i);
    const ys = recentMonths.map((m) => m.totalAmount);

    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = ys.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((sum, x, i) => sum + x * ys[i], 0);
    const sumX2 = xs.reduce((sum, x) => sum + x * x, 0);

    const denominator = n * sumX2 - sumX * sumX;
    if (denominator === 0) {
      // All x values are the same — return average
      return Math.round((sumY / n) * 100) / 100;
    }

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;

    // Predict for the next month (x = n)
    const predicted = slope * n + intercept;

    // Ensure prediction is non-negative
    return Math.round(Math.max(0, predicted) * 100) / 100;
  }

  /**
   * Generates natural language insights describing spending trends.
   *
   * Requirement 13.4
   */
  private generateSpendInsights(
    monthlyTotals: MonthlySpend[],
    categoryBreakdown: CategorySpend[],
    mom: MoMComparison,
    qoq: QoQComparison,
    anomalies: SpendAnomaly[],
    topCategory: { category: SubscriptionCategory; percentage: number; amount: number }
  ): string[] {
    const insights: string[] = [];

    // Month-over-month insight
    if (mom.previousMonth > 0) {
      if (mom.direction === "increasing") {
        insights.push(
          `Your spending increased ${Math.abs(mom.percentageChange).toFixed(0)}% this month, from $${mom.previousMonth.toFixed(2)} to $${mom.currentMonth.toFixed(2)}.`
        );
      } else if (mom.direction === "decreasing") {
        insights.push(
          `Your spending decreased ${Math.abs(mom.percentageChange).toFixed(0)}% this month, from $${mom.previousMonth.toFixed(2)} to $${mom.currentMonth.toFixed(2)}.`
        );
      } else {
        insights.push(
          `Your spending remained stable this month at $${mom.currentMonth.toFixed(2)}.`
        );
      }
    }

    // Quarter-over-quarter insight
    if (qoq.previousQuarter > 0 && qoq.direction !== "stable") {
      const direction = qoq.direction === "increasing" ? "increased" : "decreased";
      insights.push(
        `Your quarterly spending ${direction} ${Math.abs(qoq.percentageChange).toFixed(0)}% compared to the previous quarter.`
      );
    }

    // Top category insight
    if (topCategory.percentage > 0) {
      const categoryLabel = topCategory.category.replace(/-/g, " ");
      insights.push(
        `Your top spending category is ${categoryLabel}, accounting for ${topCategory.percentage.toFixed(0)}% of total spend ($${topCategory.amount.toFixed(2)}).`
      );
    }

    // Category-specific trend insights
    for (const cat of categoryBreakdown) {
      if (cat.trend === "increasing" && cat.percentageOfTotal > 15) {
        const label = cat.category.replace(/-/g, " ");
        insights.push(
          `Your ${label} spending is trending upward and now represents ${cat.percentageOfTotal.toFixed(0)}% of your total spend.`
        );
      }
    }

    // Anomaly insights
    const suddenIncreases = anomalies.filter((a) => a.type === "sudden_increase");
    if (suddenIncreases.length > 0) {
      const latest = suddenIncreases[suddenIncreases.length - 1];
      insights.push(
        `A spending spike of ${latest.percentageChange?.toFixed(0)}% was detected in ${latest.month}.`
      );
    }

    const newCharges = anomalies.filter((a) => a.type === "new_recurring_charge");
    if (newCharges.length > 0) {
      const recentNew = newCharges.slice(-3);
      const vendors = recentNew.map((a) => a.vendor).filter(Boolean).join(", ");
      if (vendors) {
        insights.push(
          `New recurring charges detected: ${vendors}.`
        );
      }
    }

    return insights;
  }

  // ─── Feature 11: Financial Commitment Tracker ────────────────────────────────

  /**
   * Tracks both inbound and outbound financial commitments, marks overdue
   * commitments (14+ days past due with no activity), ranks by financial value,
   * and feeds relevant commitments into Refund Tracker and Payment Promise Tracker.
   *
   * Requirement 14.1: Track both inbound and outbound commitments
   * Requirement 14.2: Mark as overdue when 14+ days past due date with no activity
   * Requirement 14.4: Rank open commitments by financial value (higher = higher priority)
   * Requirement 14.5: Update commitment status to fulfilled with fulfillment date
   * Requirement 14.6: Feed relevant commitments into Refund Tracker and Payment Promise Tracker
   */
  async trackFinancialCommitments(): Promise<CommitmentTrackingResult> {
    const now = new Date();

    // Get all open commitments from the store
    const openCommitments = await this.store.getOpenCommitments();
    const existingOverdue = await this.store.getOverdueCommitments();

    // Separate inbound and outbound (Req 14.1)
    const inbound: FinancialCommitment[] = [];
    const outbound: FinancialCommitment[] = [];
    const newlyOverdue: FinancialCommitment[] = [];
    const stillOpen: FinancialCommitment[] = [];

    for (const commitment of openCommitments) {
      // Requirement 14.2: Mark as overdue when 14+ days past due date with no activity
      if (this.isCommitmentOverdue(commitment, now)) {
        const overdueCommitment: FinancialCommitment = {
          ...commitment,
          status: "overdue",
          updatedAt: now,
        };
        newlyOverdue.push(overdueCommitment);
        await this.store.updateCommitmentStatus(commitment.id, "overdue");
      } else {
        stillOpen.push(commitment);
      }

      // Categorize by type (Req 14.1)
      if (commitment.type === "inbound") {
        inbound.push(commitment);
      } else {
        outbound.push(commitment);
      }
    }

    // Add existing overdue commitments to the inbound/outbound lists
    for (const commitment of existingOverdue) {
      if (commitment.type === "inbound") {
        if (!inbound.some((c) => c.id === commitment.id)) {
          inbound.push(commitment);
        }
      } else {
        if (!outbound.some((c) => c.id === commitment.id)) {
          outbound.push(commitment);
        }
      }
    }

    // Combine all overdue commitments
    const allOverdue = [...existingOverdue, ...newlyOverdue];

    // Requirement 14.4: Rank open commitments by financial value (higher amounts = higher priority)
    const openRankedByValue = [...stillOpen].sort((a, b) => {
      const valueA = a.financialValue ?? 0;
      const valueB = b.financialValue ?? 0;
      return valueB - valueA;
    });

    // Update priority based on ranking
    for (let i = 0; i < openRankedByValue.length; i++) {
      openRankedByValue[i] = {
        ...openRankedByValue[i],
        priority: openRankedByValue.length - i,
      };
    }

    // Requirement 14.6: Feed relevant commitments into specialized trackers
    // Refund Tracker: refund_promise subtypes
    const refundCommitments = [...openCommitments, ...existingOverdue].filter(
      (c) => c.subtype === "refund_promise"
    );

    // Payment Promise Tracker: payment_promise subtypes
    const paymentPromiseCommitments = [...openCommitments, ...existingOverdue].filter(
      (c) => c.subtype === "payment_promise"
    );

    // Compute totals
    const totals: CommitmentTotals = {
      totalInbound: inbound.length,
      totalOutbound: outbound.length,
      totalOverdue: allOverdue.length,
      totalOpen: stillOpen.length,
      totalInboundValue: Math.round(
        inbound.reduce((sum, c) => sum + (c.financialValue ?? 0), 0) * 100
      ) / 100,
      totalOutboundValue: Math.round(
        outbound.reduce((sum, c) => sum + (c.financialValue ?? 0), 0) * 100
      ) / 100,
      totalOverdueValue: Math.round(
        allOverdue.reduce((sum, c) => sum + (c.financialValue ?? 0), 0) * 100
      ) / 100,
    };

    return {
      inbound,
      outbound,
      overdue: allOverdue,
      openRankedByValue,
      refundCommitments,
      paymentPromiseCommitments,
      totals,
    };
  }

  /**
   * Determines if a commitment is overdue (14+ days past due date with no activity).
   *
   * Requirement 14.2: Mark as overdue when 14+ days past due date with no activity
   */
  private isCommitmentOverdue(commitment: FinancialCommitment, now: Date): boolean {
    if (!commitment.dueDate) {
      return false;
    }

    if (commitment.status === "fulfilled" || commitment.status === "overdue") {
      return false;
    }

    const dueDate = commitment.dueDate instanceof Date
      ? commitment.dueDate
      : new Date(commitment.dueDate);

    const daysPastDue = this.daysBetween(dueDate, now);

    // Check for recent activity (last follow-up date)
    if (commitment.lastFollowUpDate) {
      const lastActivity = commitment.lastFollowUpDate instanceof Date
        ? commitment.lastFollowUpDate
        : new Date(commitment.lastFollowUpDate);
      const daysSinceActivity = this.daysBetween(lastActivity, now);
      // If there was activity within the last 14 days, not overdue
      if (daysSinceActivity < 14) {
        return false;
      }
    }

    // Overdue if 14+ days past due date
    return daysPastDue >= 14;
  }

  // ─── Feature 12: Financial Obligations & Contract Watch ──────────────────────

  /**
   * Monitors contracts and financial obligations for risk flags, computes
   * total financial exposure, and surfaces upcoming deadlines.
   *
   * Requirement 15.1: Extract contract details (handled by classifier, we monitor here)
   * Requirement 15.2: Flag contracts with silent auto-renewal clause → auto_renewal
   * Requirement 15.3: Flag contracts with price escalation clause → price_escalation
   * Requirement 15.4: Flag contracts with penalty clauses → penalty_clause (extract trigger + amount)
   * Requirement 15.5: Flag contracts where notice window deadline has passed → missed_notice_window
   * Requirement 15.6: Compute total financial exposure across all active obligations
   */
  async watchObligations(): Promise<ObligationWatchResult> {
    const now = new Date();

    // Get all obligations from the store
    const obligations = await this.store.getObligations();

    // Get upcoming deadlines (next 90 days)
    const deadlines = await this.store.getUpcomingDeadlines(90);

    // Analyze each obligation for risk flags
    const riskFlags: ObligationRiskItem[] = [];
    const highRiskObligations: FinancialObligation[] = [];

    for (const obligation of obligations) {
      const detectedFlags = this.detectObligationRiskFlags(obligation, now);
      riskFlags.push(...detectedFlags);

      // Update the obligation's risk flags in the store if new flags detected
      const existingFlagSet = new Set(obligation.riskFlags);
      const newFlags = detectedFlags.map((f) => f.flag);
      const allFlags = [...new Set([...obligation.riskFlags, ...newFlags])];

      if (allFlags.length > existingFlagSet.size) {
        const updatedObligation: FinancialObligation = {
          ...obligation,
          riskFlags: allFlags,
          updatedAt: now,
        };
        await this.store.upsertObligation(updatedObligation);
      }

      // Classify as high risk if it has 2+ risk flags or specific critical flags
      const criticalFlags: RiskFlag[] = [
        "missed_notice_window",
        "high_financial_exposure",
        "penalty_clause",
      ];
      const hasCriticalFlag = allFlags.some((f) => criticalFlags.includes(f));
      if (allFlags.length >= 2 || hasCriticalFlag) {
        highRiskObligations.push(obligation);
      }
    }

    // Requirement 15.6: Compute total financial exposure across all active obligations
    const totalFinancialExposure = Math.round(
      obligations.reduce((sum, o) => sum + o.financialExposure, 0) * 100
    ) / 100;

    // Compute summary
    const summary: ObligationWatchSummary = {
      totalObligations: obligations.length,
      totalRiskFlags: riskFlags.length,
      obligationsWithAutoRenewal: obligations.filter((o) => o.autoRenews).length,
      obligationsWithPenalties: obligations.filter((o) => o.penaltyClauses.length > 0).length,
      obligationsWithMissedNotice: riskFlags.filter((f) => f.flag === "missed_notice_window").length,
      upcomingDeadlineCount: deadlines.length,
    };

    return {
      obligations,
      riskFlags,
      deadlines,
      totalFinancialExposure,
      highRiskObligations,
      summary,
    };
  }

  /**
   * Detects risk flags for a single financial obligation.
   *
   * Requirement 15.2: auto_renewal — silent auto-renewal clause
   * Requirement 15.3: price_escalation — price escalation clause
   * Requirement 15.4: penalty_clause — penalty clauses with trigger condition and amount
   * Requirement 15.5: missed_notice_window — notice window deadline has passed
   * Also detects: unfavorable_terms, silent_renewal, expiring_soon, high_financial_exposure
   */
  private detectObligationRiskFlags(
    obligation: FinancialObligation,
    now: Date
  ): ObligationRiskItem[] {
    const flags: ObligationRiskItem[] = [];

    // Requirement 15.2: Flag contracts with silent auto-renewal clause
    if (obligation.autoRenews) {
      flags.push({
        obligationId: obligation.id,
        contractName: obligation.contractName,
        flag: "auto_renewal",
        description: `${obligation.contractName} has an auto-renewal clause that will automatically renew the contract.`,
        financialImpact: obligation.recurringAmount ?? obligation.totalValue,
      });

      // Also flag as silent_renewal if auto-renews with no explicit notice window
      if (obligation.noticeWindowDays === null || obligation.noticeWindowDays === 0) {
        flags.push({
          obligationId: obligation.id,
          contractName: obligation.contractName,
          flag: "silent_renewal",
          description: `${obligation.contractName} auto-renews with no defined notice window — renewal may happen silently.`,
          financialImpact: obligation.recurringAmount ?? obligation.totalValue,
        });
      }
    }

    // Requirement 15.3: Flag contracts with price escalation clause
    // Detect price escalation from key dates with rate_change type
    const hasRateChange = obligation.keyDates.some((d) => d.type === "rate_change");
    if (hasRateChange) {
      const rateChangeDate = obligation.keyDates.find((d) => d.type === "rate_change");
      flags.push({
        obligationId: obligation.id,
        contractName: obligation.contractName,
        flag: "price_escalation",
        description: `${obligation.contractName} contains a price escalation clause${rateChangeDate ? ` effective ${this.formatDate(rateChangeDate.date)}` : ""}.`,
        financialImpact: rateChangeDate?.amount ?? null,
      });
    }

    // Requirement 15.4: Flag contracts with penalty clauses (extract trigger + amount)
    for (const penalty of obligation.penaltyClauses) {
      flags.push({
        obligationId: obligation.id,
        contractName: obligation.contractName,
        flag: "penalty_clause",
        description: `${obligation.contractName} has a penalty clause: ${penalty.description}`,
        financialImpact: penalty.penaltyAmount,
        triggerCondition: penalty.triggerCondition,
        penaltyAmount: penalty.penaltyAmount,
      });
    }

    // Requirement 15.5: Flag contracts where notice window deadline has passed
    if (obligation.noticeWindowDays !== null && obligation.noticeWindowDays > 0) {
      // Find the next renewal or expiry date
      const renewalOrExpiry = obligation.keyDates.find(
        (d) => d.type === "renewal" || d.type === "expiry"
      );

      if (renewalOrExpiry) {
        const deadlineDate = renewalOrExpiry.date instanceof Date
          ? renewalOrExpiry.date
          : new Date(renewalOrExpiry.date);

        // Notice window deadline = renewal/expiry date - notice window days
        const noticeDeadline = new Date(deadlineDate);
        noticeDeadline.setDate(noticeDeadline.getDate() - obligation.noticeWindowDays);

        if (now > noticeDeadline) {
          flags.push({
            obligationId: obligation.id,
            contractName: obligation.contractName,
            flag: "missed_notice_window",
            description: `Notice window for ${obligation.contractName} has passed (deadline was ${this.formatDate(noticeDeadline)}). The contract may auto-renew.`,
            financialImpact: obligation.recurringAmount ?? obligation.totalValue,
          });
        }
      }
    }

    // Detect unfavorable_terms: multiple penalty clauses or high exposure relative to value
    if (obligation.penaltyClauses.length >= 2) {
      flags.push({
        obligationId: obligation.id,
        contractName: obligation.contractName,
        flag: "unfavorable_terms",
        description: `${obligation.contractName} has ${obligation.penaltyClauses.length} penalty clauses, indicating potentially unfavorable terms.`,
        financialImpact: obligation.financialExposure,
      });
    }

    // Detect expiring_soon: any key date of type expiry within 30 days
    const expiringDates = obligation.keyDates.filter((d) => {
      if (d.type !== "expiry") return false;
      const date = d.date instanceof Date ? d.date : new Date(d.date);
      const daysUntil = this.daysBetween(now, date);
      return daysUntil >= 0 && daysUntil <= 30;
    });

    if (expiringDates.length > 0) {
      flags.push({
        obligationId: obligation.id,
        contractName: obligation.contractName,
        flag: "expiring_soon",
        description: `${obligation.contractName} is expiring within 30 days.`,
        financialImpact: obligation.totalValue,
      });
    }

    // Detect high_financial_exposure: exposure > $5000
    if (obligation.financialExposure > 5000) {
      flags.push({
        obligationId: obligation.id,
        contractName: obligation.contractName,
        flag: "high_financial_exposure",
        description: `${obligation.contractName} has high financial exposure of $${obligation.financialExposure.toFixed(2)}.`,
        financialImpact: obligation.financialExposure,
      });
    }

    return flags;
  }

  /**
   * Formats a date for display in risk flag descriptions.
   */
  private formatDate(date: Date): string {
    const d = date instanceof Date ? date : new Date(date);
    return d.toISOString().split("T")[0];
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Groups subscriptions by their status.
   */
  private groupByStatus(
    subscriptions: SubscriptionRecord[]
  ): Record<SubscriptionStatus, SubscriptionRecord[]> {
    const result: Record<SubscriptionStatus, SubscriptionRecord[]> = {
      "active-used": [],
      "active-unused": [],
      zombie: [],
      "price-increased": [],
      "renewing-soon": [],
      "trial-active": [],
      cancelled: [],
      unknown: [],
    };

    for (const sub of subscriptions) {
      result[sub.status].push(sub);
    }

    return result;
  }

  /**
   * Groups subscriptions by their category.
   *
   * Requirement 4.4: Classify each subscription into defined categories
   */
  private groupByCategory(
    subscriptions: SubscriptionRecord[]
  ): Record<SubscriptionCategory, SubscriptionRecord[]> {
    const result: Record<SubscriptionCategory, SubscriptionRecord[]> = {
      "music-streaming": [],
      "video-streaming": [],
      productivity: [],
      "cloud-storage": [],
      fitness: [],
      "news-media": [],
      "software-saas": [],
      "security-vpn": [],
      "food-delivery": [],
      gaming: [],
      education: [],
      utilities: [],
      insurance: [],
      other: [],
    };

    for (const sub of subscriptions) {
      result[sub.category].push(sub);
    }

    return result;
  }

  /**
   * Extracts recent price changes from all subscriptions.
   */
  private extractRecentPriceChanges(
    subscriptions: SubscriptionRecord[]
  ): PriceChangeDetail[] {
    const changes: PriceChangeDetail[] = [];

    for (const sub of subscriptions) {
      for (const change of sub.priceChangeHistory) {
        changes.push({
          vendor: sub.vendor,
          vendorDomain: sub.vendorDomain,
          previousAmount: change.previousAmount,
          newAmount: change.newAmount,
          percentageChange: change.percentageChange,
          detectedDate:
            change.detectedDate instanceof Date
              ? change.detectedDate
              : new Date(change.detectedDate),
          subscriptionId: sub.id,
        });
      }
    }

    // Sort by detection date, most recent first
    return changes.sort(
      (a, b) => b.detectedDate.getTime() - a.detectedDate.getTime()
    );
  }

  /**
   * Calculates the total monthly recurring spend across all active subscriptions.
   */
  private calculateTotalMonthlyRecurring(
    subscriptions: SubscriptionRecord[]
  ): number {
    const activeStatuses: SubscriptionStatus[] = [
      "active-used",
      "active-unused",
      "zombie",
      "price-increased",
      "renewing-soon",
      "trial-active",
    ];

    const total = subscriptions
      .filter((sub) => activeStatuses.includes(sub.status))
      .reduce((sum, sub) => sum + this.toMonthlyAmount(sub), 0);

    return Math.round(total * 100) / 100;
  }

  /**
   * Converts a subscription amount to its monthly equivalent.
   */
  private toMonthlyAmount(sub: SubscriptionRecord): number {
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
   * Checks if a domain or vendor name matches any of the given keywords.
   */
  private matchesAny(
    domain: string,
    vendor: string,
    keywords: string[]
  ): boolean {
    return keywords.some(
      (keyword) =>
        domain.includes(keyword.toLowerCase().replace(/\s+/g, "")) ||
        vendor.includes(keyword.toLowerCase())
    );
  }

  /**
   * Calculates the number of days between two dates.
   */
  private daysBetween(start: Date, end: Date): number {
    const startTime =
      start instanceof Date ? start.getTime() : new Date(start).getTime();
    const endTime =
      end instanceof Date ? end.getTime() : new Date(end).getTime();
    return Math.floor((endTime - startTime) / (1000 * 60 * 60 * 24));
  }
}
