/**
 * Claude Unified Classifier
 *
 * Single Claude prompt chain that classifies every message, extracts all financial
 * entities, detects commitments, identifies subscription signals, flags contract terms,
 * detects trial expiry notices, refund confirmations, and payment promises — all in one pass.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8
 */

import type { ParsedMessage } from "../ingestion/types";
import type {
  AnalyzedMessage,
  CommitmentSignal,
  ContractSignal,
  FinancialEntity,
  RefundSignal,
  SubscriptionSignal,
  TrialSignal,
  UsageIndicator,
} from "../types/signals";
import type { FinancialSignalType } from "../types/enums";

// ─── Classifier Interface ────────────────────────────────────────────────────

export interface ClaudeUnifiedClassifier {
  analyzeMessage(message: ParsedMessage): Promise<AnalyzedMessage>;
  analyzeBatch(messages: ParsedMessage[]): Promise<AnalyzedMessage[]>;
}

// ─── Claude API Types ────────────────────────────────────────────────────────

export interface ClaudeAPIConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  baseUrl?: string;
}

interface ClaudeAPIMessage {
  role: "user" | "assistant";
  content: string;
}

interface ClaudeAPIResponse {
  content: Array<{ type: "text"; text: string }>;
}

// ─── Raw Classification Result (from Claude JSON output) ─────────────────────

interface RawClassificationResult {
  classifications: FinancialSignalType[];
  subscriptionSignal: RawSubscriptionSignal | null;
  commitmentSignals: RawCommitmentSignal[];
  contractSignal: RawContractSignal | null;
  refundSignal: RawRefundSignal | null;
  trialSignal: RawTrialSignal | null;
  financialEntities: RawFinancialEntity[];
  usageIndicators: UsageIndicator[];
  urgencyScore: number;
  summary: string;
}

interface RawSubscriptionSignal {
  vendor: string;
  vendorDomain: string;
  amount: number;
  currency: string;
  billingFrequency: string;
  category: string;
  renewalDate: string | null;
  isActive: boolean;
  isPriceChange: boolean;
  previousAmount?: number;
  autoRenews: boolean;
  trialEndsDate?: string;
  annualPlanAvailable?: boolean;
  annualPlanAmount?: number;
}

interface RawCommitmentSignal {
  type: "outbound" | "inbound";
  subtype: string;
  description: string;
  owner: string;
  counterparty: string;
  dueDate: string | null;
  financialValue: number | null;
  isImplicit: boolean;
  confidence: number;
}

interface RawContractSignal {
  contractType: string;
  parties: string[];
  totalValue: number | null;
  renewalDate: string | null;
  autoRenews: boolean;
  penaltyClauses: string[];
  noticeWindowDays: number | null;
  financialExposure: number;
  priceEscalationClause: boolean;
}

interface RawRefundSignal {
  vendor: string;
  amount: number;
  currency: string;
  status: string;
  expectedDate: string | null;
  originalTransactionDate: string | null;
  reason: string;
}

interface RawTrialSignal {
  vendor: string;
  trialStartDate: string;
  trialEndDate: string;
  convertsToAmount: number | null;
  convertsToFrequency: string | null;
  autoConverts: boolean;
  cancellationUrl?: string;
}

interface RawFinancialEntity {
  type: string;
  value: string;
  amount?: number;
  currency?: string;
  date?: string;
  confidence: number;
}

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a financial email classifier. Analyze the given email and extract ALL financial signals in a single pass.

You MUST respond with valid JSON matching this exact schema:

{
  "classifications": string[],  // Array of FinancialSignalType values
  "subscriptionSignal": object | null,
  "commitmentSignals": array,
  "contractSignal": object | null,
  "refundSignal": object | null,
  "trialSignal": object | null,
  "financialEntities": array,
  "usageIndicators": array,
  "urgencyScore": number,  // 0-10
  "summary": string
}

## Classification Types (FinancialSignalType)
Choose ALL that apply from:
- "subscription_receipt" - Payment confirmation for a subscription
- "subscription_confirmation" - New subscription started
- "renewal_notice" - Upcoming renewal notification
- "price_change" - Price increase or decrease notification
- "cancellation_confirmation" - Subscription cancelled
- "invoice" - Invoice or bill
- "payment_reminder" - Payment due reminder
- "contract_terms" - Contract, lease, or service agreement terms
- "financial_commitment" - Promise to pay or be paid
- "refund_notice" - Refund processed or confirmed
- "refund_promise" - Refund promised but not yet processed
- "credit_applied" - Credit applied to account
- "demand_letter" - Demand for payment
- "auto_renewal_notice" - Auto-renewal warning
- "trial_expiry" - Free trial ending soon
- "trial_started" - Free trial started
- "payment_promise" - Someone promises to pay
- "payment_received" - Payment received confirmation
- "annual_plan_offer" - Offer to switch to annual billing
- "login_alert" - Login notification from a service
- "usage_report" - Usage summary from a service
- "noise" - Not financially relevant

## Subscription Signal (when subscription-related)
{
  "vendor": "Company Name",
  "vendorDomain": "company.com",
  "amount": 9.99,
  "currency": "USD",
  "billingFrequency": "monthly" | "weekly" | "quarterly" | "semi-annual" | "annual" | "one-time",
  "category": "music-streaming" | "video-streaming" | "productivity" | "cloud-storage" | "fitness" | "news-media" | "software-saas" | "security-vpn" | "food-delivery" | "gaming" | "education" | "utilities" | "insurance" | "other",
  "renewalDate": "ISO date string" | null,
  "isActive": true/false,
  "isPriceChange": true/false,
  "previousAmount": number (only if isPriceChange),
  "autoRenews": true/false,
  "trialEndsDate": "ISO date string" (optional),
  "annualPlanAvailable": true/false (optional),
  "annualPlanAmount": number (optional)
}

## Commitment Signals (array, can be multiple per message)
{
  "type": "outbound" | "inbound",
  "subtype": "payment_promise" | "refund_promise" | "invoice_promise" | "general_financial" | "non_financial",
  "description": "Brief description of the commitment",
  "owner": "Who made the promise",
  "counterparty": "Who the promise is to",
  "dueDate": "ISO date string" | null,
  "financialValue": number | null,
  "isImplicit": true/false,
  "confidence": 0.0-1.0
}

Confidence scoring guidelines:
- 1.0: Explicit statement with specific amount and date ("I will pay $500 by Friday")
- 0.8-0.9: Explicit statement with some details missing ("We'll refund you within 5 days")
- 0.6-0.7: Clear intent but vague on specifics ("I'll get that payment to you soon")
- 0.4-0.5: Implicit commitment ("We're working on processing your refund")
- 0.2-0.3: Weak indication ("We'll look into it")

## Contract Signal (when contract/agreement detected)
{
  "contractType": "subscription_tos" | "lease" | "service_agreement" | "loan" | "insurance" | "other",
  "parties": ["Party A", "Party B"],
  "totalValue": number | null,
  "renewalDate": "ISO date string" | null,
  "autoRenews": true/false,
  "penaltyClauses": ["description of penalty clause"],
  "noticeWindowDays": number | null,
  "financialExposure": number,
  "priceEscalationClause": true/false
}

## Refund Signal (when refund-related)
{
  "vendor": "Company Name",
  "amount": 29.99,
  "currency": "USD",
  "status": "promised" | "confirmed" | "processed" | "failed",
  "expectedDate": "ISO date string" | null,
  "originalTransactionDate": "ISO date string" | null,
  "reason": "Brief reason for refund"
}

## Trial Signal (when trial-related)
{
  "vendor": "Company Name",
  "trialStartDate": "ISO date string",
  "trialEndDate": "ISO date string",
  "convertsToAmount": number | null,
  "convertsToFrequency": "monthly" | "annual" | null,
  "autoConverts": true/false,
  "cancellationUrl": "URL" (optional)
}

## Usage Indicators (array of strings)
Choose from: "login_alert", "usage_report", "feature_update", "support_interaction", "newsletter_engagement"

## Financial Entities (generic extracted entities)
{
  "type": "amount" | "date" | "vendor" | "account" | "reference",
  "value": "extracted text",
  "amount": number (if applicable),
  "currency": "USD" (if applicable),
  "date": "ISO date string" (if applicable),
  "confidence": 0.0-1.0
}

## Urgency Score (0-10)
Assign based on financial impact and time sensitivity:
- 10: Trial expiring within 48 hours that auto-converts
- 9: Trial auto-converting to plan >$20/month; large payment overdue
- 8: Renewal within 3 days; significant refund overdue
- 7: Contract deadline approaching; price increase effective soon
- 6: Renewal within 7 days; moderate financial commitment due
- 5: Renewal within 14 days; payment promise approaching due date
- 4: Renewal within 30 days; general financial notification
- 3: Informational subscription update; usage report
- 2: Newsletter; feature update; low-priority notification
- 1: Login alert; routine notification
- 0: Noise; not financially relevant

Always respond with ONLY the JSON object, no additional text.`;

// ─── Implementation ──────────────────────────────────────────────────────────

export function createClaudeClassifier(config: ClaudeAPIConfig): ClaudeUnifiedClassifier {
  const model = config.model ?? "claude-haiku-4-5-20251001";
  const maxTokens = config.maxTokens ?? 50000;
  const baseUrl = config.baseUrl ?? "https://api.anthropic.com";

  async function callClaudeAPI(messages: ClaudeAPIMessage[]): Promise<string> {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Claude API error (${response.status}): ${errorBody}`
      );
    }

    const data = (await response.json()) as ClaudeAPIResponse;
    return data.content[0].text;
  }

  function buildUserPrompt(message: ParsedMessage): string {
    const parts: string[] = [
      `From: ${message.sender} (${message.senderDomain})`,
      `Date: ${message.timestamp.toISOString()}`,
      `Subject: ${message.subject}`,
      "",
      "--- Email Body ---",
      message.bodyText,
    ];

    if (message.attachments.length > 0) {
      parts.push("", "--- Attachments ---");
      for (const attachment of message.attachments) {
        parts.push(`[${attachment.filename} (${attachment.mimeType})]`);
        if (attachment.content) {
          parts.push(attachment.content.slice(0, 2000));
        }
      }
    }

    return parts.join("\n");
  }

  function parseDate(dateStr: string | null | undefined): Date | null {
    if (!dateStr) return null;
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function normalizeSubscriptionSignal(
    raw: RawSubscriptionSignal | null
  ): SubscriptionSignal | null {
    if (!raw) return null;
    return {
      vendor: raw.vendor,
      vendorDomain: raw.vendorDomain,
      amount: raw.amount,
      currency: raw.currency,
      billingFrequency: raw.billingFrequency as SubscriptionSignal["billingFrequency"],
      category: raw.category as SubscriptionSignal["category"],
      renewalDate: parseDate(raw.renewalDate),
      isActive: raw.isActive,
      isPriceChange: raw.isPriceChange,
      previousAmount: raw.previousAmount,
      autoRenews: raw.autoRenews,
      trialEndsDate: parseDate(raw.trialEndsDate) ?? undefined,
      annualPlanAvailable: raw.annualPlanAvailable,
      annualPlanAmount: raw.annualPlanAmount,
    };
  }

  function normalizeCommitmentSignals(
    raw: RawCommitmentSignal[]
  ): CommitmentSignal[] {
    return raw.map((r) => ({
      type: r.type,
      subtype: r.subtype as CommitmentSignal["subtype"],
      description: r.description,
      owner: r.owner,
      counterparty: r.counterparty,
      dueDate: parseDate(r.dueDate),
      financialValue: r.financialValue,
      isImplicit: r.isImplicit,
      confidence: Math.max(0, Math.min(1, r.confidence)),
    }));
  }

  function normalizeContractSignal(
    raw: RawContractSignal | null
  ): ContractSignal | null {
    if (!raw) return null;
    return {
      contractType: raw.contractType as ContractSignal["contractType"],
      parties: raw.parties,
      totalValue: raw.totalValue,
      renewalDate: parseDate(raw.renewalDate),
      autoRenews: raw.autoRenews,
      penaltyClauses: raw.penaltyClauses,
      noticeWindowDays: raw.noticeWindowDays,
      financialExposure: raw.financialExposure,
      priceEscalationClause: raw.priceEscalationClause,
    };
  }

  function normalizeRefundSignal(
    raw: RawRefundSignal | null
  ): RefundSignal | null {
    if (!raw) return null;
    return {
      vendor: raw.vendor,
      amount: raw.amount,
      currency: raw.currency,
      status: raw.status as RefundSignal["status"],
      expectedDate: parseDate(raw.expectedDate),
      originalTransactionDate: parseDate(raw.originalTransactionDate),
      reason: raw.reason,
    };
  }

  function normalizeTrialSignal(
    raw: RawTrialSignal | null
  ): TrialSignal | null {
    if (!raw) return null;
    const startDate = parseDate(raw.trialStartDate);
    const endDate = parseDate(raw.trialEndDate);
    if (!startDate || !endDate) return null;
    return {
      vendor: raw.vendor,
      trialStartDate: startDate,
      trialEndDate: endDate,
      convertsToAmount: raw.convertsToAmount,
      convertsToFrequency: raw.convertsToFrequency as TrialSignal["convertsToFrequency"],
      autoConverts: raw.autoConverts,
      cancellationUrl: raw.cancellationUrl,
    };
  }

  function normalizeFinancialEntities(
    raw: RawFinancialEntity[]
  ): FinancialEntity[] {
    return raw.map((r) => ({
      type: r.type,
      value: r.value,
      amount: r.amount,
      currency: r.currency,
      date: parseDate(r.date) ?? undefined,
      confidence: Math.max(0, Math.min(1, r.confidence)),
    }));
  }

  function clampUrgencyScore(score: number): number {
    return Math.max(0, Math.min(10, Math.round(score)));
  }

  function computeUrgencyScore(
    raw: RawClassificationResult,
    message: ParsedMessage
  ): number {
    // Use Claude's assigned score as the base, but apply rules-based overrides
    // for specific high-urgency scenarios per requirements
    let score = clampUrgencyScore(raw.urgencyScore);

    // Requirement 7.4 / 18.2: Trial expiring within 48 hours → urgency 10
    if (raw.trialSignal) {
      const endDate = parseDate(raw.trialSignal.trialEndDate);
      if (endDate) {
        const hoursUntilExpiry =
          (endDate.getTime() - Date.now()) / (1000 * 60 * 60);
        if (hoursUntilExpiry <= 48 && hoursUntilExpiry > 0 && raw.trialSignal.autoConverts) {
          score = 10;
        }
        // Requirement 7.3 / 18.3: Auto-converts to >$20/month → urgency 9
        else if (
          raw.trialSignal.autoConverts &&
          raw.trialSignal.convertsToAmount !== null &&
          raw.trialSignal.convertsToAmount > 20
        ) {
          score = Math.max(score, 9);
        }
      }
    }

    // High urgency for large overdue refunds
    if (raw.refundSignal && raw.refundSignal.status === "failed") {
      score = Math.max(score, 8);
    }

    // Contract deadlines approaching
    if (raw.contractSignal && raw.contractSignal.noticeWindowDays !== null) {
      const renewalDate = parseDate(raw.contractSignal.renewalDate);
      if (renewalDate) {
        const daysUntil =
          (renewalDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
        if (daysUntil <= 3) score = Math.max(score, 8);
        else if (daysUntil <= 7) score = Math.max(score, 7);
        else if (daysUntil <= 14) score = Math.max(score, 6);
        else if (daysUntil <= 30) score = Math.max(score, 5);
      }
    }

    // Subscription renewal approaching
    if (raw.subscriptionSignal) {
      const renewalDate = parseDate(raw.subscriptionSignal.renewalDate);
      if (renewalDate) {
        const daysUntil =
          (renewalDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
        if (daysUntil <= 3) score = Math.max(score, 8);
        else if (daysUntil <= 7) score = Math.max(score, 6);
        else if (daysUntil <= 14) score = Math.max(score, 5);
        else if (daysUntil <= 30) score = Math.max(score, 4);
      }

      // Price change detected
      if (raw.subscriptionSignal.isPriceChange) {
        score = Math.max(score, 7);
      }
    }

    // Noise gets 0
    if (
      raw.classifications.length === 1 &&
      raw.classifications[0] === "noise"
    ) {
      score = 0;
    }

    return score;
  }

  async function analyzeMessage(message: ParsedMessage): Promise<AnalyzedMessage> {
    const userPrompt = buildUserPrompt(message);

    const responseText = await callClaudeAPI([
      { role: "user", content: userPrompt },
    ]);

    let rawResult: RawClassificationResult;
    try {
      rawResult = JSON.parse(responseText) as RawClassificationResult;
    } catch {
      // If Claude returns invalid JSON, return a noise classification
      return createNoiseResult(message);
    }

    // Validate and normalize the result
    const urgencyScore = computeUrgencyScore(rawResult, message);

    return {
      messageId: message.messageId,
      threadId: message.threadId,
      timestamp: message.timestamp,
      sender: message.sender,
      senderDomain: message.senderDomain,
      classifications: validateClassifications(rawResult.classifications),
      subscriptionSignal: normalizeSubscriptionSignal(rawResult.subscriptionSignal),
      commitmentSignals: normalizeCommitmentSignals(rawResult.commitmentSignals ?? []),
      contractSignal: normalizeContractSignal(rawResult.contractSignal),
      refundSignal: normalizeRefundSignal(rawResult.refundSignal),
      trialSignal: normalizeTrialSignal(rawResult.trialSignal),
      financialEntities: normalizeFinancialEntities(rawResult.financialEntities ?? []),
      usageIndicators: validateUsageIndicators(rawResult.usageIndicators ?? []),
      urgencyScore,
      summary: rawResult.summary ?? "",
    };
  }

  async function analyzeBatch(
    messages: ParsedMessage[]
  ): Promise<AnalyzedMessage[]> {
    // Process messages concurrently with a concurrency limit to avoid rate limiting
    const CONCURRENCY_LIMIT = 5;
    const results: AnalyzedMessage[] = [];

    for (let i = 0; i < messages.length; i += CONCURRENCY_LIMIT) {
      const batch = messages.slice(i, i + CONCURRENCY_LIMIT);
      const batchResults = await Promise.all(
        batch.map((msg) => analyzeMessage(msg))
      );
      results.push(...batchResults);
    }

    return results;
  }

  return {
    analyzeMessage,
    analyzeBatch,
  };
}

// ─── Validation Helpers ──────────────────────────────────────────────────────

const VALID_SIGNAL_TYPES: Set<FinancialSignalType> = new Set([
  "subscription_receipt",
  "subscription_confirmation",
  "renewal_notice",
  "price_change",
  "cancellation_confirmation",
  "invoice",
  "payment_reminder",
  "contract_terms",
  "financial_commitment",
  "refund_notice",
  "refund_promise",
  "credit_applied",
  "demand_letter",
  "auto_renewal_notice",
  "trial_expiry",
  "trial_started",
  "payment_promise",
  "payment_received",
  "annual_plan_offer",
  "login_alert",
  "usage_report",
  "noise",
]);

const VALID_USAGE_INDICATORS: Set<UsageIndicator> = new Set([
  "login_alert",
  "usage_report",
  "feature_update",
  "support_interaction",
  "newsletter_engagement",
]);

function validateClassifications(
  classifications: string[]
): FinancialSignalType[] {
  if (!Array.isArray(classifications) || classifications.length === 0) {
    return ["noise"];
  }
  const valid = classifications.filter((c) =>
    VALID_SIGNAL_TYPES.has(c as FinancialSignalType)
  ) as FinancialSignalType[];
  return valid.length > 0 ? valid : ["noise"];
}

function validateUsageIndicators(indicators: string[]): UsageIndicator[] {
  if (!Array.isArray(indicators)) return [];
  return indicators.filter((i) =>
    VALID_USAGE_INDICATORS.has(i as UsageIndicator)
  ) as UsageIndicator[];
}

function createNoiseResult(message: ParsedMessage): AnalyzedMessage {
  return {
    messageId: message.messageId,
    threadId: message.threadId,
    timestamp: message.timestamp,
    sender: message.sender,
    senderDomain: message.senderDomain,
    classifications: ["noise"],
    subscriptionSignal: null,
    commitmentSignals: [],
    contractSignal: null,
    refundSignal: null,
    trialSignal: null,
    financialEntities: [],
    usageIndicators: [],
    urgencyScore: 0,
    summary: "Unable to classify message.",
  };
}
