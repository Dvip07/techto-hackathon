/**
 * Core enum/union types shared across the Inbox Intelligence platform.
 */

export type FinancialSignalType =
  | "subscription_receipt"
  | "subscription_confirmation"
  | "renewal_notice"
  | "price_change"
  | "cancellation_confirmation"
  | "invoice"
  | "payment_reminder"
  | "contract_terms"
  | "financial_commitment"
  | "refund_notice"
  | "refund_promise"
  | "credit_applied"
  | "demand_letter"
  | "auto_renewal_notice"
  | "trial_expiry"
  | "trial_started"
  | "payment_promise"
  | "payment_received"
  | "annual_plan_offer"
  | "login_alert"
  | "usage_report"
  | "noise";

export type BillingFrequency =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "semi-annual"
  | "annual"
  | "one-time";

export type SubscriptionCategory =
  | "music-streaming"
  | "video-streaming"
  | "productivity"
  | "cloud-storage"
  | "fitness"
  | "news-media"
  | "software-saas"
  | "security-vpn"
  | "food-delivery"
  | "gaming"
  | "education"
  | "utilities"
  | "insurance"
  | "other";

export type SubscriptionStatus =
  | "active-used"
  | "active-unused"
  | "zombie"
  | "price-increased"
  | "renewing-soon"
  | "trial-active"
  | "cancelled"
  | "unknown";

export type CommitmentStatus = "open" | "fulfilled" | "overdue" | "gone_cold";

export type ContractType =
  | "subscription_tos"
  | "lease"
  | "service_agreement"
  | "loan"
  | "insurance"
  | "employment"
  | "other";

export type RiskFlag =
  | "auto_renewal"
  | "price_escalation"
  | "penalty_clause"
  | "missed_notice_window"
  | "unfavorable_terms"
  | "silent_renewal"
  | "expiring_soon"
  | "high_financial_exposure";

export type FeatureArea =
  | "subscriptions"
  | "usage-scoring"
  | "savings"
  | "trials"
  | "billing-optimizer"
  | "creep-alert"
  | "refunds"
  | "payment-promises"
  | "renewals"
  | "patterns"
  | "commitments"
  | "obligations"
  | "digest";
