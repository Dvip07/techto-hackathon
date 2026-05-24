/**
 * Signal interfaces extracted by the Claude Unified Classifier.
 */

import type {
  BillingFrequency,
  FinancialSignalType,
  SubscriptionCategory,
} from "./enums";

// ─── Analyzed Message ────────────────────────────────────────────────────────

export interface AnalyzedMessage {
  messageId: string;
  threadId: string;
  timestamp: Date;
  sender: string;
  senderDomain: string;
  classifications: FinancialSignalType[];
  subscriptionSignal: SubscriptionSignal | null;
  commitmentSignals: CommitmentSignal[];
  contractSignal: ContractSignal | null;
  refundSignal: RefundSignal | null;
  trialSignal: TrialSignal | null;
  financialEntities: FinancialEntity[];
  usageIndicators: UsageIndicator[];
  urgencyScore: number; // 0-10
  summary: string;
}

// ─── Subscription Signal ─────────────────────────────────────────────────────

export interface SubscriptionSignal {
  vendor: string;
  vendorDomain: string;
  amount: number;
  currency: string;
  billingFrequency: BillingFrequency;
  category: SubscriptionCategory;
  renewalDate: Date | null;
  isActive: boolean;
  isPriceChange: boolean;
  previousAmount?: number;
  autoRenews: boolean;
  trialEndsDate?: Date;
  annualPlanAvailable?: boolean;
  annualPlanAmount?: number;
}

// ─── Refund Signal ───────────────────────────────────────────────────────────

export interface RefundSignal {
  vendor: string;
  amount: number;
  currency: string;
  status: "promised" | "confirmed" | "processed" | "failed";
  expectedDate: Date | null;
  originalTransactionDate: Date | null;
  reason: string;
}

// ─── Trial Signal ────────────────────────────────────────────────────────────

export interface TrialSignal {
  vendor: string;
  trialStartDate: Date;
  trialEndDate: Date;
  convertsToAmount: number | null;
  convertsToFrequency: BillingFrequency | null;
  autoConverts: boolean;
  cancellationUrl?: string;
}

// ─── Commitment Signal ───────────────────────────────────────────────────────

export interface CommitmentSignal {
  type: "outbound" | "inbound";
  subtype:
    | "payment_promise"
    | "refund_promise"
    | "invoice_promise"
    | "general_financial"
    | "non_financial";
  description: string;
  owner: string;
  counterparty: string;
  dueDate: Date | null;
  financialValue: number | null;
  isImplicit: boolean;
  confidence: number; // 0-1
}

// ─── Contract Signal ─────────────────────────────────────────────────────────

export interface ContractSignal {
  contractType:
    | "subscription_tos"
    | "lease"
    | "service_agreement"
    | "loan"
    | "insurance"
    | "other";
  parties: string[];
  totalValue: number | null;
  renewalDate: Date | null;
  autoRenews: boolean;
  penaltyClauses: string[];
  noticeWindowDays: number | null;
  financialExposure: number;
  priceEscalationClause: boolean;
}

// ─── Usage Indicator ─────────────────────────────────────────────────────────

export type UsageIndicator =
  | "login_alert"
  | "usage_report"
  | "feature_update"
  | "support_interaction"
  | "newsletter_engagement";

// ─── Financial Entity (generic extracted entity) ─────────────────────────────

export interface FinancialEntity {
  type: string;
  value: string;
  amount?: number;
  currency?: string;
  date?: Date;
  confidence: number;
}
