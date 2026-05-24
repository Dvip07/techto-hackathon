/**
 * Unit tests for the Intelligence Engine — Annual vs Monthly Optimizer
 *
 * Tests billing optimization identification, break-even calculation,
 * confidence levels, and total savings computation.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IntelligenceEngine } from "./intelligence-engine";
import { SQLiteEntityStore } from "../store/entity-store";
import type { SubscriptionRecord } from "../types/models";
import type { AnalyzedMessage } from "../types/signals";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createSubscription(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    id: "sub-1",
    vendor: "Notion",
    vendorDomain: "notion.so",
    amount: 10,
    currency: "USD",
    billingFrequency: "monthly",
    category: "productivity",
    status: "active-used",
    usageScore: 7,
    wasteScore: 0,
    firstSeenDate: new Date("2024-01-01"),
    lastPaymentDate: new Date("2025-01-01"),
    nextRenewalDate: new Date("2025-02-01"),
    autoRenews: true,
    trialEndsDate: null,
    annualPlanAvailable: true,
    annualPlanAmount: 96, // $96/year = $8/month
    annualSavingsIfSwitched: 24,
    priceChangeHistory: [],
    sourceMessageIds: ["msg-1"],
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

function createMessage(overrides: Partial<AnalyzedMessage> = {}): AnalyzedMessage {
  return {
    messageId: "msg-1",
    threadId: "thread-1",
    timestamp: new Date("2025-01-15"),
    sender: "noreply@notion.so",
    senderDomain: "notion.so",
    classifications: ["subscription_receipt"],
    subscriptionSignal: null,
    commitmentSignals: [],
    contractSignal: null,
    refundSignal: null,
    trialSignal: null,
    financialEntities: [],
    usageIndicators: ["login_alert"],
    urgencyScore: 0,
    summary: "Test message",
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("IntelligenceEngine - findBillingOptimizations", () => {
  let store: SQLiteEntityStore;
  let engine: IntelligenceEngine;

  beforeEach(() => {
    store = new SQLiteEntityStore(":memory:");
    engine = new IntelligenceEngine(store);
  });

  describe("Req 8.1: Calculate monthly equivalent and savings", () => {
    it("should calculate monthly equivalent of annual plan", async () => {
      const sub = createSubscription({
        amount: 10,
        annualPlanAmount: 96, // $96/year = $8/month
      });
      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage());

      const results = await engine.findBillingOptimizations();

      expect(results).toHaveLength(1);
      expect(results[0].annualPlanMonthlyEquivalent).toBe(8);
      expect(results[0].annualPlanTotalAmount).toBe(96);
    });

    it("should calculate monthly and annual savings correctly", async () => {
      const sub = createSubscription({
        amount: 10,
        annualPlanAmount: 96, // saves $2/month, $24/year
      });
      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage());

      const results = await engine.findBillingOptimizations();

      expect(results[0].monthlySavings).toBe(2);
      expect(results[0].annualSavings).toBe(24);
      expect(results[0].currentMonthlyAmount).toBe(10);
    });

    it("should calculate percentage saved", async () => {
      const sub = createSubscription({
        amount: 10,
        annualPlanAmount: 96, // saves 20%
      });
      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage());

      const results = await engine.findBillingOptimizations();

      expect(results[0].percentageSaved).toBe(20);
    });

    it("should not recommend when annual plan is more expensive", async () => {
      const sub = createSubscription({
        amount: 10,
        annualPlanAmount: 144, // $12/month — more expensive
      });
      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage());

      const results = await engine.findBillingOptimizations();

      expect(results).toHaveLength(0);
    });
  });

  describe("Req 8.2: Break-even point calculation", () => {
    it("should compute break-even months correctly", async () => {
      const sub = createSubscription({
        amount: 10,
        annualPlanAmount: 96, // break-even = ceil(96/10) = 10 months
      });
      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage());

      const results = await engine.findBillingOptimizations();

      expect(results[0].breakEvenMonths).toBe(10);
    });

    it("should compute break-even for different price points", async () => {
      const sub = createSubscription({
        amount: 15,
        annualPlanAmount: 120, // break-even = ceil(120/15) = 8 months
      });
      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage());

      const results = await engine.findBillingOptimizations();

      expect(results[0].breakEvenMonths).toBe(8);
    });
  });

  describe("Req 8.3: High confidence for 6+ months with stable usage", () => {
    it("should recommend with high confidence for 6+ months and stable usage", async () => {
      const sub = createSubscription({
        firstSeenDate: new Date("2024-01-01"), // ~12 months ago
        usageScore: 7, // stable usage
        amount: 10,
        annualPlanAmount: 96,
      });
      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage());

      const results = await engine.findBillingOptimizations();

      expect(results[0].confidence).toBe("high");
      expect(results[0].monthsSubscribed).toBeGreaterThanOrEqual(6);
      expect(results[0].recommendation).toContain("Switching to annual saves");
    });

    it("should include vendor name and savings in recommendation", async () => {
      const sub = createSubscription({
        vendor: "Notion",
        firstSeenDate: new Date("2024-01-01"),
        usageScore: 8,
        amount: 10,
        annualPlanAmount: 96,
      });
      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage());

      const results = await engine.findBillingOptimizations();

      expect(results[0].recommendation).toContain("Notion");
      expect(results[0].recommendation).toContain("$24.00/year");
    });
  });

  describe("Req 8.4: Recommend waiting for fewer than 6 months", () => {
    it("should recommend waiting for subscriptions held fewer than 6 months", async () => {
      const now = new Date();
      const threeMonthsAgo = new Date(now);
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const sub = createSubscription({
        firstSeenDate: threeMonthsAgo,
        usageScore: 7,
        amount: 10,
        annualPlanAmount: 96,
      });
      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage({ timestamp: new Date() }));

      const results = await engine.findBillingOptimizations();

      expect(results[0].confidence).toBe("low");
      expect(results[0].recommendation).toContain("waiting");
      expect(results[0].monthsSubscribed).toBeLessThan(6);
    });

    it("should assign low confidence for new subscriptions", async () => {
      const now = new Date();
      const oneMonthAgo = new Date(now);
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      const sub = createSubscription({
        firstSeenDate: oneMonthAgo,
        usageScore: 9,
        amount: 15,
        annualPlanAmount: 120,
      });
      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage({ timestamp: new Date() }));

      const results = await engine.findBillingOptimizations();

      expect(results[0].confidence).toBe("low");
    });
  });

  describe("Req 8.5: Total annual savings across all eligible subscriptions", () => {
    it("should compute total annual savings across multiple subscriptions", async () => {
      const sub1 = createSubscription({
        id: "sub-1",
        vendor: "Notion",
        vendorDomain: "notion.so",
        amount: 10,
        annualPlanAmount: 96, // saves $24/year
        firstSeenDate: new Date("2024-01-01"),
        usageScore: 7,
      });
      const sub2 = createSubscription({
        id: "sub-2",
        vendor: "Figma",
        vendorDomain: "figma.com",
        amount: 15,
        annualPlanAmount: 144, // saves $36/year
        category: "software-saas",
        firstSeenDate: new Date("2024-01-01"),
        usageScore: 8,
      });

      await store.upsertSubscription(sub1);
      await store.upsertSubscription(sub2);
      await store.insertMessage(createMessage({ messageId: "msg-1", senderDomain: "notion.so" }));
      await store.insertMessage(createMessage({ messageId: "msg-2", senderDomain: "figma.com", sender: "noreply@figma.com" }));

      const results = await engine.findBillingOptimizations();

      const totalAnnualSavings = results.reduce((sum, opt) => sum + opt.annualSavings, 0);
      expect(totalAnnualSavings).toBe(60); // $24 + $36
      expect(results).toHaveLength(2);
    });

    it("should sort results by annual savings descending", async () => {
      const sub1 = createSubscription({
        id: "sub-1",
        vendor: "Notion",
        vendorDomain: "notion.so",
        amount: 10,
        annualPlanAmount: 96, // saves $24/year
        firstSeenDate: new Date("2024-01-01"),
        usageScore: 7,
      });
      const sub2 = createSubscription({
        id: "sub-2",
        vendor: "Figma",
        vendorDomain: "figma.com",
        amount: 15,
        annualPlanAmount: 144, // saves $36/year
        category: "software-saas",
        firstSeenDate: new Date("2024-01-01"),
        usageScore: 8,
      });

      await store.upsertSubscription(sub1);
      await store.upsertSubscription(sub2);
      await store.insertMessage(createMessage({ messageId: "msg-1", senderDomain: "notion.so" }));
      await store.insertMessage(createMessage({ messageId: "msg-2", senderDomain: "figma.com", sender: "noreply@figma.com" }));

      const results = await engine.findBillingOptimizations();

      expect(results[0].vendor).toBe("Figma");
      expect(results[1].vendor).toBe("Notion");
    });
  });

  describe("Filtering and edge cases", () => {
    it("should return empty array when no subscriptions exist", async () => {
      const results = await engine.findBillingOptimizations();
      expect(results).toHaveLength(0);
    });

    it("should skip subscriptions without annual plan available", async () => {
      const sub = createSubscription({
        annualPlanAvailable: false,
        annualPlanAmount: null,
      });
      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage());

      const results = await engine.findBillingOptimizations();

      expect(results).toHaveLength(0);
    });

    it("should skip non-monthly subscriptions", async () => {
      const sub = createSubscription({
        billingFrequency: "annual",
        annualPlanAvailable: true,
        annualPlanAmount: 96,
      });
      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage());

      const results = await engine.findBillingOptimizations();

      expect(results).toHaveLength(0);
    });

    it("should assign medium confidence for 6+ months with low usage", async () => {
      const sub = createSubscription({
        firstSeenDate: new Date("2024-01-01"),
        usageScore: 2, // low usage
        amount: 10,
        annualPlanAmount: 96,
      });
      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage());

      const results = await engine.findBillingOptimizations();

      expect(results[0].confidence).toBe("medium");
      expect(results[0].recommendation).toContain("usage is low");
    });

    it("should generate unique IDs for each optimization", async () => {
      const sub1 = createSubscription({
        id: "sub-1",
        vendor: "Notion",
        vendorDomain: "notion.so",
        amount: 10,
        annualPlanAmount: 96,
        firstSeenDate: new Date("2024-01-01"),
        usageScore: 7,
      });
      const sub2 = createSubscription({
        id: "sub-2",
        vendor: "Figma",
        vendorDomain: "figma.com",
        amount: 15,
        annualPlanAmount: 144,
        category: "software-saas",
        firstSeenDate: new Date("2024-01-01"),
        usageScore: 8,
      });

      await store.upsertSubscription(sub1);
      await store.upsertSubscription(sub2);
      await store.insertMessage(createMessage({ messageId: "msg-1", senderDomain: "notion.so" }));
      await store.insertMessage(createMessage({ messageId: "msg-2", senderDomain: "figma.com", sender: "noreply@figma.com" }));

      const results = await engine.findBillingOptimizations();

      const ids = results.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("should set currentFrequency to monthly for all results", async () => {
      const sub = createSubscription();
      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage());

      const results = await engine.findBillingOptimizations();

      expect(results[0].currentFrequency).toBe("monthly");
    });
  });
});
