/**
 * Unit tests for the Claude Unified Classifier
 *
 * Tests the classifier's message analysis, urgency scoring, confidence scoring,
 * batch processing, and noise filtering capabilities.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClaudeClassifier } from "./claude-classifier";
import type { ParsedMessage } from "../ingestion/types";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockMessage(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    messageId: "msg-001",
    threadId: "thread-001",
    timestamp: new Date("2025-01-15T10:00:00Z"),
    sender: "billing@spotify.com",
    senderDomain: "spotify.com",
    subject: "Your monthly receipt",
    bodyText: "Your Spotify Premium subscription has been renewed. Amount: $9.99",
    bodyHtml: null,
    attachments: [],
    labels: ["INBOX"],
    snippet: "Your Spotify Premium subscription has been renewed.",
    ...overrides,
  };
}

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockClaudeResponse(result: object) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      content: [{ type: "text", text: JSON.stringify(result) }],
    }),
  });
}

function mockClaudeError(status: number, body: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: async () => body,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ClaudeUnifiedClassifier", () => {
  let classifier: ReturnType<typeof createClaudeClassifier>;

  beforeEach(() => {
    vi.clearAllMocks();
    classifier = createClaudeClassifier({
      apiKey: "test-api-key",
      model: "claude-sonnet-4-20250514",
    });
  });

  describe("analyzeMessage", () => {
    it("should classify a subscription receipt message", async () => {
      mockClaudeResponse({
        classifications: ["subscription_receipt"],
        subscriptionSignal: {
          vendor: "Spotify",
          vendorDomain: "spotify.com",
          amount: 9.99,
          currency: "USD",
          billingFrequency: "monthly",
          category: "music-streaming",
          renewalDate: "2025-02-15T00:00:00Z",
          isActive: true,
          isPriceChange: false,
          autoRenews: true,
        },
        commitmentSignals: [],
        contractSignal: null,
        refundSignal: null,
        trialSignal: null,
        financialEntities: [
          { type: "amount", value: "$9.99", amount: 9.99, currency: "USD", confidence: 0.95 },
        ],
        usageIndicators: [],
        urgencyScore: 3,
        summary: "Monthly Spotify Premium subscription receipt for $9.99.",
      });

      const message = createMockMessage();
      const result = await classifier.analyzeMessage(message);

      expect(result.messageId).toBe("msg-001");
      expect(result.threadId).toBe("thread-001");
      expect(result.sender).toBe("billing@spotify.com");
      expect(result.senderDomain).toBe("spotify.com");
      expect(result.classifications).toContain("subscription_receipt");
      expect(result.subscriptionSignal).not.toBeNull();
      expect(result.subscriptionSignal!.vendor).toBe("Spotify");
      expect(result.subscriptionSignal!.amount).toBe(9.99);
      expect(result.subscriptionSignal!.billingFrequency).toBe("monthly");
      expect(result.subscriptionSignal!.category).toBe("music-streaming");
      expect(result.subscriptionSignal!.autoRenews).toBe(true);
      expect(result.urgencyScore).toBeGreaterThanOrEqual(0);
      expect(result.urgencyScore).toBeLessThanOrEqual(10);
    });

    it("should classify a refund signal", async () => {
      mockClaudeResponse({
        classifications: ["refund_notice"],
        subscriptionSignal: null,
        commitmentSignals: [],
        contractSignal: null,
        refundSignal: {
          vendor: "Amazon",
          amount: 29.99,
          currency: "USD",
          status: "processed",
          expectedDate: "2025-01-20T00:00:00Z",
          originalTransactionDate: "2025-01-10T00:00:00Z",
          reason: "Item returned",
        },
        trialSignal: null,
        financialEntities: [],
        usageIndicators: [],
        urgencyScore: 4,
        summary: "Amazon refund of $29.99 processed for returned item.",
      });

      const message = createMockMessage({
        sender: "returns@amazon.com",
        senderDomain: "amazon.com",
        subject: "Your refund has been processed",
        bodyText: "We've processed your refund of $29.99 for your returned item.",
      });

      const result = await classifier.analyzeMessage(message);

      expect(result.classifications).toContain("refund_notice");
      expect(result.refundSignal).not.toBeNull();
      expect(result.refundSignal!.vendor).toBe("Amazon");
      expect(result.refundSignal!.amount).toBe(29.99);
      expect(result.refundSignal!.status).toBe("processed");
      expect(result.refundSignal!.expectedDate).toBeInstanceOf(Date);
    });

    it("should classify a trial expiry signal with high urgency", async () => {
      const trialEndDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

      mockClaudeResponse({
        classifications: ["trial_expiry"],
        subscriptionSignal: null,
        commitmentSignals: [],
        contractSignal: null,
        refundSignal: null,
        trialSignal: {
          vendor: "Adobe Creative Cloud",
          trialStartDate: "2025-01-01T00:00:00Z",
          trialEndDate: trialEndDate.toISOString(),
          convertsToAmount: 54.99,
          convertsToFrequency: "monthly",
          autoConverts: true,
          cancellationUrl: "https://account.adobe.com/cancel",
        },
        financialEntities: [],
        usageIndicators: [],
        urgencyScore: 10,
        summary: "Adobe Creative Cloud trial expiring in 24 hours, auto-converts to $54.99/month.",
      });

      const message = createMockMessage({
        sender: "noreply@adobe.com",
        senderDomain: "adobe.com",
        subject: "Your trial ends tomorrow",
        bodyText: "Your Adobe Creative Cloud trial expires tomorrow. You'll be charged $54.99/month.",
      });

      const result = await classifier.analyzeMessage(message);

      expect(result.classifications).toContain("trial_expiry");
      expect(result.trialSignal).not.toBeNull();
      expect(result.trialSignal!.vendor).toBe("Adobe Creative Cloud");
      expect(result.trialSignal!.autoConverts).toBe(true);
      expect(result.trialSignal!.convertsToAmount).toBe(54.99);
      // Urgency should be 10 for trial expiring within 48h that auto-converts
      expect(result.urgencyScore).toBe(10);
    });

    it("should assign urgency 9 for trial auto-converting to >$20/month", async () => {
      const trialEndDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

      mockClaudeResponse({
        classifications: ["trial_expiry"],
        subscriptionSignal: null,
        commitmentSignals: [],
        contractSignal: null,
        refundSignal: null,
        trialSignal: {
          vendor: "Notion",
          trialStartDate: "2025-01-01T00:00:00Z",
          trialEndDate: trialEndDate.toISOString(),
          convertsToAmount: 25.0,
          convertsToFrequency: "monthly",
          autoConverts: true,
        },
        financialEntities: [],
        usageIndicators: [],
        urgencyScore: 7,
        summary: "Notion trial expiring in 7 days, auto-converts to $25/month.",
      });

      const message = createMockMessage({
        sender: "team@notion.so",
        senderDomain: "notion.so",
        subject: "Your trial ends in 7 days",
        bodyText: "Your Notion trial will end in 7 days and convert to $25/month.",
      });

      const result = await classifier.analyzeMessage(message);

      expect(result.urgencyScore).toBe(9);
    });

    it("should classify commitment signals with confidence scoring", async () => {
      mockClaudeResponse({
        classifications: ["payment_promise", "financial_commitment"],
        subscriptionSignal: null,
        commitmentSignals: [
          {
            type: "inbound",
            subtype: "payment_promise",
            description: "Client promises to pay invoice by end of week",
            owner: "John Smith",
            counterparty: "user@example.com",
            dueDate: "2025-01-20T00:00:00Z",
            financialValue: 5000,
            isImplicit: false,
            confidence: 0.85,
          },
        ],
        contractSignal: null,
        refundSignal: null,
        trialSignal: null,
        financialEntities: [],
        usageIndicators: [],
        urgencyScore: 6,
        summary: "Client John Smith promises to pay $5000 by end of week.",
      });

      const message = createMockMessage({
        sender: "john@client.com",
        senderDomain: "client.com",
        subject: "Re: Invoice #1234",
        bodyText: "I'll have the $5,000 payment to you by Friday.",
      });

      const result = await classifier.analyzeMessage(message);

      expect(result.classifications).toContain("payment_promise");
      expect(result.commitmentSignals).toHaveLength(1);
      expect(result.commitmentSignals[0].type).toBe("inbound");
      expect(result.commitmentSignals[0].subtype).toBe("payment_promise");
      expect(result.commitmentSignals[0].confidence).toBe(0.85);
      expect(result.commitmentSignals[0].financialValue).toBe(5000);
      expect(result.commitmentSignals[0].isImplicit).toBe(false);
    });

    it("should classify contract signals", async () => {
      mockClaudeResponse({
        classifications: ["contract_terms"],
        subscriptionSignal: null,
        commitmentSignals: [],
        contractSignal: {
          contractType: "lease",
          parties: ["User", "Landlord Corp"],
          totalValue: 24000,
          renewalDate: "2026-01-01T00:00:00Z",
          autoRenews: true,
          penaltyClauses: ["Early termination fee of 2 months rent"],
          noticeWindowDays: 60,
          financialExposure: 4000,
          priceEscalationClause: true,
        },
        refundSignal: null,
        trialSignal: null,
        financialEntities: [],
        usageIndicators: [],
        urgencyScore: 5,
        summary: "Lease agreement with auto-renewal and early termination penalty.",
      });

      const message = createMockMessage({
        sender: "leasing@landlord.com",
        senderDomain: "landlord.com",
        subject: "Your lease renewal terms",
        bodyText: "Your lease auto-renews on Jan 1, 2026. 60-day notice required.",
      });

      const result = await classifier.analyzeMessage(message);

      expect(result.classifications).toContain("contract_terms");
      expect(result.contractSignal).not.toBeNull();
      expect(result.contractSignal!.contractType).toBe("lease");
      expect(result.contractSignal!.autoRenews).toBe(true);
      expect(result.contractSignal!.penaltyClauses).toHaveLength(1);
      expect(result.contractSignal!.noticeWindowDays).toBe(60);
      expect(result.contractSignal!.priceEscalationClause).toBe(true);
    });

    it("should classify noise messages with urgency 0", async () => {
      mockClaudeResponse({
        classifications: ["noise"],
        subscriptionSignal: null,
        commitmentSignals: [],
        contractSignal: null,
        refundSignal: null,
        trialSignal: null,
        financialEntities: [],
        usageIndicators: [],
        urgencyScore: 0,
        summary: "Marketing newsletter with no financial relevance.",
      });

      const message = createMockMessage({
        sender: "marketing@store.com",
        senderDomain: "store.com",
        subject: "Check out our new products!",
        bodyText: "We have exciting new products for you to explore.",
      });

      const result = await classifier.analyzeMessage(message);

      expect(result.classifications).toEqual(["noise"]);
      expect(result.subscriptionSignal).toBeNull();
      expect(result.commitmentSignals).toHaveLength(0);
      expect(result.contractSignal).toBeNull();
      expect(result.refundSignal).toBeNull();
      expect(result.trialSignal).toBeNull();
      expect(result.urgencyScore).toBe(0);
    });

    it("should detect usage indicators", async () => {
      mockClaudeResponse({
        classifications: ["login_alert"],
        subscriptionSignal: null,
        commitmentSignals: [],
        contractSignal: null,
        refundSignal: null,
        trialSignal: null,
        financialEntities: [],
        usageIndicators: ["login_alert"],
        urgencyScore: 1,
        summary: "Login alert from GitHub.",
      });

      const message = createMockMessage({
        sender: "noreply@github.com",
        senderDomain: "github.com",
        subject: "New sign-in to your account",
        bodyText: "A new sign-in was detected on your GitHub account.",
      });

      const result = await classifier.analyzeMessage(message);

      expect(result.classifications).toContain("login_alert");
      expect(result.usageIndicators).toContain("login_alert");
    });

    it("should handle invalid JSON response gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "This is not valid JSON" }],
        }),
      });

      const message = createMockMessage();
      const result = await classifier.analyzeMessage(message);

      // Should return a noise result
      expect(result.classifications).toEqual(["noise"]);
      expect(result.urgencyScore).toBe(0);
      expect(result.messageId).toBe("msg-001");
    });

    it("should throw on API errors", async () => {
      mockClaudeError(500, "Internal Server Error");

      const message = createMockMessage();
      await expect(classifier.analyzeMessage(message)).rejects.toThrow(
        "Claude API error (500)"
      );
    });

    it("should clamp confidence scores to 0-1 range", async () => {
      mockClaudeResponse({
        classifications: ["financial_commitment"],
        subscriptionSignal: null,
        commitmentSignals: [
          {
            type: "inbound",
            subtype: "payment_promise",
            description: "Promise to pay",
            owner: "Someone",
            counterparty: "User",
            dueDate: null,
            financialValue: 100,
            isImplicit: false,
            confidence: 1.5, // Invalid: above 1
          },
          {
            type: "outbound",
            subtype: "general_financial",
            description: "Vague commitment",
            owner: "User",
            counterparty: "Someone",
            dueDate: null,
            financialValue: null,
            isImplicit: true,
            confidence: -0.2, // Invalid: below 0
          },
        ],
        contractSignal: null,
        refundSignal: null,
        trialSignal: null,
        financialEntities: [],
        usageIndicators: [],
        urgencyScore: 5,
        summary: "Financial commitments detected.",
      });

      const message = createMockMessage();
      const result = await classifier.analyzeMessage(message);

      expect(result.commitmentSignals[0].confidence).toBe(1);
      expect(result.commitmentSignals[1].confidence).toBe(0);
    });

    it("should handle price change signals with elevated urgency", async () => {
      mockClaudeResponse({
        classifications: ["price_change", "subscription_receipt"],
        subscriptionSignal: {
          vendor: "Netflix",
          vendorDomain: "netflix.com",
          amount: 15.49,
          currency: "USD",
          billingFrequency: "monthly",
          category: "video-streaming",
          renewalDate: "2025-02-15T00:00:00Z",
          isActive: true,
          isPriceChange: true,
          previousAmount: 13.99,
          autoRenews: true,
        },
        commitmentSignals: [],
        contractSignal: null,
        refundSignal: null,
        trialSignal: null,
        financialEntities: [],
        usageIndicators: [],
        urgencyScore: 6,
        summary: "Netflix price increased from $13.99 to $15.49/month.",
      });

      const message = createMockMessage({
        sender: "info@netflix.com",
        senderDomain: "netflix.com",
        subject: "Changes to your subscription price",
        bodyText: "Your Netflix subscription will increase from $13.99 to $15.49/month.",
      });

      const result = await classifier.analyzeMessage(message);

      expect(result.classifications).toContain("price_change");
      expect(result.subscriptionSignal!.isPriceChange).toBe(true);
      expect(result.subscriptionSignal!.previousAmount).toBe(13.99);
      expect(result.subscriptionSignal!.amount).toBe(15.49);
      // Price change should have urgency >= 7
      expect(result.urgencyScore).toBeGreaterThanOrEqual(7);
    });

    it("should validate and filter invalid classification types", async () => {
      mockClaudeResponse({
        classifications: ["subscription_receipt", "invalid_type", "noise"],
        subscriptionSignal: null,
        commitmentSignals: [],
        contractSignal: null,
        refundSignal: null,
        trialSignal: null,
        financialEntities: [],
        usageIndicators: [],
        urgencyScore: 3,
        summary: "Test message.",
      });

      const message = createMockMessage();
      const result = await classifier.analyzeMessage(message);

      expect(result.classifications).toContain("subscription_receipt");
      expect(result.classifications).toContain("noise");
      expect(result.classifications).not.toContain("invalid_type");
    });
  });

  describe("analyzeBatch", () => {
    it("should process multiple messages and return results for each", async () => {
      // Mock responses for 3 messages
      mockClaudeResponse({
        classifications: ["subscription_receipt"],
        subscriptionSignal: {
          vendor: "Spotify",
          vendorDomain: "spotify.com",
          amount: 9.99,
          currency: "USD",
          billingFrequency: "monthly",
          category: "music-streaming",
          renewalDate: null,
          isActive: true,
          isPriceChange: false,
          autoRenews: true,
        },
        commitmentSignals: [],
        contractSignal: null,
        refundSignal: null,
        trialSignal: null,
        financialEntities: [],
        usageIndicators: [],
        urgencyScore: 3,
        summary: "Spotify receipt.",
      });

      mockClaudeResponse({
        classifications: ["noise"],
        subscriptionSignal: null,
        commitmentSignals: [],
        contractSignal: null,
        refundSignal: null,
        trialSignal: null,
        financialEntities: [],
        usageIndicators: [],
        urgencyScore: 0,
        summary: "Marketing email.",
      });

      mockClaudeResponse({
        classifications: ["refund_promise"],
        subscriptionSignal: null,
        commitmentSignals: [
          {
            type: "inbound",
            subtype: "refund_promise",
            description: "Refund promised within 5 days",
            owner: "Support Team",
            counterparty: "User",
            dueDate: "2025-01-20T00:00:00Z",
            financialValue: 50,
            isImplicit: false,
            confidence: 0.8,
          },
        ],
        contractSignal: null,
        refundSignal: {
          vendor: "Store",
          amount: 50,
          currency: "USD",
          status: "promised",
          expectedDate: "2025-01-20T00:00:00Z",
          originalTransactionDate: null,
          reason: "Defective product",
        },
        trialSignal: null,
        financialEntities: [],
        usageIndicators: [],
        urgencyScore: 5,
        summary: "Refund of $50 promised.",
      });

      const messages = [
        createMockMessage({ messageId: "msg-001" }),
        createMockMessage({ messageId: "msg-002", subject: "Sale!" }),
        createMockMessage({ messageId: "msg-003", subject: "Your refund" }),
      ];

      const results = await classifier.analyzeBatch(messages);

      expect(results).toHaveLength(3);
      expect(results[0].messageId).toBe("msg-001");
      expect(results[0].classifications).toContain("subscription_receipt");
      expect(results[1].messageId).toBe("msg-002");
      expect(results[1].classifications).toContain("noise");
      expect(results[2].messageId).toBe("msg-003");
      expect(results[2].classifications).toContain("refund_promise");
      expect(results[2].refundSignal).not.toBeNull();
    });

    it("should handle empty batch", async () => {
      const results = await classifier.analyzeBatch([]);
      expect(results).toHaveLength(0);
    });
  });

  describe("urgency scoring", () => {
    it("should assign urgency 0 to noise-only classifications", async () => {
      mockClaudeResponse({
        classifications: ["noise"],
        subscriptionSignal: null,
        commitmentSignals: [],
        contractSignal: null,
        refundSignal: null,
        trialSignal: null,
        financialEntities: [],
        usageIndicators: [],
        urgencyScore: 2, // Claude might assign non-zero, but rules override
        summary: "Noise.",
      });

      const message = createMockMessage();
      const result = await classifier.analyzeMessage(message);

      expect(result.urgencyScore).toBe(0);
    });

    it("should elevate urgency for subscriptions renewing within 3 days", async () => {
      const renewalDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 days

      mockClaudeResponse({
        classifications: ["renewal_notice"],
        subscriptionSignal: {
          vendor: "Adobe",
          vendorDomain: "adobe.com",
          amount: 54.99,
          currency: "USD",
          billingFrequency: "monthly",
          category: "software-saas",
          renewalDate: renewalDate.toISOString(),
          isActive: true,
          isPriceChange: false,
          autoRenews: true,
        },
        commitmentSignals: [],
        contractSignal: null,
        refundSignal: null,
        trialSignal: null,
        financialEntities: [],
        usageIndicators: [],
        urgencyScore: 6,
        summary: "Adobe subscription renewing in 2 days.",
      });

      const message = createMockMessage({
        sender: "billing@adobe.com",
        senderDomain: "adobe.com",
        subject: "Your subscription renews soon",
        bodyText: "Your Adobe subscription renews in 2 days.",
      });

      const result = await classifier.analyzeMessage(message);

      expect(result.urgencyScore).toBeGreaterThanOrEqual(8);
    });

    it("should assign urgency 1 for login alerts (low priority)", async () => {
      mockClaudeResponse({
        classifications: ["login_alert"],
        subscriptionSignal: null,
        commitmentSignals: [],
        contractSignal: null,
        refundSignal: null,
        trialSignal: null,
        financialEntities: [],
        usageIndicators: ["login_alert"],
        urgencyScore: 1,
        summary: "Login alert from service.",
      });

      const message = createMockMessage({
        sender: "noreply@github.com",
        senderDomain: "github.com",
        subject: "New sign-in detected",
        bodyText: "A new sign-in was detected on your account.",
      });

      const result = await classifier.analyzeMessage(message);

      expect(result.urgencyScore).toBeLessThanOrEqual(2);
    });

    it("should assign elevated urgency for failed refunds", async () => {
      mockClaudeResponse({
        classifications: ["refund_notice"],
        subscriptionSignal: null,
        commitmentSignals: [],
        contractSignal: null,
        refundSignal: {
          vendor: "Store",
          amount: 150,
          currency: "USD",
          status: "failed",
          expectedDate: null,
          originalTransactionDate: null,
          reason: "Payment method issue",
        },
        trialSignal: null,
        financialEntities: [],
        usageIndicators: [],
        urgencyScore: 6,
        summary: "Refund of $150 failed.",
      });

      const message = createMockMessage({
        sender: "support@store.com",
        senderDomain: "store.com",
        subject: "Refund failed",
        bodyText: "Your refund of $150 could not be processed.",
      });

      const result = await classifier.analyzeMessage(message);

      // Failed refunds should get urgency >= 8
      expect(result.urgencyScore).toBeGreaterThanOrEqual(8);
    });

    it("should assign moderate urgency for invoices and payment reminders", async () => {
      mockClaudeResponse({
        classifications: ["invoice", "payment_reminder"],
        subscriptionSignal: null,
        commitmentSignals: [],
        contractSignal: null,
        refundSignal: null,
        trialSignal: null,
        financialEntities: [
          { type: "amount", value: "$500", amount: 500, currency: "USD", confidence: 0.9 },
        ],
        usageIndicators: [],
        urgencyScore: 5,
        summary: "Invoice payment reminder for $500.",
      });

      const message = createMockMessage({
        sender: "billing@vendor.com",
        senderDomain: "vendor.com",
        subject: "Payment reminder: Invoice #1234",
        bodyText: "Your invoice of $500 is due soon.",
      });

      const result = await classifier.analyzeMessage(message);

      // Invoice/payment reminders should have moderate urgency (3-7 range)
      expect(result.urgencyScore).toBeGreaterThanOrEqual(3);
      expect(result.urgencyScore).toBeLessThanOrEqual(7);
    });

    it("should assign urgency based on contract deadline proximity", async () => {
      const renewalDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days

      mockClaudeResponse({
        classifications: ["contract_terms"],
        subscriptionSignal: null,
        commitmentSignals: [],
        contractSignal: {
          contractType: "service_agreement",
          parties: ["User", "Provider"],
          totalValue: 5000,
          renewalDate: renewalDate.toISOString(),
          autoRenews: true,
          penaltyClauses: ["Early termination fee of $500"],
          noticeWindowDays: 30,
          financialExposure: 5000,
          priceEscalationClause: false,
        },
        refundSignal: null,
        trialSignal: null,
        financialEntities: [],
        usageIndicators: [],
        urgencyScore: 6,
        summary: "Service agreement renewing in 5 days.",
      });

      const message = createMockMessage({
        sender: "contracts@provider.com",
        senderDomain: "provider.com",
        subject: "Contract renewal notice",
        bodyText: "Your service agreement renews in 5 days.",
      });

      const result = await classifier.analyzeMessage(message);

      // Contract renewing within 7 days should have urgency >= 7
      expect(result.urgencyScore).toBeGreaterThanOrEqual(7);
    });
  });
});
