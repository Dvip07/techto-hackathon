/**
 * Unit tests for the Intelligence Engine — Smart Savings & Negotiation Engine
 *
 * Tests redundancy detection, negotiation opportunity generation,
 * savings calculation, and ranking.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
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
    vendor: "Netflix",
    vendorDomain: "netflix.com",
    amount: 15.99,
    currency: "USD",
    billingFrequency: "monthly",
    category: "video-streaming",
    status: "active-used",
    usageScore: 5,
    wasteScore: 0,
    firstSeenDate: new Date("2024-01-01"),
    lastPaymentDate: new Date("2025-01-01"),
    nextRenewalDate: new Date("2025-02-01"),
    autoRenews: true,
    trialEndsDate: null,
    annualPlanAvailable: false,
    annualPlanAmount: null,
    annualSavingsIfSwitched: null,
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
    sender: "noreply@netflix.com",
    senderDomain: "netflix.com",
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

describe("IntelligenceEngine - Smart Savings & Negotiation", () => {
  let store: SQLiteEntityStore;
  let engine: IntelligenceEngine;

  beforeEach(() => {
    store = new SQLiteEntityStore(":memory:");
    engine = new IntelligenceEngine(store);
  });

  describe("generateSavingsRecommendations", () => {
    it("should return empty results when no subscriptions exist", async () => {
      const result = await engine.generateSavingsRecommendations();

      expect(result.recommendations).toHaveLength(0);
      expect(result.negotiationOpportunities).toHaveLength(0);
      expect(result.totalPotentialMonthlySavings).toBe(0);
      expect(result.totalPotentialAnnualSavings).toBe(0);
    });

    it("should detect redundancy when 2+ active subscriptions in same category (Req 6.1)", async () => {
      // Two video streaming services
      const netflix = createSubscription({
        id: "sub-netflix",
        vendor: "Netflix",
        vendorDomain: "netflix.com",
        amount: 15.99,
        category: "video-streaming",
        status: "active-used",
        usageScore: 8,
      });
      const hulu = createSubscription({
        id: "sub-hulu",
        vendor: "Hulu",
        vendorDomain: "hulu.com",
        amount: 12.99,
        category: "video-streaming",
        status: "active-used",
        usageScore: 3,
      });

      await store.upsertSubscription(netflix);
      await store.upsertSubscription(hulu);

      // Add engagement messages so they stay active
      await store.insertMessage(createMessage({
        messageId: "msg-netflix",
        senderDomain: "netflix.com",
        timestamp: new Date(),
        usageIndicators: ["login_alert"],
      }));
      await store.insertMessage(createMessage({
        messageId: "msg-hulu",
        senderDomain: "hulu.com",
        sender: "noreply@hulu.com",
        timestamp: new Date(),
        usageIndicators: ["login_alert"],
      }));

      const result = await engine.generateSavingsRecommendations();

      // Should recommend cancelling Hulu (lower usage score)
      const redundancyRecs = result.recommendations.filter(r => r.type === "redundancy");
      expect(redundancyRecs.length).toBeGreaterThanOrEqual(1);

      const huluRec = redundancyRecs.find(r => r.vendor === "Hulu");
      expect(huluRec).toBeDefined();
      expect(huluRec!.reason).toContain("Netflix");
      expect(huluRec!.estimatedMonthlySavings).toBe(12.99);
    });

    it("should recommend cancelling the subscription with lower usage score (Req 6.1)", async () => {
      const spotify = createSubscription({
        id: "sub-spotify",
        vendor: "Spotify",
        vendorDomain: "spotify.com",
        amount: 11.99,
        category: "music-streaming",
        status: "active-used",
        usageScore: 9,
      });
      const appleMusic = createSubscription({
        id: "sub-apple",
        vendor: "Apple Music",
        vendorDomain: "music.apple.com",
        amount: 10.99,
        category: "music-streaming",
        status: "active-used",
        usageScore: 2,
      });

      await store.upsertSubscription(spotify);
      await store.upsertSubscription(appleMusic);

      await store.insertMessage(createMessage({
        messageId: "msg-spotify",
        senderDomain: "spotify.com",
        timestamp: new Date(),
      }));
      await store.insertMessage(createMessage({
        messageId: "msg-apple",
        senderDomain: "music.apple.com",
        sender: "noreply@music.apple.com",
        timestamp: new Date(),
      }));

      const result = await engine.generateSavingsRecommendations();

      const redundancyRecs = result.recommendations.filter(r => r.type === "redundancy");
      // Apple Music should be recommended for cancellation (lower score)
      const appleMusicRec = redundancyRecs.find(r => r.vendor === "Apple Music");
      expect(appleMusicRec).toBeDefined();
      expect(appleMusicRec!.relatedSubscriptionIds).toContain("sub-spotify");
      expect(appleMusicRec!.relatedSubscriptionIds).toContain("sub-apple");
    });

    it("should compute total potential monthly and annual savings (Req 6.4)", async () => {
      const sub1 = createSubscription({
        id: "sub-1",
        vendor: "Service A",
        vendorDomain: "servicea.com",
        amount: 20,
        category: "productivity",
        status: "active-used",
        usageScore: 9,
      });
      const sub2 = createSubscription({
        id: "sub-2",
        vendor: "Service B",
        vendorDomain: "serviceb.com",
        amount: 15,
        category: "productivity",
        status: "active-used",
        usageScore: 2,
      });

      await store.upsertSubscription(sub1);
      await store.upsertSubscription(sub2);

      await store.insertMessage(createMessage({
        messageId: "msg-a",
        senderDomain: "servicea.com",
        timestamp: new Date(),
      }));
      await store.insertMessage(createMessage({
        messageId: "msg-b",
        senderDomain: "serviceb.com",
        sender: "noreply@serviceb.com",
        timestamp: new Date(),
      }));

      const result = await engine.generateSavingsRecommendations();

      expect(result.totalPotentialMonthlySavings).toBeGreaterThan(0);
      expect(result.totalPotentialAnnualSavings).toBeGreaterThan(0);
      expect(result.totalPotentialAnnualSavings).toBeCloseTo(
        result.totalPotentialMonthlySavings * 12,
        0
      );
    });

    it("should make one-click draft available for recommendations (Req 6.5)", async () => {
      const sub1 = createSubscription({
        id: "sub-1",
        vendor: "Netflix",
        vendorDomain: "netflix.com",
        amount: 15.99,
        category: "video-streaming",
        status: "active-used",
        usageScore: 8,
      });
      const sub2 = createSubscription({
        id: "sub-2",
        vendor: "Hulu",
        vendorDomain: "hulu.com",
        amount: 12.99,
        category: "video-streaming",
        status: "active-used",
        usageScore: 2,
      });

      await store.upsertSubscription(sub1);
      await store.upsertSubscription(sub2);

      await store.insertMessage(createMessage({
        messageId: "msg-1",
        senderDomain: "netflix.com",
        timestamp: new Date(),
      }));
      await store.insertMessage(createMessage({
        messageId: "msg-2",
        senderDomain: "hulu.com",
        sender: "noreply@hulu.com",
        timestamp: new Date(),
      }));

      const result = await engine.generateSavingsRecommendations();

      for (const rec of result.recommendations) {
        expect(rec.draftAvailable).toBe(true);
      }
    });

    it("should rank savings recommendations by annual savings descending (Req 6.6)", async () => {
      // Three subscriptions in same category with different amounts
      const sub1 = createSubscription({
        id: "sub-expensive",
        vendor: "Expensive Tool",
        vendorDomain: "expensive.com",
        amount: 50,
        category: "software-saas",
        status: "active-used",
        usageScore: 9,
      });
      const sub2 = createSubscription({
        id: "sub-medium",
        vendor: "Medium Tool",
        vendorDomain: "medium-tool.com",
        amount: 30,
        category: "software-saas",
        status: "active-used",
        usageScore: 4,
      });
      const sub3 = createSubscription({
        id: "sub-cheap",
        vendor: "Cheap Tool",
        vendorDomain: "cheap-tool.com",
        amount: 10,
        category: "software-saas",
        status: "active-used",
        usageScore: 2,
      });

      await store.upsertSubscription(sub1);
      await store.upsertSubscription(sub2);
      await store.upsertSubscription(sub3);

      await store.insertMessage(createMessage({
        messageId: "msg-exp",
        senderDomain: "expensive.com",
        timestamp: new Date(),
      }));
      await store.insertMessage(createMessage({
        messageId: "msg-med",
        senderDomain: "medium-tool.com",
        sender: "noreply@medium-tool.com",
        timestamp: new Date(),
      }));
      await store.insertMessage(createMessage({
        messageId: "msg-chp",
        senderDomain: "cheap-tool.com",
        sender: "noreply@cheap-tool.com",
        timestamp: new Date(),
      }));

      const result = await engine.generateSavingsRecommendations();

      // Verify descending order
      for (let i = 1; i < result.recommendations.length; i++) {
        expect(result.recommendations[i - 1].estimatedAnnualSavings)
          .toBeGreaterThanOrEqual(result.recommendations[i].estimatedAnnualSavings);
      }
    });

    it("should not detect redundancy for single subscriptions in a category", async () => {
      const sub = createSubscription({
        id: "sub-1",
        vendor: "Netflix",
        vendorDomain: "netflix.com",
        amount: 15.99,
        category: "video-streaming",
        status: "active-used",
        usageScore: 7,
        firstSeenDate: new Date("2025-01-01"), // recent, no tenure trigger
      });

      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage({
        messageId: "msg-1",
        senderDomain: "netflix.com",
        timestamp: new Date(),
      }));

      const result = await engine.generateSavingsRecommendations();

      const redundancyRecs = result.recommendations.filter(r => r.type === "redundancy");
      expect(redundancyRecs).toHaveLength(0);
    });
  });

  describe("generateNegotiationOpportunities", () => {
    it("should generate opportunity on price increase (Req 6.2)", async () => {
      const sub = createSubscription({
        id: "sub-1",
        vendor: "Spotify",
        vendorDomain: "spotify.com",
        amount: 11.99,
        category: "music-streaming",
        status: "active-used",
        usageScore: 7,
        firstSeenDate: new Date("2023-01-01"), // 2+ years tenure
        priceChangeHistory: [
          {
            previousAmount: 9.99,
            newAmount: 11.99,
            detectedDate: new Date("2025-01-10"),
            percentageChange: 20.02,
            sourceMessageId: "msg-price",
          },
        ],
      });

      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage({
        messageId: "msg-1",
        senderDomain: "spotify.com",
        timestamp: new Date(),
      }));

      const opportunities = await engine.generateNegotiationOpportunities();

      const priceOpp = opportunities.find(o => o.reason === "price_increase");
      expect(priceOpp).toBeDefined();
      expect(priceOpp!.vendor).toBe("Spotify");
      expect(priceOpp!.currentAmount).toBe(11.99);
      expect(priceOpp!.targetAmount).toBe(9.99);
      expect(priceOpp!.estimatedSavings).toBe(2);
      expect(priceOpp!.tenure).toBeGreaterThanOrEqual(24);
      expect(priceOpp!.draftAvailable).toBe(true);
    });

    it("should include tenure in negotiation context (Req 6.2)", async () => {
      const sub = createSubscription({
        id: "sub-1",
        vendor: "Netflix",
        vendorDomain: "netflix.com",
        amount: 17.99,
        status: "active-used",
        usageScore: 6,
        firstSeenDate: new Date("2022-06-01"), // ~30 months tenure
        priceChangeHistory: [
          {
            previousAmount: 15.99,
            newAmount: 17.99,
            detectedDate: new Date("2025-01-01"),
            percentageChange: 12.51,
            sourceMessageId: "msg-1",
          },
        ],
      });

      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage({
        messageId: "msg-1",
        senderDomain: "netflix.com",
        timestamp: new Date(),
      }));

      const opportunities = await engine.generateNegotiationOpportunities();

      const priceOpp = opportunities.find(o => o.reason === "price_increase");
      expect(priceOpp).toBeDefined();
      expect(priceOpp!.context).toContain("months");
      expect(priceOpp!.tenure).toBeGreaterThanOrEqual(24);
    });

    it("should generate opportunity for competitor pricing (Req 6.3)", async () => {
      // More expensive service
      const expensive = createSubscription({
        id: "sub-expensive",
        vendor: "Expensive Streaming",
        vendorDomain: "expensive-stream.com",
        amount: 19.99,
        category: "video-streaming",
        status: "active-used",
        usageScore: 5,
        firstSeenDate: new Date("2025-01-01"),
      });
      // Cheaper competitor in same category
      const cheap = createSubscription({
        id: "sub-cheap",
        vendor: "Budget Streaming",
        vendorDomain: "budget-stream.com",
        amount: 9.99,
        category: "video-streaming",
        status: "active-used",
        usageScore: 7,
        firstSeenDate: new Date("2025-01-01"),
      });

      await store.upsertSubscription(expensive);
      await store.upsertSubscription(cheap);

      await store.insertMessage(createMessage({
        messageId: "msg-exp",
        senderDomain: "expensive-stream.com",
        timestamp: new Date(),
      }));
      await store.insertMessage(createMessage({
        messageId: "msg-chp",
        senderDomain: "budget-stream.com",
        sender: "noreply@budget-stream.com",
        timestamp: new Date(),
      }));

      const opportunities = await engine.generateNegotiationOpportunities();

      const competitorOpp = opportunities.find(
        o => o.reason === "competitor_cheaper" && o.vendor === "Expensive Streaming"
      );
      expect(competitorOpp).toBeDefined();
      expect(competitorOpp!.currentAmount).toBe(19.99);
      expect(competitorOpp!.targetAmount).toBe(9.99);
      expect(competitorOpp!.estimatedSavings).toBe(10);
      expect(competitorOpp!.context).toContain("Budget Streaming");
    });

    it("should generate opportunity for long tenure (12+ months)", async () => {
      const sub = createSubscription({
        id: "sub-1",
        vendor: "Long Service",
        vendorDomain: "longservice.com",
        amount: 25,
        category: "software-saas",
        status: "active-used",
        usageScore: 7,
        firstSeenDate: new Date("2023-06-01"), // 18+ months
      });

      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage({
        messageId: "msg-1",
        senderDomain: "longservice.com",
        timestamp: new Date(),
      }));

      const opportunities = await engine.generateNegotiationOpportunities();

      const tenureOpp = opportunities.find(o => o.reason === "long_tenure_discount");
      expect(tenureOpp).toBeDefined();
      expect(tenureOpp!.vendor).toBe("Long Service");
      expect(tenureOpp!.tenure).toBeGreaterThanOrEqual(12);
      expect(tenureOpp!.confidence).toBe("high"); // 18+ months = high confidence
    });

    it("should generate opportunity for low usage", async () => {
      const sub = createSubscription({
        id: "sub-1",
        vendor: "Unused Service",
        vendorDomain: "unused.com",
        amount: 20,
        category: "software-saas",
        status: "active-used",
        usageScore: 1,
        firstSeenDate: new Date("2025-01-01"),
      });

      await store.upsertSubscription(sub);
      await store.insertMessage(createMessage({
        messageId: "msg-1",
        senderDomain: "unused.com",
        timestamp: new Date(),
      }));

      const opportunities = await engine.generateNegotiationOpportunities();

      const usageOpp = opportunities.find(o => o.reason === "usage_low");
      expect(usageOpp).toBeDefined();
      expect(usageOpp!.vendor).toBe("Unused Service");
      expect(usageOpp!.confidence).toBe("high"); // score <= 1 = high confidence
      expect(usageOpp!.context).toContain("low");
    });

    it("should factor tenure into confidence scoring for price increase", async () => {
      // Short tenure (< 12 months) → medium confidence
      // Use a date that's always < 12 months from now
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const shortTenure = createSubscription({
        id: "sub-short",
        vendor: "Short Service",
        vendorDomain: "short.com",
        amount: 15,
        status: "active-used",
        usageScore: 5,
        firstSeenDate: threeMonthsAgo,
        priceChangeHistory: [
          {
            previousAmount: 12,
            newAmount: 15,
            detectedDate: new Date("2025-01-01"),
            percentageChange: 25,
            sourceMessageId: "msg-1",
          },
        ],
      });

      await store.upsertSubscription(shortTenure);
      await store.insertMessage(createMessage({
        messageId: "msg-short",
        senderDomain: "short.com",
        timestamp: new Date(),
      }));

      const opportunities = await engine.generateNegotiationOpportunities();

      const priceOpp = opportunities.find(
        o => o.reason === "price_increase" && o.vendor === "Short Service"
      );
      expect(priceOpp).toBeDefined();
      expect(priceOpp!.confidence).toBe("medium"); // short tenure = medium
    });

    it("should return empty array when no subscriptions exist", async () => {
      const opportunities = await engine.generateNegotiationOpportunities();
      expect(opportunities).toHaveLength(0);
    });
  });
});
