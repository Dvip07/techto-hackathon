/**
 * Inbox Intelligence — Shared Type Definitions
 *
 * All types are organized into:
 * - enums.ts: Union/enum types (FinancialSignalType, BillingFrequency, etc.)
 * - models.ts: Data model interfaces (SubscriptionRecord, TrialRecord, etc.)
 * - signals.ts: Classifier output interfaces (AnalyzedMessage, signals)
 * - outputs.ts: Intelligence/Action engine output types (PrioritizedItem, SmartDigest, etc.)
 */

export * from "./enums";
export * from "./models";
export * from "./signals";
export * from "./outputs";
