/**
 * Unit tests for the Priority Ranker.
 *
 * Tests urgency scoring, priority ranking, and tie-breaking logic.
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.5
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PriorityRanker } from "./priority-ranker";
import type { TrialRecord, SubscriptionRecord } from "../types/models";
import type { IntelligenceEngine } from "../intelligence/intelligence-engine";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockTrial(overrides: Partial<TrialRecord> = {}): TrialRecord {
  return {
    id: "trial-1",
    vendor: "TestVendor",
    vendorDomain: "testvendor.com",
    category: "software-saas",
    trialStartDate: new Date("2025-01-01"),
    trialEndDate: new Date("2025-02-01"),
    daysRemaining: 30,
    convertsToAmount: 15,
    convertsToFrequency: "monthly",
    autoConverts: true,
    cancellationUrl: "https://testvendor.com/cancel",
    status: "active",
    reminderScheduled: false,
    sourceMessageId: "msg-1",
    ...overrides,
  };
}

function createMockEngine(overrides: Partial<Record<string, any>> = {}): IntelligenceEngine {
  return {
    scanSubscriptions: async () => ({
      subscriptions: [],
      totalRecurringMonthly: 0,
      totalRecurringAnnual: 0,
      byStatus: {} as any,
      byCategory: {} as any,
      zombieSubscriptions: [],
      priceIncreasedSubscriptions: [],
      renewingSoonSubscriptions: [],
      activeTrialSubscriptions: [],
      recentPriceChanges: [],
      scanDate: new Date(),
    }),
    trackTrialExpiries: async () => ({
      activeTrials: [],
      expiringSoon: [],
      urgentTrials: [],
      totalPotentialCharges: 0,
      trialsByUrgency: [],
    }),
    generateSavingsRecommendations: async () => ({
      recommendations: [],
      negotiationOpportunities: [],
      totalPotentialMonthlySavings: 0,
      totalPotentialAnnualSavings: 0,
    }),
    findBillingOptimizations: async () => [],
    detectSubscriptionCreep: async () => null,
    trackRefundsAndCredits: async () => ({
      pendingRefunds: [],
      overdueRefunds: [],
      totalPendingAmount: 0,
      totalOverdueAmount: 0,
      totalTrackedRefunds: 0,
    }),
    trackPaymentPromises: async () => ({
      openPromises: [],
      overduePromises: [],
      fulfilledPromises: [],
      totalOpenAmount: 0,
      totalOverdueAmount: 0,
      totalFulfilledAmount: 0,
    }),
    computeUpcomingRenewals: async () => [],
    analyzeSpendingPatterns: async () => ({
      monthlyTotals: [],
      categoryBreakdown: [],
      monthOverMonth: { currentMonth: 0, previousMonth: 0, absoluteChange: 0, percentageChange: 0, direction: "stable" as const },
      quarterOverQuarter: { currentQuarter: 0, previousQuarter: 0, absoluteChange: 0, percentageChange: 0, direction: "stable" as const },
      anomalies: [],
      insights: [],
      predictedNextMonthSpend: 0,
      topCategory: { category: "other" as const, percentage: 0, amount: 0 },
      totalMonthlySpend: 0,
      analyzedAt: new Date(),
    }),
    trackFinancialCommitments: async () => ({
      inbound: [],
      outbound: [],
      overdue: [],
      openRankedByValue: [],
      refundCommitments: [],
      paymentPromiseCommitments: [],
      totals: { totalInbound: 0, totalOutbound: 0, totalOverdue: 0, totalOpen: 0, totalInboundValue: 0, totalOutboundValue: 0, totalOverdueValue: 0 },
    }),
    watchObligations: async () => ({
      obligations: [],
      riskFlags: [],
      deadlines: [],
      totalFinancialExposure: 0,
      highRiskObligations: [],
      summary: { totalObligations: 0, totalRiskFlags: 0, obligationsWithAutoRenewal: 0, obligationsWithPenalties: 0, obligationsWithMissedNotice: 0, upcomingDeadlineCount: 0 },
    }),
    ...overrides,
  } as unknown as IntelligenceEngine;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PriorityRanker", () => {
  let ranker: PriorityRanker;

  beforeEach(() => {
    ranker = new PriorityRanker(createMockEngine());
  });

  describe("computeTrialUrgency", () => {
    it("should assign urgency 10 for trials expiring within 48 hours that auto-convert", () => {
      const now = new Date("2025-01-15T10:00:00Z");
      const trial = createMockTrial({
        trialEndDate: new Date("2025-01-16T12:00:00Z"), // 26 hours from now
        autoConverts: true,
        convertsToAmount: 15,
        convertsToFrequency: "monthly",
        daysRemaining: 1,
      });

      const urgency = ranker.computeTrialUrgency(trial, now);
      expect(urgency).toBe(10);
    });

    it("should assign urgency 9 for trials auto-converting to plans >$20/month", () => {
      const now = new Date("2025-01-01T10:00:00Z");
      const trial = createMockTrial({
        trialEndDate: new Date("2025-01-20T10:00:00Z"), // 19 days away
        autoConverts: true,
        convertsToAmount: 25,
        convertsToFrequency: "monthly",
        daysRemaining: 19,
      });

      const urgency = ranker.computeTrialUrgency(trial, now);
      expect(urgency).toBe(9);
    });

    it("should assign urgency 10 over urgency 9 when both conditions are met", () => {
      const now = new Date("2025-01-15T10:00:00Z");
      const trial = createMockTrial({
        trialEndDate: new Date("2025-01-16T12:00:00Z"), // 26 hours, within 48h
        autoConverts: true,
        convertsToAmount: 50, // >$20/month
        convertsToFrequency: "monthly",
        daysRemaining: 1,
      });

      const urgency = ranker.computeTrialUrgency(trial, now);
      expect(urgency).toBe(10);
    });

    it("should NOT assign urgency 10 for trials expiring within 48h that do NOT auto-convert", () => {
      const now = new Date("2025-01-15T10:00:00Z");
      const trial = createMockTrial({
        trialEndDate: new Date("2025-01-16T12:00:00Z"), // 26 hours
        autoConverts: false,
        daysRemaining: 1,
      });

      const urgency = ranker.computeTrialUrgency(trial, now);
      expect(urgency).not.toBe(10);
    });

    it("should NOT assign urgency 9 for trials converting to exactly $20/month", () => {
      const now = new Date("2025-01-01T10:00:00Z");
      const trial = createMockTrial({
        trialEndDate: new Date("2025-01-20T10:00:00Z"),
        autoConverts: true,
        convertsToAmount: 20, // exactly $20, not exceeding
        convertsToFrequency: "monthly",
        daysRemaining: 19,
      });

      const urgency = ranker.computeTrialUrgency(trial, now);
      expect(urgency).not.toBe(9);
    });

    it("should assign urgency 0 for expired trials", () => {
      const now = new Date("2025-01-20T10:00:00Z");
      const trial = createMockTrial({
        trialEndDate: new Date("2025-01-15T10:00:00Z"), // already expired
        autoConverts: true,
        convertsToAmount: 50,
        daysRemaining: 0,
      });

      const urgency = ranker.computeTrialUrgency(trial, now);
      expect(urgency).toBe(0);
    });

    it("should handle annual conversion amounts correctly for urgency 9", () => {
      const now = new Date("2025-01-01T10:00:00Z");
      const trial = createMockTrial({
        trialEndDate: new Date("2025-01-20T10:00:00Z"),
        autoConverts: true,
        convertsToAmount: 300, // $300/year = $25/month > $20
        convertsToFrequency: "annual",
        daysRemaining: 19,
      });

      const urgency = ranker.computeTrialUrgency(trial, now);
      expect(urgency).toBe(9);
    });
  });

  describe("computeUrgencyScore", () => {
    it("should return 0 for zero financial impact and no deadline", () => {
      const score = ranker.computeUrgencyScore(0, null);
      expect(score).toBe(0);
    });

    it("should cap at 10", () => {
      const score = ranker.computeUrgencyScore(200, 0);
      expect(score).toBeLessThanOrEqual(10);
    });

    it("should increase with higher financial impact", () => {
      const low = ranker.computeUrgencyScore(5, null);
      const high = ranker.computeUrgencyScore(100, null);
      expect(high).toBeGreaterThan(low);
    });

    it("should increase with closer deadlines", () => {
      const far = ranker.computeUrgencyScore(50, 30);
      const near = ranker.computeUrgencyScore(50, 1);
      expect(near).toBeGreaterThan(far);
    });
  });

  describe("getPriorityFeed", () => {
    it("should return items sorted by urgency score descending", async () => {
      const engine = createMockEngine({
        trackTrialExpiries: async () => ({
          activeTrials: [],
          expiringSoon: [],
          urgentTrials: [],
          totalPotentialCharges: 0,
          trialsByUrgency: [
            { trial: createMockTrial({ id: "t1", daysRemaining: 5 }), urgencyScore: 7 },
            { trial: createMockTrial({ id: "t2", daysRemaining: 1 }), urgencyScore: 10 },
            { trial: createMockTrial({ id: "t3", daysRemaining: 20 }), urgencyScore: 3 },
          ],
        }),
      });

      const rankerWithData = new PriorityRanker(engine);
      const feed = await rankerWithData.getPriorityFeed(10);

      // Verify descending urgency order
      for (let i = 1; i < feed.length; i++) {
        expect(feed[i - 1].urgencyScore).toBeGreaterThanOrEqual(feed[i].urgencyScore);
      }
    });

    it("should break ties by financial impact (higher first)", async () => {
      const engine = createMockEngine({
        trackTrialExpiries: async () => ({
          activeTrials: [],
          expiringSoon: [],
          urgentTrials: [],
          totalPotentialCharges: 0,
          trialsByUrgency: [
            {
              trial: createMockTrial({
                id: "t1",
                vendor: "CheapVendor",
                convertsToAmount: 5,
                convertsToFrequency: "monthly",
                daysRemaining: 5,
              }),
              urgencyScore: 7,
            },
            {
              trial: createMockTrial({
                id: "t2",
                vendor: "ExpensiveVendor",
                convertsToAmount: 50,
                convertsToFrequency: "monthly",
                daysRemaining: 5,
              }),
              urgencyScore: 7,
            },
          ],
        }),
      });

      const rankerWithData = new PriorityRanker(engine);
      const feed = await rankerWithData.getPriorityFeed(10);

      // Find the two trial items
      const trialItems = feed.filter((item) => item.featureArea === "trials");
      expect(trialItems.length).toBe(2);

      // Both have urgency 7, so the one with higher financial impact should come first
      expect(trialItems[0].financialImpact).toBeGreaterThan(trialItems[1].financialImpact);
    });

    it("should respect the limit parameter", async () => {
      const engine = createMockEngine({
        trackTrialExpiries: async () => ({
          activeTrials: [],
          expiringSoon: [],
          urgentTrials: [],
          totalPotentialCharges: 0,
          trialsByUrgency: [
            { trial: createMockTrial({ id: "t1" }), urgencyScore: 7 },
            { trial: createMockTrial({ id: "t2" }), urgencyScore: 5 },
            { trial: createMockTrial({ id: "t3" }), urgencyScore: 3 },
          ],
        }),
      });

      const rankerWithData = new PriorityRanker(engine);
      const feed = await rankerWithData.getPriorityFeed(2);

      expect(feed.length).toBeLessThanOrEqual(2);
    });

    it("should return empty array when no insights exist", async () => {
      const feed = await ranker.getPriorityFeed(10);
      expect(feed).toEqual([]);
    });

    it("should aggregate items from multiple feature areas", async () => {
      const engine = createMockEngine({
        scanSubscriptions: async () => ({
          subscriptions: [],
          totalRecurringMonthly: 0,
          totalRecurringAnnual: 0,
          byStatus: {} as any,
          byCategory: {} as any,
          zombieSubscriptions: [{
            id: "sub-1",
            vendor: "ZombieApp",
            vendorDomain: "zombieapp.com",
            amount: 10,
            currency: "USD",
            billingFrequency: "monthly" as const,
            category: "software-saas" as const,
            status: "zombie" as const,
            usageScore: 0,
            wasteScore: 10,
            firstSeenDate: new Date("2024-01-01"),
            lastPaymentDate: new Date("2025-01-01"),
            nextRenewalDate: null,
            autoRenews: true,
            trialEndsDate: null,
            annualPlanAvailable: false,
            annualPlanAmount: null,
            annualSavingsIfSwitched: null,
            priceChangeHistory: [],
            sourceMessageIds: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          }],
          priceIncreasedSubscriptions: [],
          renewingSoonSubscriptions: [],
          activeTrialSubscriptions: [],
          recentPriceChanges: [],
          scanDate: new Date(),
        }),
        trackRefundsAndCredits: async () => ({
          pendingRefunds: [],
          overdueRefunds: [{
            id: "refund-1",
            vendor: "RefundVendor",
            amount: 50,
            currency: "USD",
            promisedDate: new Date("2025-01-01"),
            expectedByDate: new Date("2025-01-15"),
            actualReceivedDate: null,
            status: "overdue" as const,
            daysOverdue: 10,
            originalTransactionDate: null,
            reason: "Cancelled service",
            sourceMessageIds: [],
            lastFollowUpDate: null,
          }],
          totalPendingAmount: 0,
          totalOverdueAmount: 50,
          totalTrackedRefunds: 1,
        }),
      });

      const rankerWithData = new PriorityRanker(engine);
      const feed = await rankerWithData.getPriorityFeed(10);

      const featureAreas = new Set(feed.map((item) => item.featureArea));
      expect(featureAreas.has("usage-scoring")).toBe(true);
      expect(featureAreas.has("refunds")).toBe(true);
    });
  });
});
