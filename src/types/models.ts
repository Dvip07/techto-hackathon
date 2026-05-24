/**
 * Core data model interfaces for the Entity Store.
 */

import type {
  BillingFrequency,
  CommitmentStatus,
  ContractType,
  RiskFlag,
  SubscriptionCategory,
  SubscriptionStatus,
} from "./enums";

// ─── Subscription Ledger ─────────────────────────────────────────────────────

export interface SubscriptionRecord {
  id: string;
  vendor: string;
  vendorDomain: string;
  amount: number;
  currency: string;
  billingFrequency: BillingFrequency;
  category: SubscriptionCategory;
  status: SubscriptionStatus;
  usageScore: number; // 0-10
  wasteScore: number; // 0-10
  firstSeenDate: Date;
  lastPaymentDate: Date;
  nextRenewalDate: Date | null;
  autoRenews: boolean;
  trialEndsDate: Date | null;
  annualPlanAvailable: boolean;
  annualPlanAmount: number | null;
  annualSavingsIfSwitched: number | null;
  priceChangeHistory: PriceChange[];
  sourceMessageIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PriceChange {
  previousAmount: number;
  newAmount: number;
  detectedDate: Date;
  percentageChange: number;
  sourceMessageId: string;
}

// ─── Free Trial Registry ─────────────────────────────────────────────────────

export interface TrialRecord {
  id: string;
  vendor: string;
  vendorDomain: string;
  category: SubscriptionCategory;
  trialStartDate: Date;
  trialEndDate: Date;
  daysRemaining: number;
  convertsToAmount: number | null;
  convertsToFrequency: BillingFrequency | null;
  autoConverts: boolean;
  cancellationUrl: string | null;
  status: "active" | "expiring_soon" | "expired" | "cancelled";
  reminderScheduled: boolean;
  sourceMessageId: string;
}

// ─── Refund Tracker ──────────────────────────────────────────────────────────

export interface RefundRecord {
  id: string;
  vendor: string;
  amount: number;
  currency: string;
  promisedDate: Date | null;
  expectedByDate: Date; // promised + 14 days if no date given
  actualReceivedDate: Date | null;
  status: "promised" | "processing" | "received" | "overdue" | "disputed";
  daysOverdue: number;
  originalTransactionDate: Date | null;
  reason: string;
  sourceMessageIds: string[];
  lastFollowUpDate: Date | null;
}

// ─── Commitment Ledger ───────────────────────────────────────────────────────

export interface FinancialCommitment {
  id: string;
  messageId: string;
  threadId: string;
  type: "outbound" | "inbound";
  subtype:
    | "payment_promise"
    | "refund_promise"
    | "invoice_promise"
    | "general_financial";
  description: string;
  owner: string;
  counterparty: string;
  financialValue: number | null;
  currency: string;
  dueDate: Date | null;
  status: CommitmentStatus;
  isImplicit: boolean;
  confidence: number; // 0-1
  priority: number;
  createdAt: Date;
  updatedAt: Date;
  fulfilledAt: Date | null;
  lastFollowUpDate: Date | null;
}

// ─── Obligation Ledger ───────────────────────────────────────────────────────

export interface FinancialObligation {
  id: string;
  contractName: string;
  contractType: ContractType;
  parties: string[];
  totalValue: number | null;
  currency: string;
  recurringAmount: number | null;
  paymentFrequency: BillingFrequency | null;
  keyDates: ObligationDeadline[];
  penaltyClauses: PenaltyClause[];
  autoRenews: boolean;
  noticeWindowDays: number | null;
  financialExposure: number;
  riskFlags: RiskFlag[];
  sourceMessageIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ObligationDeadline {
  id: string;
  date: Date;
  type:
    | "payment_due"
    | "renewal"
    | "expiry"
    | "notice_period"
    | "penalty_trigger"
    | "rate_change";
  description: string;
  financialConsequence: string | null;
  amount: number | null;
  leadTimeAlerts: number[];
  acknowledged: boolean;
}

export interface PenaltyClause {
  description: string;
  triggerCondition: string;
  penaltyAmount: number | null;
  penaltyType: "fixed" | "percentage" | "variable";
}

// ─── Payment History ─────────────────────────────────────────────────────────

export interface PaymentRecord {
  id: string;
  vendor: string;
  amount: number;
  currency: string;
  category: SubscriptionCategory;
  date: Date;
  type: "subscription" | "one-time" | "contract" | "invoice" | "refund";
  sourceMessageId: string;
}
