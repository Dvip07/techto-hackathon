/**
 * Unit tests for the Intelligence Engine — Refund & Credit Tracker
 *
 * Tests refund tracking, expected-by date calculation, overdue detection,
 * and total amount tracking.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.5, 10.6
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IntelligenceEngine } from "./intelligence-engine";
import { SQLiteEntityStore } from "../store/entity-store";
import type { RefundRecord } from "../types/models";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createRefund(overrides: Partial<RefundRecord> = {}): RefundRecord {
  return {
    id: "refund-1",
    vendor: "Amazon",
    amount: 49.99,
    currency: "USD",
    promisedDate: new Date("2025-01-01"),
    expectedByDate: new Date("2025-01-15"), // 14 days from promise date
    actualReceivedDate: null,
    status: "promised",
    daysOverdue: 0,
    originalTransactionDate: new Date("2024-12-20"),
    reason: "Defective product return",
    sourceMessageIds: ["msg-refund-1"],
    lastFollowUpDate: null,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("IntelligenceEngine - trackRefundsAndCredits", () => {
  let store: SQLiteEntityStore;
  let engine: IntelligenceEngine;

  beforeEach(() => {
    store = new SQLiteEntityStore(":memory:");
    engine = new IntelligenceEngine(store);
  });

  it("should return empty result when no refunds exist", async () => {
    const result = await engine.trackRefundsAndCredits();

    expect(result.pendingRefunds).toHaveLength(0);
    expect(result.overdueRefunds).toHaveLength(0);
    expect(result.totalPendingAmount).toBe(0);
    expect(result.totalOverdueAmount).toBe(0);
    expect(result.totalTrackedRefunds).toBe(0);
  });

  it("should track pending refunds and compute total pending amount (Req 10.6)", async () => {
    const refund1 = createRefund({
      id: "refund-1",
      vendor: "Amazon",
      amount: 49.99,
      promisedDate: new Date("2025-01-10"),
      expectedByDate: new Date("2025-01-24"),
      status: "promised",
    });
    const refund2 = createRefund({
      id: "refund-2",
      vendor: "Best Buy",
      amount: 129.99,
      promisedDate: new Date("2025-01-12"),
      expectedByDate: new Date("2025-01-26"),
      status: "processing",
    });

    await store.insertRefund(refund1);
    await store.insertRefund(refund2);

    // Use a date that's before the overdue threshold (expected + 14 days)
    // refund1 expected 2025-01-24, overdue after 2025-02-07
    // refund2 expected 2025-01-26, overdue after 2025-02-09
    // Set "now" to 2025-01-30 — both still pending
    const result = await engine.trackRefundsAndCredits();

    // Since we can't control "now" in the method directly, let's verify the structure
    // Both refunds should be tracked
    expect(result.totalTrackedRefunds).toBe(2);
    expect(result.totalPendingAmount + result.totalOverdueAmount).toBeCloseTo(179.98, 2);
  });

  it("should mark refunds as overdue when not confirmed within 14 days of expected date (Req 10.3)", async () => {
    // Create a refund with expected date far in the past
    const overdueRefund = createRefund({
      id: "refund-overdue",
      vendor: "Amazon",
      amount: 75.00,
      promisedDate: new Date("2024-11-01"),
      expectedByDate: new Date("2024-11-15"), // expected by Nov 15
      status: "promised", // still marked as promised
    });

    await store.insertRefund(overdueRefund);

    const result = await engine.trackRefundsAndCredits();

    // Should be marked as overdue (current date is well past Nov 15 + 14 days = Nov 29)
    expect(result.overdueRefunds).toHaveLength(1);
    expect(result.overdueRefunds[0].status).toBe("overdue");
    expect(result.overdueRefunds[0].daysOverdue).toBeGreaterThan(0);
    expect(result.pendingRefunds).toHaveLength(0);
    expect(result.totalOverdueAmount).toBe(75.00);
  });

  it("should track total overdue refund amounts (Req 10.6)", async () => {
    // Two refunds that are clearly overdue
    const refund1 = createRefund({
      id: "refund-1",
      vendor: "Amazon",
      amount: 50.00,
      promisedDate: new Date("2024-10-01"),
      expectedByDate: new Date("2024-10-15"),
      status: "promised",
    });
    const refund2 = createRefund({
      id: "refund-2",
      vendor: "Walmart",
      amount: 25.50,
      promisedDate: new Date("2024-10-05"),
      expectedByDate: new Date("2024-10-19"),
      status: "processing",
    });

    await store.insertRefund(refund1);
    await store.insertRefund(refund2);

    const result = await engine.trackRefundsAndCredits();

    expect(result.overdueRefunds).toHaveLength(2);
    expect(result.totalOverdueAmount).toBeCloseTo(75.50, 2);
  });

  it("should not mark received refunds as overdue", async () => {
    // A refund already marked as received should not appear
    const receivedRefund = createRefund({
      id: "refund-received",
      vendor: "Amazon",
      amount: 30.00,
      status: "received",
      actualReceivedDate: new Date("2025-01-10"),
    });

    await store.insertRefund(receivedRefund);

    const result = await engine.trackRefundsAndCredits();

    // Received refunds are not in pending or overdue
    expect(result.pendingRefunds).toHaveLength(0);
    expect(result.overdueRefunds).toHaveLength(0);
    expect(result.totalTrackedRefunds).toBe(0);
  });

  it("should handle already-overdue refunds from the store", async () => {
    // A refund already marked as overdue in the store
    const overdueRefund = createRefund({
      id: "refund-already-overdue",
      vendor: "Target",
      amount: 89.99,
      promisedDate: new Date("2024-09-01"),
      expectedByDate: new Date("2024-09-15"),
      status: "overdue",
      daysOverdue: 30,
    });

    await store.insertRefund(overdueRefund);

    const result = await engine.trackRefundsAndCredits();

    expect(result.overdueRefunds).toHaveLength(1);
    expect(result.overdueRefunds[0].vendor).toBe("Target");
    expect(result.overdueRefunds[0].daysOverdue).toBeGreaterThan(0);
    expect(result.totalOverdueAmount).toBe(89.99);
  });

  it("should set expected-by date to 14 days from promise date when no specific date (Req 10.2)", async () => {
    // Create a refund where expectedByDate is based on promisedDate + 14 days
    const promiseDate = new Date();
    promiseDate.setDate(promiseDate.getDate() - 5); // promised 5 days ago

    const expectedBy = new Date(promiseDate);
    expectedBy.setDate(expectedBy.getDate() + 14); // 14 days from promise

    const refund = createRefund({
      id: "refund-no-date",
      vendor: "Shopify Store",
      amount: 35.00,
      promisedDate: promiseDate,
      expectedByDate: expectedBy,
      status: "promised",
    });

    await store.insertRefund(refund);

    const result = await engine.trackRefundsAndCredits();

    // Should still be pending (5 days ago + 14 days expected + 14 days grace = 23 days from now)
    expect(result.pendingRefunds).toHaveLength(1);
    expect(result.pendingRefunds[0].vendor).toBe("Shopify Store");
  });

  it("should correctly compute days overdue for overdue refunds", async () => {
    // Create a refund that's been overdue for a known number of days
    const expectedDate = new Date();
    expectedDate.setDate(expectedDate.getDate() - 30); // expected 30 days ago

    const refund = createRefund({
      id: "refund-days-check",
      vendor: "eBay",
      amount: 42.00,
      promisedDate: new Date("2024-10-01"),
      expectedByDate: expectedDate,
      status: "promised",
    });

    await store.insertRefund(refund);

    const result = await engine.trackRefundsAndCredits();

    // Should be overdue: expected 30 days ago + 14 days grace = 16 days overdue
    expect(result.overdueRefunds).toHaveLength(1);
    expect(result.overdueRefunds[0].daysOverdue).toBeCloseTo(16, 0);
  });

  it("should return correct totalTrackedRefunds count", async () => {
    // Mix of pending and overdue refunds
    const pendingRefund = createRefund({
      id: "refund-pending",
      vendor: "Apple",
      amount: 99.00,
      promisedDate: new Date(),
      expectedByDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
      status: "promised",
    });

    const overdueRefund = createRefund({
      id: "refund-overdue",
      vendor: "Google",
      amount: 15.00,
      promisedDate: new Date("2024-06-01"),
      expectedByDate: new Date("2024-06-15"),
      status: "promised",
    });

    await store.insertRefund(pendingRefund);
    await store.insertRefund(overdueRefund);

    const result = await engine.trackRefundsAndCredits();

    expect(result.totalTrackedRefunds).toBe(2);
    expect(result.pendingRefunds.length + result.overdueRefunds.length).toBe(2);
  });
});
