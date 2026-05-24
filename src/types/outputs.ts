/**
 * Output types for the Intelligence Engine, Action Engine, and Dashboard.
 */

import type {
  BillingFrequency,
  FeatureArea,
  RiskFlag,
  SubscriptionCategory,
} from "./enums";
import type { FinancialCommitment, FinancialObligation, ObligationDeadline, PriceChange, SubscriptionRecord } from "./models";

// ─── Email Draft ─────────────────────────────────────────────────────────────

export type DraftType =
  | "cancellation"
  | "negotiation"
  | "refund_follow_up"
  | "trial_cancellation"
  | "payment_follow_up";

export interface EmailDraft {
  id: string;
  to: string;
  subject: string;
  body: string;
  type: DraftType;
  targetId: string;
  requiresApproval: boolean;
  createdAt: Date;
}

// ─── Priority Feed ───────────────────────────────────────────────────────────

export interface PrioritizedItem {
  id: string;
  featureArea: FeatureArea;
  title: string;
  description: string;
  urgencyScore: number; // 0-10
  financialImpact: number; // Dollar amount at stake
  suggestedActions: SuggestedAction[];
  relatedVendor: string | null;
  dueDate: Date | null;
  createdAt: Date;
}

export interface SuggestedAction {
  type:
    | "cancel"
    | "negotiate"
    | "follow_up"
    | "acknowledge"
    | "review"
    | "set_reminder"
    | "switch_annual"
    | "cancel_trial";
  label: string;
  draftAvailable: boolean;
}

// ─── Smart Digest ────────────────────────────────────────────────────────────

export interface SmartDigest {
  id: string;
  period: "daily" | "weekly";
  generatedAt: Date;
  coveringRange: DateRange;

  // Summary numbers
  totalRecurringSpend: number;
  spendChangeFromLastPeriod: number;
  totalPotentialSavings: number;

  // Priority items (top 5)
  topAlerts: DigestAlert[];

  // Section summaries
  renewalsThisPeriod: RenewalDigestItem[];
  expiringTrials: TrialDigestItem[];
  overdueRefunds: RefundDigestItem[];
  brokenPaymentPromises: CommitmentDigestItem[];
  savingsOpportunities: SavingsDigestItem[];
  spendingInsight: string;
  creepWarning: string | null;

  // Actions available
  oneClickActions: DigestAction[];
}

export interface DigestAlert {
  title: string;
  description: string;
  urgency: "critical" | "high" | "medium" | "low";
  financialImpact: number;
  action: DigestAction;
}

export interface DigestAction {
  type:
    | "cancel"
    | "negotiate"
    | "follow_up"
    | "set_reminder"
    | "review"
    | "acknowledge";
  label: string;
  targetId: string;
}

// ─── Creep Alert ─────────────────────────────────────────────────────────────

export interface CreepAlert {
  id: string;
  detectedAt: Date;
  periodMonths: number;
  startingMonthlySpend: number;
  currentMonthlySpend: number;
  absoluteIncrease: number;
  percentageIncrease: number;
  newSubscriptionsAdded: SubscriptionRecord[];
  priceIncreasesDetected: PriceChange[];
  insight: string;
  acknowledged: boolean;
}

export interface RecurringSpendSnapshot {
  month: string; // "2026-01"
  totalMonthlyRecurring: number;
  subscriptionCount: number;
  newThisMonth: string[]; // vendor names
  cancelledThisMonth: string[];
  priceChangesThisMonth: PriceChange[];
}

// ─── Billing Optimization ────────────────────────────────────────────────────

export interface BillingOptimization {
  id: string;
  vendor: string;
  currentFrequency: "monthly";
  currentMonthlyAmount: number;
  annualPlanMonthlyEquivalent: number;
  annualPlanTotalAmount: number;
  monthlySavings: number;
  annualSavings: number;
  percentageSaved: number;
  breakEvenMonths: number;
  monthsSubscribed: number;
  recommendation: string;
  confidence: "high" | "medium" | "low";
}

// ─── Savings Recommendation ──────────────────────────────────────────────────

export interface SavingsRecommendation {
  id: string;
  type: "redundancy" | "negotiation" | "cancellation" | "downgrade";
  vendor: string;
  category: SubscriptionCategory;
  currentMonthlyAmount: number;
  estimatedMonthlySavings: number;
  estimatedAnnualSavings: number;
  reason: string;
  confidence: "high" | "medium" | "low";
  draftAvailable: boolean;
  relatedSubscriptionIds: string[];
}

export interface SavingsResult {
  recommendations: SavingsRecommendation[];
  negotiationOpportunities: NegotiationOpportunity[];
  totalPotentialMonthlySavings: number;
  totalPotentialAnnualSavings: number;
}

// ─── Negotiation Opportunity ─────────────────────────────────────────────────

export interface NegotiationOpportunity {
  id: string;
  vendor: string;
  reason: NegotiationReason;
  currentAmount: number;
  targetAmount: number | null;
  estimatedSavings: number;
  confidence: "high" | "medium" | "low";
  context: string;
  draftAvailable: boolean;
  tenure: number; // months subscribed
}

export type NegotiationReason =
  | "price_increase"
  | "competitor_cheaper"
  | "long_tenure_discount"
  | "usage_low"
  | "bulk_opportunity";

// ─── Renewal Alert ───────────────────────────────────────────────────────────

export interface RenewalAlert {
  id: string;
  vendor: string;
  vendorDomain: string;
  amount: number;
  currency: string;
  renewalDate: Date;
  daysUntilRenewal: number;
  autoRenews: boolean;
  autoRenewalFlagged: boolean; // true if user did not explicitly opt in
  applicableLeadTimeAlerts: number[]; // which lead-time thresholds apply (e.g. [30, 7])
  billingFrequency: BillingFrequency;
  category: SubscriptionCategory;
  subscriptionId: string;
}

// ─── Financial Calendar Result ───────────────────────────────────────────────

export interface FinancialCalendarResult {
  entries: CalendarEntry[];
  totalUpcomingCharges: number;
  renewalCount: number;
  trialExpiryCount: number;
  deadlineCount: number;
  refundExpectedCount: number;
}

// ─── Calendar Entry ──────────────────────────────────────────────────────────

export interface CalendarEntry {
  date: Date;
  type:
    | "renewal"
    | "payment_due"
    | "contract_expiry"
    | "notice_deadline"
    | "commitment_due"
    | "trial_expiry"
    | "refund_expected";
  vendor: string;
  amount: number | null;
  description: string;
  featureArea: FeatureArea;
}

// ─── Supporting Types ────────────────────────────────────────────────────────

export interface DateRange {
  start: Date;
  end: Date;
}

export interface MonthlySpend {
  month: string;
  totalAmount: number;
  byCategory: Record<SubscriptionCategory, number>;
  subscriptionCount: number;
}

export interface CategorySpend {
  category: SubscriptionCategory;
  totalAmount: number;
  percentageOfTotal: number;
  subscriptionCount: number;
  trend: "increasing" | "stable" | "decreasing";
}

// ─── Payment Promise Result ──────────────────────────────────────────────────

export interface PaymentPromiseResult {
  openPromises: PaymentPromiseItem[];
  overduePromises: PaymentPromiseItem[];
  fulfilledPromises: PaymentPromiseItem[];
  totalOpenAmount: number;
  totalOverdueAmount: number;
  totalFulfilledAmount: number;
}

export interface PaymentPromiseItem {
  commitmentId: string;
  counterparty: string;
  amount: number | null;
  currency: string;
  dueDate: Date | null;
  status: "open" | "overdue" | "fulfilled";
  daysOverdue: number;
  description: string;
  confidence: number;
  isImplicit: boolean;
  createdAt: Date;
  fulfilledAt: Date | null;
}

// ─── Spend Pattern Analysis ──────────────────────────────────────────────────

export interface SpendAnalysis {
  /** Monthly spending totals for the analysis period */
  monthlyTotals: MonthlySpend[];
  /** Category breakdown with percentage of total spend */
  categoryBreakdown: CategorySpend[];
  /** Month-over-month comparison */
  monthOverMonth: MoMComparison;
  /** Quarter-over-quarter comparison */
  quarterOverQuarter: QoQComparison;
  /** Detected spending anomalies */
  anomalies: SpendAnomaly[];
  /** Natural language insights describing trends */
  insights: string[];
  /** Predicted future monthly spend */
  predictedNextMonthSpend: number;
  /** Top spending category and its percentage of total */
  topCategory: { category: SubscriptionCategory; percentage: number; amount: number };
  /** Total current monthly recurring spend */
  totalMonthlySpend: number;
  /** Analysis date */
  analyzedAt: Date;
}

export interface MoMComparison {
  currentMonth: number;
  previousMonth: number;
  absoluteChange: number;
  percentageChange: number;
  direction: "increasing" | "stable" | "decreasing";
}

export interface QoQComparison {
  currentQuarter: number;
  previousQuarter: number;
  absoluteChange: number;
  percentageChange: number;
  direction: "increasing" | "stable" | "decreasing";
}

export interface SpendAnomaly {
  type: "sudden_increase" | "new_recurring_charge" | "unusual_spike";
  description: string;
  month: string;
  amount: number;
  percentageChange?: number;
  vendor?: string;
}

// ─── Digest Section Items ────────────────────────────────────────────────────

export interface RenewalDigestItem {
  vendor: string;
  amount: number;
  renewalDate: Date;
  autoRenews: boolean;
}

export interface TrialDigestItem {
  vendor: string;
  expiryDate: Date;
  convertsToAmount: number | null;
  autoConverts: boolean;
  daysRemaining: number;
}

export interface RefundDigestItem {
  vendor: string;
  amount: number;
  expectedDate: Date;
  daysOverdue: number;
}

export interface CommitmentDigestItem {
  counterparty: string;
  amount: number | null;
  dueDate: Date | null;
  daysOverdue: number;
}

export interface SavingsDigestItem {
  vendor: string;
  type: "redundancy" | "negotiation" | "billing_switch" | "cancellation";
  monthlySavings: number;
  annualSavings: number;
}

// ─── Commitment Tracking Result ──────────────────────────────────────────────

export interface CommitmentTrackingResult {
  /** Inbound commitments (promises made to the user) */
  inbound: FinancialCommitment[];
  /** Outbound commitments (promises made by the user) */
  outbound: FinancialCommitment[];
  /** Commitments that are overdue (14+ days past due with no activity) */
  overdue: FinancialCommitment[];
  /** All open commitments ranked by financial value */
  openRankedByValue: FinancialCommitment[];
  /** Commitments fed to the Refund Tracker (refund_promise subtypes) */
  refundCommitments: FinancialCommitment[];
  /** Commitments fed to the Payment Promise Tracker (payment_promise subtypes) */
  paymentPromiseCommitments: FinancialCommitment[];
  /** Summary totals */
  totals: CommitmentTotals;
}

export interface CommitmentTotals {
  totalInbound: number;
  totalOutbound: number;
  totalOverdue: number;
  totalOpen: number;
  totalInboundValue: number;
  totalOutboundValue: number;
  totalOverdueValue: number;
}

// ─── Obligation Watch Result ─────────────────────────────────────────────────

export interface ObligationWatchResult {
  /** All active obligations */
  obligations: FinancialObligation[];
  /** Risk flags detected across all obligations */
  riskFlags: ObligationRiskItem[];
  /** Upcoming deadlines across all obligations */
  deadlines: ObligationDeadline[];
  /** Total financial exposure across all active obligations */
  totalFinancialExposure: number;
  /** Obligations grouped by risk severity */
  highRiskObligations: FinancialObligation[];
  /** Summary counts */
  summary: ObligationWatchSummary;
}

export interface ObligationRiskItem {
  obligationId: string;
  contractName: string;
  flag: RiskFlag;
  description: string;
  financialImpact: number | null;
  /** For penalty_clause: the trigger condition */
  triggerCondition?: string;
  /** For penalty_clause: the penalty amount */
  penaltyAmount?: number | null;
}

export interface ObligationWatchSummary {
  totalObligations: number;
  totalRiskFlags: number;
  obligationsWithAutoRenewal: number;
  obligationsWithPenalties: number;
  obligationsWithMissedNotice: number;
  upcomingDeadlineCount: number;
}
