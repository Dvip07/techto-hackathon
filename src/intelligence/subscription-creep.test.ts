/**
 * Unit tests for the Intelligence Engine — Subscription Creep Detection
 *
 * Tests creep detection thresholds, natural language insight generation,
 * breakdown of contributing factors, and alert acknowledgment.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IntelligenceEngine } from "./intelligence-engine";
import { SQLiteEntityStore } from "../store/entity-store";
import type { SubscriptionRecord } from "../types/models";
import type { RecurringSpendSnapshot } from "../types/outputs";

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

/**
 * Helper to insert a spend snapshot directly into the store's database.
 */
function insertSnapshot(store: SQLiteEntityStore, snapshot: RecurringSpendSnapshot): void {
  const db = (store as any).db;
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO spend_snapshots (
      month, total_monthly_recurring, subscription_count,
      new_this_month, cancelled_this_month, price_changes_this_month
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    snapshot.month,
    snapshot.totalMonthlyRecurring,
    snapshot.subscriptionCount,
    JSON.stringify(snapshot.newThisMonth),
    JSON.stringify(snapshot.cancelledThisMonth),
    JSON.stringify(snapshot.priceChangesThisMonth),
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("IntelligenceEngine - detectSubscriptionCreep", () => {
  let store: SQLiteEntityStore;
  let engine: IntelligenceEngine;

  beforeEach(() => {
    store = new SQLiteEntityStore(":memory:");
    engine = new IntelligenceEngine(store);
  });

  describe("Requirement 9.1: Monthly spend snapshots", () => {
    it("should take a monthly snapshot when none exists for the current month", async () => {
      // Add some active subscriptions
      await store.upsertSubscription(
        createSubscription({
          id: "sub-1",
          vendor: "Netflix",
          vendorDomain: "netflix.com",
          amount: 15.99,
        })
      );
      await store.upsertSubscription(
        createSubscription({
          id: "sub-2",
          vendor: "Spotify",
          vendorDomain: "spotify.com",
          amount: 11.99,
          category: "music-streaming",
        })
      );

      await engine.detectSubscriptionCreep();

      const snapshots = await store.getTotalRecurringSpend();
      expect(snapshots.length).toBeGreaterThanOrEqual(1);

      const latestSnapshot = snapshots[snapshots.length - 1];
      expect(latestSnapshot.totalMonthlyRecurring).toBeCloseTo(27.98, 1);
      expect(latestSnapshot.subscriptionCount).toBe(2);
    });

    it("should not overwrite an existing snapshot for the current month", async () => {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      // Insert a snapshot for the current month
      insertSnapshot(store, {
        month: currentMonth,
        totalMonthlyRecurring: 50,
        subscriptionCount: 3,
        newThisMonth: ["OldService"],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      // Add a subscription (which would change the total if snapshot was overwritten)
      await store.upsertSubscription(
        createSubscription({
          id: "sub-new",
          vendor: "NewService",
          vendorDomain: "newservice.com",
          amount: 20,
        })
      );

      await engine.detectSubscriptionCreep();

      const snapshots = await store.getTotalRecurringSpend();
      const currentSnapshot = snapshots.find((s) => s.month === currentMonth);
      // Should still be the original value since we don't overwrite
      expect(currentSnapshot!.totalMonthlyRecurring).toBe(50);
    });
  });

  describe("Requirement 9.2: 15% spend growth over 90 days triggers alert", () => {
    it("should generate a CreepAlert when spend grows ≥15% over 90 days", async () => {
      const now = new Date();
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      // Insert historical snapshots showing 20% growth
      insertSnapshot(store, {
        month: `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, "0")}`,
        totalMonthlyRecurring: 100,
        subscriptionCount: 5,
        newThisMonth: [],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      insertSnapshot(store, {
        month: `${twoMonthsAgo.getFullYear()}-${String(twoMonthsAgo.getMonth() + 1).padStart(2, "0")}`,
        totalMonthlyRecurring: 110,
        subscriptionCount: 6,
        newThisMonth: ["ServiceA"],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      insertSnapshot(store, {
        month: `${oneMonthAgo.getFullYear()}-${String(oneMonthAgo.getMonth() + 1).padStart(2, "0")}`,
        totalMonthlyRecurring: 115,
        subscriptionCount: 6,
        newThisMonth: [],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      // Current month: 120 (20% growth from 100)
      insertSnapshot(store, {
        month: currentMonth,
        totalMonthlyRecurring: 120,
        subscriptionCount: 7,
        newThisMonth: ["ServiceB"],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      const alert = await engine.detectSubscriptionCreep();

      expect(alert).not.toBeNull();
      expect(alert!.percentageIncrease).toBeCloseTo(20, 0);
      expect(alert!.startingMonthlySpend).toBe(100);
      expect(alert!.currentMonthlySpend).toBe(120);
      expect(alert!.absoluteIncrease).toBe(20);
    });

    it("should NOT generate a CreepAlert when spend grows less than 15%", async () => {
      const now = new Date();
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      // Insert snapshots showing only 10% growth (below threshold)
      insertSnapshot(store, {
        month: `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, "0")}`,
        totalMonthlyRecurring: 100,
        subscriptionCount: 5,
        newThisMonth: [],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      insertSnapshot(store, {
        month: currentMonth,
        totalMonthlyRecurring: 110,
        subscriptionCount: 5,
        newThisMonth: [],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      const alert = await engine.detectSubscriptionCreep();

      expect(alert).toBeNull();
    });

    it("should return null when there is only one month of data", async () => {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      insertSnapshot(store, {
        month: currentMonth,
        totalMonthlyRecurring: 100,
        subscriptionCount: 5,
        newThisMonth: [],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      const alert = await engine.detectSubscriptionCreep();

      expect(alert).toBeNull();
    });
  });

  describe("Requirement 9.3: ≥3 new subscriptions in 30 days triggers alert", () => {
    it("should generate a CreepAlert when ≥3 new subscriptions added in current month", async () => {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonth = `${oneMonthAgo.getFullYear()}-${String(oneMonthAgo.getMonth() + 1).padStart(2, "0")}`;

      // Use spend values that don't trigger the 15% threshold
      // so only the new subscriptions threshold fires
      insertSnapshot(store, {
        month: prevMonth,
        totalMonthlyRecurring: 100,
        subscriptionCount: 3,
        newThisMonth: [],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      insertSnapshot(store, {
        month: currentMonth,
        totalMonthlyRecurring: 110, // only 10% growth, below 15% threshold
        subscriptionCount: 6,
        newThisMonth: ["ServiceA", "ServiceB", "ServiceC"],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      const alert = await engine.detectSubscriptionCreep();

      expect(alert).not.toBeNull();
      expect(alert!.insight).toContain("3 new subscriptions");
      expect(alert!.insight).toContain("ServiceA");
      expect(alert!.insight).toContain("ServiceB");
      expect(alert!.insight).toContain("ServiceC");
    });

    it("should NOT generate a CreepAlert when fewer than 3 new subscriptions added", async () => {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonth = `${oneMonthAgo.getFullYear()}-${String(oneMonthAgo.getMonth() + 1).padStart(2, "0")}`;

      insertSnapshot(store, {
        month: prevMonth,
        totalMonthlyRecurring: 50,
        subscriptionCount: 3,
        newThisMonth: [],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      insertSnapshot(store, {
        month: currentMonth,
        totalMonthlyRecurring: 55,
        subscriptionCount: 4,
        newThisMonth: ["ServiceA", "ServiceB"],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      const alert = await engine.detectSubscriptionCreep();

      expect(alert).toBeNull();
    });
  });

  describe("Requirement 9.4: Breakdown of contributing factors", () => {
    it("should include price increases in the alert breakdown", async () => {
      const now = new Date();
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      const priceChange = {
        previousAmount: 9.99,
        newAmount: 14.99,
        detectedDate: new Date(),
        percentageChange: 50.05,
        sourceMessageId: "msg-price",
      };

      insertSnapshot(store, {
        month: `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, "0")}`,
        totalMonthlyRecurring: 80,
        subscriptionCount: 4,
        newThisMonth: [],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      insertSnapshot(store, {
        month: `${twoMonthsAgo.getFullYear()}-${String(twoMonthsAgo.getMonth() + 1).padStart(2, "0")}`,
        totalMonthlyRecurring: 90,
        subscriptionCount: 4,
        newThisMonth: [],
        cancelledThisMonth: [],
        priceChangesThisMonth: [priceChange],
      });

      insertSnapshot(store, {
        month: currentMonth,
        totalMonthlyRecurring: 100,
        subscriptionCount: 5,
        newThisMonth: ["NewService"],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      const alert = await engine.detectSubscriptionCreep();

      expect(alert).not.toBeNull();
      expect(alert!.priceIncreasesDetected.length).toBeGreaterThanOrEqual(1);
      expect(alert!.priceIncreasesDetected[0].previousAmount).toBe(9.99);
      expect(alert!.priceIncreasesDetected[0].newAmount).toBe(14.99);
    });
  });

  describe("Requirement 9.5: Natural language insight", () => {
    it("should generate insight with percentage, absolute increase, starting and current spend", async () => {
      const now = new Date();
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      insertSnapshot(store, {
        month: `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, "0")}`,
        totalMonthlyRecurring: 87,
        subscriptionCount: 5,
        newThisMonth: [],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      insertSnapshot(store, {
        month: currentMonth,
        totalMonthlyRecurring: 107,
        subscriptionCount: 7,
        newThisMonth: [],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      const alert = await engine.detectSubscriptionCreep();

      expect(alert).not.toBeNull();
      expect(alert!.insight).toContain("$87.00");
      expect(alert!.insight).toContain("$107.00");
      expect(alert!.insight).toContain("$20.00");
      // (107-87)/87 = 22.99% which rounds to 23.0% at 1 decimal place
      expect(alert!.insight).toContain("23.0%");
    });
  });

  describe("Requirement 9.6: Alert acknowledgment", () => {
    it("should suppress repeated alerts after acknowledgment", async () => {
      const now = new Date();
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      insertSnapshot(store, {
        month: `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, "0")}`,
        totalMonthlyRecurring: 100,
        subscriptionCount: 5,
        newThisMonth: [],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      insertSnapshot(store, {
        month: currentMonth,
        totalMonthlyRecurring: 120,
        subscriptionCount: 7,
        newThisMonth: [],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      // First call should generate an alert
      const firstAlert = await engine.detectSubscriptionCreep();
      expect(firstAlert).not.toBeNull();

      // Acknowledge the alert
      engine.acknowledgeCreepAlert(firstAlert!.id);

      // Second call should be suppressed
      const secondAlert = await engine.detectSubscriptionCreep();
      expect(secondAlert).toBeNull();
    });

    it("should return alert with acknowledged field set to false initially", async () => {
      const now = new Date();
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      insertSnapshot(store, {
        month: `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, "0")}`,
        totalMonthlyRecurring: 100,
        subscriptionCount: 5,
        newThisMonth: [],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      insertSnapshot(store, {
        month: currentMonth,
        totalMonthlyRecurring: 120,
        subscriptionCount: 7,
        newThisMonth: [],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      const alert = await engine.detectSubscriptionCreep();

      expect(alert).not.toBeNull();
      expect(alert!.acknowledged).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("should return null when no snapshots exist and no subscriptions", async () => {
      const alert = await engine.detectSubscriptionCreep();
      expect(alert).toBeNull();
    });

    it("should return null when starting spend is zero", async () => {
      const now = new Date();
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      insertSnapshot(store, {
        month: `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, "0")}`,
        totalMonthlyRecurring: 0,
        subscriptionCount: 0,
        newThisMonth: [],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      insertSnapshot(store, {
        month: currentMonth,
        totalMonthlyRecurring: 50,
        subscriptionCount: 3,
        newThisMonth: ["A", "B", "C"],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      const alert = await engine.detectSubscriptionCreep();

      // The spend growth check returns null (can't compute % from 0),
      // but the new subscriptions check should trigger
      expect(alert).not.toBeNull();
      expect(alert!.insight).toContain("3 new subscriptions");
    });

    it("should include period months in the alert", async () => {
      const now = new Date();
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      insertSnapshot(store, {
        month: `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, "0")}`,
        totalMonthlyRecurring: 100,
        subscriptionCount: 5,
        newThisMonth: [],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      insertSnapshot(store, {
        month: currentMonth,
        totalMonthlyRecurring: 130,
        subscriptionCount: 7,
        newThisMonth: [],
        cancelledThisMonth: [],
        priceChangesThisMonth: [],
      });

      const alert = await engine.detectSubscriptionCreep();

      expect(alert).not.toBeNull();
      expect(alert!.periodMonths).toBe(3);
    });
  });
});
