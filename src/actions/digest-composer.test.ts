/**
 * Unit tests for the Smart Digest Composer.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { DigestComposer } from "./digest-composer";
import type { DigestData } from "../store/entity-store";
import type { IntelligenceEngine } from "../intelligence/intelligence-engine";
import type { PriorityRanker } from "./priority-ranker";
import type { PrioritizedItem, SmartDigest } from "../types/outputs";

// ─── Mock Factories ──────────────────────────────────────────────────────────

function createMockDigestData(overrides: Partial<DigestData> = {}): DigestData {
  return {
    totalRecurringSpend: 150.0,
    spendChangeFromLastPeriod: 5.2,
    totalPotentialSavings: 0,
    upcomingRenewals: [
      {
        id: "sub-1",
        vendor: "Netflix",
        vendorDomain: "netflix.com",
        amount: 15.99,
        currency: "USD",
        billingFrequency: "monthly",
        category: "video-streaming",
        status: "renewing-soon",
        usageScore: 8,
        wasteScore: 0,
        firstSeenDate: new Date("2023-01-01"),
        lastPaymentDate: new Date("2024-01-01"),
        nextRenewalDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        autoRenews: true,
        trialEndsDate: null,
        annualPlanAvailable: false,
        annualPlanAmount: null,
        annualSavingsIfSwitched: null,
        priceChangeHistory: [],
        sourceMessageIds: ["msg-1"],
        createdAt: new Date("2023-01-01"),
        updatedAt: new Date("2024-01-01"),
      },
    ],
    expiringTrials: [
      {
        id: "trial-1",
        vendor: "Figma",
        vendorDomain: "figma.com",
        category: "software-saas",
        trialStartDate: new Date("2024-01-01"),
        trialEndDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        daysRemaining: 2,
        convertsToAmount: 15.0,
        convertsToFrequency: "monthly",
        autoConverts: true,
        cancellationUrl: "https://figma.com/cancel",
        status: "expiring_soon",
        reminderScheduled: false,
        sourceMessageId: "msg-2",
      },
    ],
    overdueRefunds: [
      {
        id: "refund-1",
        vendor: "Adobe",
        amount: 54.99,
        currency: "USD",
        promisedDate: new Date("2024-01-01"),
        expectedByDate: new Date("2024-01-15"),
        actualReceivedDate: null,
        status: "overdue",
        daysOverdue: 10,
        originalTransactionDate: null,
        reason: "Cancelled subscription",
        sourceMessageIds: ["msg-3"],
        lastFollowUpDate: null,
      },
    ],
    overdueCommitments: [
      {
        id: "commit-1",
        messageId: "msg-4",
        threadId: "thread-4",
        type: "inbound",
        subtype: "payment_promise",
        description: "Client promised payment for invoice #123",
        owner: "Client A",
        counterparty: "Client A",
        financialValue: 500.0,
        currency: "USD",
        dueDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        status: "overdue",
        isImplicit: false,
        confidence: 0.9,
        priority: 5,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-10"),
        fulfilledAt: null,
        lastFollowUpDate: null,
      },
    ],
    recentPayments: [],
    ...overrides,
  };
}

function createMockEngine(): IntelligenceEngine {
  return {
    generateSavingsRecommendations: vi.fn().mockResolvedValue({
      recommendations: [
        {
          id: "sav-1",
          type: "redundancy",
          vendor: "Dropbox",
          category: "cloud-storage",
          currentMonthlyAmount: 12.99,
          estimatedMonthlySavings: 12.99,
          estimatedAnnualSavings: 155.88,
          reason: "Redundant with Google One",
          confidence: "high",
          draftAvailable: true,
          relatedSubscriptionIds: ["sub-2", "sub-3"],
        },
      ],
      negotiationOpportunities: [],
      totalPotentialMonthlySavings: 12.99,
      totalPotentialAnnualSavings: 155.88,
    }),
    detectSubscriptionCreep: vi.fn().mockResolvedValue({
      id: "creep-1",
      detectedAt: new Date(),
      periodMonths: 3,
      startingMonthlySpend: 100,
      currentMonthlySpend: 120,
      absoluteIncrease: 20,
      percentageIncrease: 20,
      newSubscriptionsAdded: [],
      priceIncreasesDetected: [],
      insight: "Your subscriptions grew 20% in 3 months — from $100 to $120/month",
      acknowledged: false,
    }),
    analyzeSpendingPatterns: vi.fn().mockResolvedValue({
      monthlyTotals: [],
      categoryBreakdown: [],
      monthOverMonth: {
        currentMonth: 150,
        previousMonth: 142,
        absoluteChange: 8,
        percentageChange: 5.6,
        direction: "increasing",
      },
      quarterOverQuarter: {
        currentQuarter: 450,
        previousQuarter: 420,
        absoluteChange: 30,
        percentageChange: 7.1,
        direction: "increasing",
      },
      anomalies: [],
      insights: [],
      predictedNextMonthSpend: 155,
      topCategory: { category: "software-saas", percentage: 40, amount: 60 },
      totalMonthlySpend: 150,
      analyzedAt: new Date(),
    }),
  } as unknown as IntelligenceEngine;
}

function createMockRanker(): PriorityRanker {
  return {
    getPriorityFeed: vi.fn().mockResolvedValue([
      {
        id: "priority-trial-trial-1",
        featureArea: "trials",
        title: "Figma trial expiring soon",
        description: "Trial converts to $15.00/mo in 2 days",
        urgencyScore: 10,
        financialImpact: 180,
        suggestedActions: [
          { type: "cancel_trial", label: "Cancel trial", draftAvailable: true },
        ],
        relatedVendor: "Figma",
        dueDate: new Date(),
        createdAt: new Date(),
      },
      {
        id: "priority-refund-refund-1",
        featureArea: "refunds",
        title: "Overdue refund from Adobe",
        description: "$54.99 refund is 10 days overdue",
        urgencyScore: 8,
        financialImpact: 54.99,
        suggestedActions: [
          { type: "follow_up", label: "Send follow-up", draftAvailable: true },
        ],
        relatedVendor: "Adobe",
        dueDate: new Date(),
        createdAt: new Date(),
      },
      {
        id: "priority-promise-commit-1",
        featureArea: "payment-promises",
        title: "Overdue payment from Client A",
        description: "Client promised payment — 7 days overdue ($500.00)",
        urgencyScore: 7,
        financialImpact: 500,
        suggestedActions: [
          { type: "follow_up", label: "Send follow-up", draftAvailable: true },
        ],
        relatedVendor: "Client A",
        dueDate: new Date(),
        createdAt: new Date(),
      },
      {
        id: "priority-savings-sav-1",
        featureArea: "savings",
        title: "Save on Dropbox",
        description: "Redundant with Google One",
        urgencyScore: 5,
        financialImpact: 155.88,
        suggestedActions: [
          { type: "cancel", label: "Cancel redundant", draftAvailable: true },
        ],
        relatedVendor: "Dropbox",
        dueDate: null,
        createdAt: new Date(),
      },
      {
        id: "priority-renewal-sub-1",
        featureArea: "renewals",
        title: "Netflix renewing in 3 days",
        description: "$15.99/monthly renewal (auto-renewal)",
        urgencyScore: 4,
        financialImpact: 191.88,
        suggestedActions: [
          { type: "set_reminder", label: "Set reminder", draftAvailable: false },
        ],
        relatedVendor: "Netflix",
        dueDate: new Date(),
        createdAt: new Date(),
      },
    ] as PrioritizedItem[]),
  } as unknown as PriorityRanker;
}

function createMockStore() {
  return {} as any;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("DigestComposer", () => {
  let composer: DigestComposer;
  let mockEngine: IntelligenceEngine;
  let mockRanker: PriorityRanker;
  let mockStore: any;

  beforeEach(() => {
    mockEngine = createMockEngine();
    mockRanker = createMockRanker();
    mockStore = createMockStore();
    composer = new DigestComposer(mockEngine, mockStore, mockRanker, {
      userTimezone: "America/New_York",
    });
  });

  describe("composeDigest", () => {
    it("should include total recurring spend, spend change, and potential savings (Req 16.1)", async () => {
      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      expect(digest.totalRecurringSpend).toBe(150.0);
      expect(digest.spendChangeFromLastPeriod).toBe(5.2);
      expect(digest.totalPotentialSavings).toBeCloseTo(155.88 / 12, 1);
    });

    it("should include top 5 priority items ranked by urgency and financial impact (Req 16.2)", async () => {
      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      expect(digest.topAlerts).toHaveLength(5);
      // First alert should have highest urgency
      expect(digest.topAlerts[0].urgency).toBe("critical");
      expect(digest.topAlerts[0].title).toBe("Figma trial expiring soon");
    });

    it("should include renewals section (Req 16.3)", async () => {
      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      expect(digest.renewalsThisPeriod).toHaveLength(1);
      expect(digest.renewalsThisPeriod[0].vendor).toBe("Netflix");
      expect(digest.renewalsThisPeriod[0].amount).toBe(15.99);
      expect(digest.renewalsThisPeriod[0].autoRenews).toBe(true);
    });

    it("should include expiring trials section (Req 16.3)", async () => {
      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      expect(digest.expiringTrials).toHaveLength(1);
      expect(digest.expiringTrials[0].vendor).toBe("Figma");
      expect(digest.expiringTrials[0].autoConverts).toBe(true);
      expect(digest.expiringTrials[0].daysRemaining).toBe(2);
    });

    it("should include overdue refunds section (Req 16.3)", async () => {
      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      expect(digest.overdueRefunds).toHaveLength(1);
      expect(digest.overdueRefunds[0].vendor).toBe("Adobe");
      expect(digest.overdueRefunds[0].amount).toBe(54.99);
      expect(digest.overdueRefunds[0].daysOverdue).toBe(10);
    });

    it("should include broken payment promises section (Req 16.3)", async () => {
      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      expect(digest.brokenPaymentPromises).toHaveLength(1);
      expect(digest.brokenPaymentPromises[0].counterparty).toBe("Client A");
      expect(digest.brokenPaymentPromises[0].amount).toBe(500.0);
    });

    it("should include savings opportunities section (Req 16.3)", async () => {
      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      expect(digest.savingsOpportunities).toHaveLength(1);
      expect(digest.savingsOpportunities[0].vendor).toBe("Dropbox");
      expect(digest.savingsOpportunities[0].type).toBe("redundancy");
      expect(digest.savingsOpportunities[0].annualSavings).toBe(155.88);
    });

    it("should include spending insight (Req 16.3)", async () => {
      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      expect(digest.spendingInsight).toContain("increased");
      expect(digest.spendingInsight).toContain("5.6%");
    });

    it("should include creep warning when applicable (Req 16.3)", async () => {
      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      expect(digest.creepWarning).not.toBeNull();
      expect(digest.creepWarning).toContain("20%");
    });

    it("should set creep warning to null when no creep detected", async () => {
      (mockEngine.detectSubscriptionCreep as any).mockResolvedValue(null);
      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      expect(digest.creepWarning).toBeNull();
    });

    it("should attach one-click actions to digest items (Req 16.4)", async () => {
      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      expect(digest.oneClickActions.length).toBeGreaterThan(0);

      // Check action types are valid
      const validTypes = ["cancel", "negotiate", "follow_up", "set_reminder", "review", "acknowledge"];
      for (const action of digest.oneClickActions) {
        expect(validTypes).toContain(action.type);
        expect(action.label).toBeTruthy();
        expect(action.targetId).toBeTruthy();
      }
    });

    it("should include actions for renewals (set_reminder)", async () => {
      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      const renewalActions = digest.oneClickActions.filter(
        (a) => a.targetId.startsWith("renewal-")
      );
      expect(renewalActions.length).toBeGreaterThan(0);
      expect(renewalActions[0].type).toBe("set_reminder");
    });

    it("should include actions for trials (cancel)", async () => {
      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      const trialActions = digest.oneClickActions.filter(
        (a) => a.targetId.startsWith("trial-")
      );
      expect(trialActions.length).toBeGreaterThan(0);
      expect(trialActions[0].type).toBe("cancel");
    });

    it("should include actions for refunds (follow_up)", async () => {
      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      const refundActions = digest.oneClickActions.filter(
        (a) => a.targetId.startsWith("refund-")
      );
      expect(refundActions.length).toBeGreaterThan(0);
      expect(refundActions[0].type).toBe("follow_up");
    });

    it("should generate a valid digest ID with period and date", async () => {
      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      expect(digest.id).toMatch(/^digest-daily-\d{4}-\d{2}-\d{2}$/);
    });

    it("should set generatedAt to current time", async () => {
      const before = new Date();
      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);
      const after = new Date();

      expect(digest.generatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(digest.generatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should handle empty data gracefully", async () => {
      (mockRanker.getPriorityFeed as any).mockResolvedValue([]);
      const data = createMockDigestData({
        upcomingRenewals: [],
        expiringTrials: [],
        overdueRefunds: [],
        overdueCommitments: [],
      });
      const digest = await composer.composeDigest(data);

      expect(digest.renewalsThisPeriod).toHaveLength(0);
      expect(digest.expiringTrials).toHaveLength(0);
      expect(digest.overdueRefunds).toHaveLength(0);
      expect(digest.brokenPaymentPromises).toHaveLength(0);
      expect(digest.topAlerts).toHaveLength(0);
    });
  });

  describe("deliverDigest", () => {
    it("should deliver to dashboard when channel is 'dashboard'", async () => {
      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      // Should not throw
      await expect(composer.deliverDigest(digest, "dashboard")).resolves.toBeUndefined();
    });

    it("should deliver to email when channel is 'email' and email is configured", async () => {
      composer = new DigestComposer(mockEngine, mockStore, mockRanker, {
        userTimezone: "America/New_York",
        emailAddress: "user@example.com",
      });

      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      await expect(composer.deliverDigest(digest, "email")).resolves.toBeUndefined();
    });

    it("should deliver to both channels when channel is 'both'", async () => {
      composer = new DigestComposer(mockEngine, mockStore, mockRanker, {
        userTimezone: "America/New_York",
        emailAddress: "user@example.com",
      });

      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      await expect(composer.deliverDigest(digest, "both")).resolves.toBeUndefined();
    });
  });

  describe("priority adaptation (Req 16.7)", () => {
    it("should not reduce priority before threshold is reached", () => {
      composer.recordDismissal("refunds");
      composer.recordDismissal("refunds");

      const reduction = composer.getPriorityReduction("refunds");
      expect(reduction).toBe(1.0);
    });

    it("should reduce priority after 3 dismissals of same type", () => {
      composer.recordDismissal("refunds");
      composer.recordDismissal("refunds");
      composer.recordDismissal("refunds");

      const reduction = composer.getPriorityReduction("refunds");
      expect(reduction).toBe(0.5);
    });

    it("should progressively reduce priority with more dismissals", () => {
      for (let i = 0; i < 5; i++) {
        composer.recordDismissal("refunds");
      }

      const reduction = composer.getPriorityReduction("refunds");
      expect(reduction).toBeLessThan(0.5);
      expect(reduction).toBeGreaterThan(0.1);
    });

    it("should never reduce below 10%", () => {
      for (let i = 0; i < 100; i++) {
        composer.recordDismissal("refunds");
      }

      const reduction = composer.getPriorityReduction("refunds");
      expect(reduction).toBeGreaterThanOrEqual(0.1);
    });

    it("should track different item types independently", () => {
      composer.recordDismissal("refunds");
      composer.recordDismissal("refunds");
      composer.recordDismissal("refunds");
      composer.recordDismissal("renewals");

      expect(composer.getPriorityReduction("refunds")).toBe(0.5);
      expect(composer.getPriorityReduction("renewals")).toBe(1.0);
    });

    it("should apply priority reduction to top alerts in digest", async () => {
      // Dismiss "trials" feature area 3 times
      composer.recordDismissal("trials");
      composer.recordDismissal("trials");
      composer.recordDismissal("trials");

      const data = createMockDigestData();
      const digest = await composer.composeDigest(data);

      // The trial alert (urgency 10) should be demoted due to dismissals
      // It should no longer be the first item
      // After reduction: 10 * 0.5 = 5, which is less than refund's 8
      expect(digest.topAlerts[0].title).not.toBe("Figma trial expiring soon");
      expect(digest.topAlerts[0].title).toBe("Overdue refund from Adobe");
    });
  });

  describe("getScheduledDeliveryTime (Req 16.5)", () => {
    it("should return a date at 7:00 AM", () => {
      const deliveryTime = composer.getScheduledDeliveryTime("UTC");

      expect(deliveryTime.getHours()).toBe(7);
      expect(deliveryTime.getMinutes()).toBe(0);
    });

    it("should schedule for tomorrow if 7 AM has passed today", () => {
      // Create a composer and get delivery time
      const deliveryTime = composer.getScheduledDeliveryTime("UTC");
      const now = new Date();

      // The delivery time should be in the future
      expect(deliveryTime.getTime()).toBeGreaterThan(now.getTime());
    });

    it("should use configured timezone when none provided", () => {
      const deliveryTime = composer.getScheduledDeliveryTime();
      expect(deliveryTime).toBeInstanceOf(Date);
    });
  });

  describe("getDismissalHistory", () => {
    it("should return empty map initially", () => {
      const history = composer.getDismissalHistory();
      expect(history.size).toBe(0);
    });

    it("should track dismissals correctly", () => {
      composer.recordDismissal("refunds");
      composer.recordDismissal("refunds");
      composer.recordDismissal("trials");

      const history = composer.getDismissalHistory();
      expect(history.size).toBe(2);
      expect(history.get("refunds")?.count).toBe(2);
      expect(history.get("trials")?.count).toBe(1);
    });
  });
});
