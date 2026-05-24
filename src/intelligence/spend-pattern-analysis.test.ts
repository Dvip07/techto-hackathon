/**
 * Unit tests for the Intelligence Engine — Spend Pattern Analysis
 *
 * Tests monthly totals, category breakdowns, MoM/QoQ comparisons,
 * anomaly detection, natural language insights, and spend prediction.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IntelligenceEngine } from "./intelligence-engine";
import { SQLiteEntityStore } from "../store/entity-store";
import type { PaymentRecord } from "../types/models";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createPayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: `payment-${Math.random().toString(36).slice(2, 8)}`,
    vendor: "Netflix",
    amount: 15.99,
    currency: "USD",
    category: "video-streaming",
    date: new Date(),
    type: "subscription",
    sourceMessageId: "msg-1",
    ...overrides,
  };
}

function getMonthDate(monthsAgo: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - monthsAgo, 15);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("IntelligenceEngine - analyzeSpendingPatterns", () => {
  let store: SQLiteEntityStore;
  let engine: IntelligenceEngine;

  beforeEach(() => {
    store = new SQLiteEntityStore(":memory:");
    engine = new IntelligenceEngine(store);
  });

  describe("Req 13.1: Monthly totals and category breakdowns", () => {
    it("should return monthly totals for the analysis period", async () => {
      // Insert payments across multiple months
      await store.insertPayment(createPayment({ amount: 100, date: getMonthDate(0) }));
      await store.insertPayment(createPayment({ amount: 80, date: getMonthDate(1) }));
      await store.insertPayment(createPayment({ amount: 60, date: getMonthDate(2) }));

      const result = await engine.analyzeSpendingPatterns();

      expect(result.monthlyTotals).toBeDefined();
      expect(result.monthlyTotals.length).toBeGreaterThan(0);

      // The most recent months should have our payment data
      const recentMonths = result.monthlyTotals.filter((m) => m.totalAmount > 0);
      expect(recentMonths.length).toBe(3);
    });

    it("should produce category breakdowns with percentage of total", async () => {
      await store.insertPayment(createPayment({ amount: 50, category: "software-saas", date: getMonthDate(0) }));
      await store.insertPayment(createPayment({ amount: 30, category: "video-streaming", date: getMonthDate(0) }));
      await store.insertPayment(createPayment({ amount: 20, category: "music-streaming", date: getMonthDate(0) }));

      const result = await engine.analyzeSpendingPatterns();

      expect(result.categoryBreakdown).toBeDefined();
      expect(result.categoryBreakdown.length).toBeGreaterThan(0);

      // Percentages should sum to approximately 100
      const totalPercentage = result.categoryBreakdown.reduce((sum, c) => sum + c.percentageOfTotal, 0);
      expect(totalPercentage).toBeCloseTo(100, 0);
    });
  });

  describe("Req 13.2: Month-over-month and quarter-over-quarter comparisons", () => {
    it("should compute month-over-month comparison", async () => {
      await store.insertPayment(createPayment({ amount: 100, date: getMonthDate(0) }));
      await store.insertPayment(createPayment({ amount: 80, date: getMonthDate(1) }));

      const result = await engine.analyzeSpendingPatterns();

      expect(result.monthOverMonth).toBeDefined();
      expect(result.monthOverMonth.currentMonth).toBe(100);
      expect(result.monthOverMonth.previousMonth).toBe(80);
      expect(result.monthOverMonth.absoluteChange).toBe(20);
      expect(result.monthOverMonth.percentageChange).toBe(25);
      expect(result.monthOverMonth.direction).toBe("increasing");
    });

    it("should detect decreasing month-over-month spend", async () => {
      await store.insertPayment(createPayment({ amount: 50, date: getMonthDate(0) }));
      await store.insertPayment(createPayment({ amount: 100, date: getMonthDate(1) }));

      const result = await engine.analyzeSpendingPatterns();

      expect(result.monthOverMonth.direction).toBe("decreasing");
      expect(result.monthOverMonth.percentageChange).toBe(-50);
    });

    it("should detect stable month-over-month spend", async () => {
      await store.insertPayment(createPayment({ amount: 100, date: getMonthDate(0) }));
      await store.insertPayment(createPayment({ amount: 98, date: getMonthDate(1) }));

      const result = await engine.analyzeSpendingPatterns();

      expect(result.monthOverMonth.direction).toBe("stable");
    });

    it("should compute quarter-over-quarter comparison", async () => {
      // Current quarter (months 0, 1, 2)
      await store.insertPayment(createPayment({ amount: 120, date: getMonthDate(0) }));
      await store.insertPayment(createPayment({ amount: 110, date: getMonthDate(1) }));
      await store.insertPayment(createPayment({ amount: 100, date: getMonthDate(2) }));
      // Previous quarter (months 3, 4, 5)
      await store.insertPayment(createPayment({ amount: 80, date: getMonthDate(3) }));
      await store.insertPayment(createPayment({ amount: 75, date: getMonthDate(4) }));
      await store.insertPayment(createPayment({ amount: 70, date: getMonthDate(5) }));

      const result = await engine.analyzeSpendingPatterns();

      expect(result.quarterOverQuarter).toBeDefined();
      expect(result.quarterOverQuarter.currentQuarter).toBe(330); // 120+110+100
      expect(result.quarterOverQuarter.previousQuarter).toBe(225); // 80+75+70
      expect(result.quarterOverQuarter.direction).toBe("increasing");
      expect(result.quarterOverQuarter.percentageChange).toBeGreaterThan(0);
    });
  });

  describe("Req 13.3: Spending anomaly detection", () => {
    it("should detect sudden increase >25% month-over-month", async () => {
      await store.insertPayment(createPayment({ amount: 200, date: getMonthDate(0) }));
      await store.insertPayment(createPayment({ amount: 100, date: getMonthDate(1) }));

      const result = await engine.analyzeSpendingPatterns();

      const suddenIncreases = result.anomalies.filter((a) => a.type === "sudden_increase");
      expect(suddenIncreases.length).toBeGreaterThan(0);
      expect(suddenIncreases[0].percentageChange).toBeGreaterThan(25);
    });

    it("should not flag increases below 25% as anomalies", async () => {
      await store.insertPayment(createPayment({ amount: 120, date: getMonthDate(0) }));
      await store.insertPayment(createPayment({ amount: 100, date: getMonthDate(1) }));

      const result = await engine.analyzeSpendingPatterns();

      const suddenIncreases = result.anomalies.filter((a) => a.type === "sudden_increase");
      expect(suddenIncreases.length).toBe(0);
    });

    it("should detect new recurring charges", async () => {
      // Insert a spend snapshot with new subscriptions
      const db = (store as any).db;
      db.prepare(`
        INSERT INTO spend_snapshots (month, total_monthly_recurring, subscription_count, new_this_month, cancelled_this_month, price_changes_this_month)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("2025-01", 150, 3, JSON.stringify(["Figma"]), JSON.stringify([]), JSON.stringify([]));

      const result = await engine.analyzeSpendingPatterns();

      const newCharges = result.anomalies.filter((a) => a.type === "new_recurring_charge");
      expect(newCharges.length).toBe(1);
      expect(newCharges[0].vendor).toBe("Figma");
    });
  });

  describe("Req 13.4: Natural language insights", () => {
    it("should generate insights describing spending trends", async () => {
      await store.insertPayment(createPayment({ amount: 150, date: getMonthDate(0) }));
      await store.insertPayment(createPayment({ amount: 100, date: getMonthDate(1) }));

      const result = await engine.analyzeSpendingPatterns();

      expect(result.insights).toBeDefined();
      expect(result.insights.length).toBeGreaterThan(0);
      // Should contain a MoM insight about the increase
      const momInsight = result.insights.find((i) => i.includes("increased"));
      expect(momInsight).toBeDefined();
    });

    it("should generate top category insight", async () => {
      await store.insertPayment(createPayment({ amount: 80, category: "software-saas", date: getMonthDate(0) }));
      await store.insertPayment(createPayment({ amount: 20, category: "video-streaming", date: getMonthDate(0) }));

      const result = await engine.analyzeSpendingPatterns();

      const categoryInsight = result.insights.find((i) => i.includes("top spending category"));
      expect(categoryInsight).toBeDefined();
      expect(categoryInsight).toContain("software saas");
    });
  });

  describe("Req 13.5: Predict future monthly spend", () => {
    it("should predict next month spend based on historical patterns", async () => {
      // Insert increasing spend pattern
      await store.insertPayment(createPayment({ amount: 100, date: getMonthDate(5) }));
      await store.insertPayment(createPayment({ amount: 110, date: getMonthDate(4) }));
      await store.insertPayment(createPayment({ amount: 120, date: getMonthDate(3) }));
      await store.insertPayment(createPayment({ amount: 130, date: getMonthDate(2) }));
      await store.insertPayment(createPayment({ amount: 140, date: getMonthDate(1) }));
      await store.insertPayment(createPayment({ amount: 150, date: getMonthDate(0) }));

      const result = await engine.analyzeSpendingPatterns();

      expect(result.predictedNextMonthSpend).toBeDefined();
      // With a linear increasing pattern, prediction should be > current month
      expect(result.predictedNextMonthSpend).toBeGreaterThan(150);
    });

    it("should return 0 when no data is available", async () => {
      const result = await engine.analyzeSpendingPatterns();
      expect(result.predictedNextMonthSpend).toBe(0);
    });

    it("should never predict negative spend", async () => {
      // Insert decreasing pattern that could extrapolate to negative
      await store.insertPayment(createPayment({ amount: 50, date: getMonthDate(3) }));
      await store.insertPayment(createPayment({ amount: 30, date: getMonthDate(2) }));
      await store.insertPayment(createPayment({ amount: 10, date: getMonthDate(1) }));
      await store.insertPayment(createPayment({ amount: 1, date: getMonthDate(0) }));

      const result = await engine.analyzeSpendingPatterns();

      expect(result.predictedNextMonthSpend).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Req 13.6: Top spending category", () => {
    it("should identify the top spending category with percentage", async () => {
      await store.insertPayment(createPayment({ amount: 60, category: "software-saas", date: getMonthDate(0) }));
      await store.insertPayment(createPayment({ amount: 30, category: "video-streaming", date: getMonthDate(0) }));
      await store.insertPayment(createPayment({ amount: 10, category: "music-streaming", date: getMonthDate(0) }));

      const result = await engine.analyzeSpendingPatterns();

      expect(result.topCategory).toBeDefined();
      expect(result.topCategory.category).toBe("software-saas");
      expect(result.topCategory.percentage).toBe(60); // 60 out of 100
      expect(result.topCategory.amount).toBe(60);
    });

    it("should return 'other' with 0% when no data exists", async () => {
      const result = await engine.analyzeSpendingPatterns();

      expect(result.topCategory.category).toBe("other");
      expect(result.topCategory.percentage).toBe(0);
    });
  });

  describe("Result structure", () => {
    it("should return a complete SpendAnalysis result", async () => {
      await store.insertPayment(createPayment({ amount: 100, date: getMonthDate(0) }));
      await store.insertPayment(createPayment({ amount: 80, date: getMonthDate(1) }));

      const result = await engine.analyzeSpendingPatterns();

      expect(result.monthlyTotals).toBeDefined();
      expect(result.categoryBreakdown).toBeDefined();
      expect(result.monthOverMonth).toBeDefined();
      expect(result.quarterOverQuarter).toBeDefined();
      expect(result.anomalies).toBeDefined();
      expect(result.insights).toBeDefined();
      expect(result.predictedNextMonthSpend).toBeDefined();
      expect(result.topCategory).toBeDefined();
      expect(result.totalMonthlySpend).toBeDefined();
      expect(result.analyzedAt).toBeInstanceOf(Date);
    });

    it("should set totalMonthlySpend to the most recent month total", async () => {
      await store.insertPayment(createPayment({ amount: 150, date: getMonthDate(0) }));
      await store.insertPayment(createPayment({ amount: 80, date: getMonthDate(1) }));

      const result = await engine.analyzeSpendingPatterns();

      expect(result.totalMonthlySpend).toBe(150);
    });
  });
});
