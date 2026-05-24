/**
 * Unit tests for the Intelligence Engine — Payment Promise Tracker
 *
 * Tests payment promise tracking, overdue detection, fulfillment matching,
 * and ranking by financial amount and days overdue.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.5, 11.6
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IntelligenceEngine } from "./intelligence-engine";
import { SQLiteEntityStore } from "../store/entity-store";
import type { FinancialCommitment } from "../types/models";
import type { AnalyzedMessage } from "../types/signals";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createPaymentPromise(
  overrides: Partial<FinancialCommitment> = {}
): FinancialCommitment {
  return {
    id: "commitment-1",
    messageId: "msg-1",
    threadId: "thread-1",
    type: "inbound",
    subtype: "payment_promise",
    description: "Will pay invoice by Friday",
    owner: "client@acme.com",
    counterparty: "acme.com",
    financialValue: 500,
    currency: "USD",
    dueDate: new Date("2025-02-01"),
    status: "open",
    isImplicit: false,
    confidence: 0.9,
    priority: 5,
    createdAt: new Date("2025-01-15"),
    updatedAt: new Date("2025-01-15"),
    fulfilledAt: null,
    lastFollowUpDate: null,
    ...overrides,
  };
}

function createPaymentReceiptMessage(
  overrides: Partial<AnalyzedMessage> = {}
): AnalyzedMessage {
  return {
    messageId: "receipt-msg-1",
    threadId: "thread-receipt-1",
    timestamp: new Date("2025-02-01"),
    sender: "payments@acme.com",
    senderDomain: "acme.com",
    classifications: ["payment_received"],
    subscriptionSignal: null,
    commitmentSignals: [],
    contractSignal: null,
    refundSignal: null,
    trialSignal: null,
    financialEntities: [],
    usageIndicators: [],
    urgencyScore: 0,
    summary: "Payment received from Acme",
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("IntelligenceEngine - trackPaymentPromises", () => {
  let store: SQLiteEntityStore;
  let engine: IntelligenceEngine;

  beforeEach(() => {
    store = new SQLiteEntityStore(":memory:");
    engine = new IntelligenceEngine(store);
  });

  describe("basic functionality", () => {
    it("should return empty result when no payment promises exist", async () => {
      const result = await engine.trackPaymentPromises();

      expect(result.openPromises).toHaveLength(0);
      expect(result.overduePromises).toHaveLength(0);
      expect(result.fulfilledPromises).toHaveLength(0);
      expect(result.totalOpenAmount).toBe(0);
      expect(result.totalOverdueAmount).toBe(0);
      expect(result.totalFulfilledAmount).toBe(0);
    });

    it("should return open promises that are not yet due", async () => {
      // Create a promise with a future due date
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      const promise = createPaymentPromise({
        id: "promise-open",
        dueDate: futureDate,
        financialValue: 1000,
      });
      await store.insertCommitment(promise);

      const result = await engine.trackPaymentPromises();

      expect(result.openPromises).toHaveLength(1);
      expect(result.openPromises[0].commitmentId).toBe("promise-open");
      expect(result.openPromises[0].amount).toBe(1000);
      expect(result.openPromises[0].status).toBe("open");
      expect(result.openPromises[0].daysOverdue).toBe(0);
      expect(result.totalOpenAmount).toBe(1000);
    });

    it("should only track inbound payment promises", async () => {
      // Inbound payment promise (someone promised to pay us)
      const inboundPromise = createPaymentPromise({
        id: "inbound-1",
        type: "inbound",
        subtype: "payment_promise",
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      // Outbound commitment (we promised to pay someone) — should be excluded
      const outboundPromise = createPaymentPromise({
        id: "outbound-1",
        type: "outbound",
        subtype: "payment_promise",
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      await store.insertCommitment(inboundPromise);
      await store.insertCommitment(outboundPromise);

      const result = await engine.trackPaymentPromises();

      // Only the inbound promise should appear
      expect(result.openPromises).toHaveLength(1);
      expect(result.openPromises[0].commitmentId).toBe("inbound-1");
    });
  });

  describe("overdue detection (Requirement 11.3)", () => {
    it("should mark promises as overdue when due date passes", async () => {
      // Create a promise with a past due date
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 5);

      const promise = createPaymentPromise({
        id: "promise-overdue",
        dueDate: pastDate,
        financialValue: 750,
      });
      await store.insertCommitment(promise);

      const result = await engine.trackPaymentPromises();

      expect(result.overduePromises).toHaveLength(1);
      expect(result.overduePromises[0].commitmentId).toBe("promise-overdue");
      expect(result.overduePromises[0].status).toBe("overdue");
      expect(result.overduePromises[0].daysOverdue).toBe(5);
      expect(result.totalOverdueAmount).toBe(750);
    });

    it("should not mark promises without a due date as overdue", async () => {
      const promise = createPaymentPromise({
        id: "promise-no-date",
        dueDate: null,
        financialValue: 200,
      });
      await store.insertCommitment(promise);

      const result = await engine.trackPaymentPromises();

      expect(result.overduePromises).toHaveLength(0);
      expect(result.openPromises).toHaveLength(1);
      expect(result.openPromises[0].commitmentId).toBe("promise-no-date");
    });

    it("should update commitment status to overdue in the store", async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 3);

      const promise = createPaymentPromise({
        id: "promise-status-update",
        dueDate: pastDate,
        status: "open",
      });
      await store.insertCommitment(promise);

      await engine.trackPaymentPromises();

      // Verify the store was updated
      const overdueCommitments = await store.getOverdueCommitments();
      expect(overdueCommitments.some((c) => c.id === "promise-status-update")).toBe(true);
    });
  });

  describe("ranking (Requirement 11.5)", () => {
    it("should rank overdue promises by financial amount descending", async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 5);

      const promises = [
        createPaymentPromise({
          id: "promise-small",
          counterparty: "small.com",
          dueDate: pastDate,
          financialValue: 100,
        }),
        createPaymentPromise({
          id: "promise-large",
          counterparty: "large.com",
          dueDate: pastDate,
          financialValue: 5000,
        }),
        createPaymentPromise({
          id: "promise-medium",
          counterparty: "medium.com",
          dueDate: pastDate,
          financialValue: 1000,
        }),
      ];

      for (const p of promises) {
        await store.insertCommitment(p);
      }

      const result = await engine.trackPaymentPromises();

      expect(result.overduePromises).toHaveLength(3);
      expect(result.overduePromises[0].amount).toBe(5000);
      expect(result.overduePromises[1].amount).toBe(1000);
      expect(result.overduePromises[2].amount).toBe(100);
    });

    it("should break ties by days overdue descending", async () => {
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      const promises = [
        createPaymentPromise({
          id: "promise-recent",
          counterparty: "recent.com",
          dueDate: fiveDaysAgo,
          financialValue: 500,
        }),
        createPaymentPromise({
          id: "promise-older",
          counterparty: "older.com",
          dueDate: tenDaysAgo,
          financialValue: 500,
        }),
      ];

      for (const p of promises) {
        await store.insertCommitment(p);
      }

      const result = await engine.trackPaymentPromises();

      expect(result.overduePromises).toHaveLength(2);
      // Same amount, so sorted by days overdue descending
      expect(result.overduePromises[0].commitmentId).toBe("promise-older");
      expect(result.overduePromises[0].daysOverdue).toBe(10);
      expect(result.overduePromises[1].commitmentId).toBe("promise-recent");
      expect(result.overduePromises[1].daysOverdue).toBe(5);
    });
  });

  describe("fulfillment detection (Requirement 11.6)", () => {
    it("should detect fulfillment by matching payment receipt to promise by counterparty", async () => {
      const promise = createPaymentPromise({
        id: "promise-fulfilled",
        counterparty: "acme.com",
        financialValue: null, // no specific amount
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date("2025-01-10"),
      });
      await store.insertCommitment(promise);

      // Insert a payment receipt message from the same counterparty
      const receipt = createPaymentReceiptMessage({
        messageId: "receipt-1",
        senderDomain: "acme.com",
        timestamp: new Date("2025-01-20"),
      });
      await store.insertMessage(receipt);

      const result = await engine.trackPaymentPromises();

      expect(result.fulfilledPromises).toHaveLength(1);
      expect(result.fulfilledPromises[0].commitmentId).toBe("promise-fulfilled");
      expect(result.fulfilledPromises[0].status).toBe("fulfilled");
    });

    it("should not match receipt from a different counterparty", async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      const promise = createPaymentPromise({
        id: "promise-unmatched",
        counterparty: "acme.com",
        dueDate: futureDate,
        createdAt: new Date("2025-01-10"),
      });
      await store.insertCommitment(promise);

      // Insert a payment receipt from a DIFFERENT sender
      const receipt = createPaymentReceiptMessage({
        messageId: "receipt-different",
        senderDomain: "othercorp.com",
        timestamp: new Date("2025-01-20"),
      });
      await store.insertMessage(receipt);

      const result = await engine.trackPaymentPromises();

      // Should remain open, not fulfilled
      expect(result.fulfilledPromises).toHaveLength(0);
      expect(result.openPromises).toHaveLength(1);
    });

    it("should not match receipt that occurred before the promise was created", async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      const promise = createPaymentPromise({
        id: "promise-timing",
        counterparty: "acme.com",
        dueDate: futureDate,
        createdAt: new Date("2025-02-01"),
      });
      await store.insertCommitment(promise);

      // Receipt is BEFORE the promise was created
      const receipt = createPaymentReceiptMessage({
        messageId: "receipt-old",
        senderDomain: "acme.com",
        timestamp: new Date("2025-01-15"),
      });
      await store.insertMessage(receipt);

      const result = await engine.trackPaymentPromises();

      expect(result.fulfilledPromises).toHaveLength(0);
      expect(result.openPromises).toHaveLength(1);
    });

    it("should update commitment status to fulfilled in the store", async () => {
      const promise = createPaymentPromise({
        id: "promise-store-update",
        counterparty: "acme.com",
        financialValue: null,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date("2025-01-10"),
      });
      await store.insertCommitment(promise);

      const receipt = createPaymentReceiptMessage({
        messageId: "receipt-store",
        senderDomain: "acme.com",
        timestamp: new Date("2025-01-20"),
      });
      await store.insertMessage(receipt);

      await engine.trackPaymentPromises();

      // Verify the store was updated — the commitment should no longer be open
      const openCommitments = await store.getOpenCommitments();
      expect(openCommitments.some((c) => c.id === "promise-store-update")).toBe(false);
    });
  });

  describe("totals calculation", () => {
    it("should calculate correct totals across all categories", async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 3);

      // Open promise
      const openPromise = createPaymentPromise({
        id: "open-1",
        counterparty: "open.com",
        dueDate: futureDate,
        financialValue: 300,
      });

      // Overdue promise
      const overduePromise = createPaymentPromise({
        id: "overdue-1",
        counterparty: "overdue.com",
        dueDate: pastDate,
        financialValue: 750,
      });

      // Promise that will be fulfilled
      const fulfilledPromise = createPaymentPromise({
        id: "fulfilled-1",
        counterparty: "fulfilled.com",
        financialValue: 1200,
        dueDate: futureDate,
        createdAt: new Date("2025-01-01"),
      });

      await store.insertCommitment(openPromise);
      await store.insertCommitment(overduePromise);
      await store.insertCommitment(fulfilledPromise);

      // Insert receipt for the fulfilled promise
      const receipt = createPaymentReceiptMessage({
        messageId: "receipt-total",
        senderDomain: "fulfilled.com",
        timestamp: new Date("2025-01-20"),
      });
      await store.insertMessage(receipt);

      const result = await engine.trackPaymentPromises();

      expect(result.totalOpenAmount).toBe(300);
      expect(result.totalOverdueAmount).toBe(750);
      expect(result.totalFulfilledAmount).toBe(1200);
    });

    it("should handle promises with null financial values in totals", async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      const promise = createPaymentPromise({
        id: "null-amount",
        counterparty: "nullamount.com",
        dueDate: futureDate,
        financialValue: null,
      });
      await store.insertCommitment(promise);

      const result = await engine.trackPaymentPromises();

      expect(result.openPromises).toHaveLength(1);
      expect(result.totalOpenAmount).toBe(0);
    });
  });
});
