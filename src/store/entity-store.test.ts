import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SQLiteEntityStore } from "./entity-store";
import type { SubscriptionRecord, TrialRecord, RefundRecord, FinancialCommitment, FinancialObligation, PaymentRecord } from "../types/models";
import type { AnalyzedMessage } from "../types/signals";

describe("SQLiteEntityStore", () => {
  let store: SQLiteEntityStore;

  beforeEach(() => {
    store = new SQLiteEntityStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  // ─── Message Tests ─────────────────────────────────────────────────────

  describe("messages", () => {
    it("should insert and retrieve a message", async () => {
      const msg: AnalyzedMessage = {
        messageId: "msg-1",
        threadId: "thread-1",
        timestamp: new Date("2024-01-15T10:00:00Z"),
        sender: "billing@spotify.com",
        senderDomain: "spotify.com",
        classifications: ["subscription_receipt"],
        subscriptionSignal: {
          vendor: "Spotify",
          vendorDomain: "spotify.com",
          amount: 9.99,
          currency: "USD",
          billingFrequency: "monthly",
          category: "music-streaming",
          renewalDate: new Date("2024-02-15"),
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
        urgencyScore: 2,
        summary: "Spotify monthly receipt",
      };

      await store.insertMessage(msg);
      const retrieved = await store.getMessage("msg-1");

      expect(retrieved).not.toBeNull();
      expect(retrieved!.messageId).toBe("msg-1");
      expect(retrieved!.sender).toBe("billing@spotify.com");
      expect(retrieved!.subscriptionSignal?.vendor).toBe("Spotify");
      expect(retrieved!.subscriptionSignal?.amount).toBe(9.99);
    });

    it("should query messages by filter", async () => {
      const msg1: AnalyzedMessage = {
        messageId: "msg-1",
        threadId: "thread-1",
        timestamp: new Date("2024-01-15T10:00:00Z"),
        sender: "billing@spotify.com",
        senderDomain: "spotify.com",
        classifications: ["subscription_receipt"],
        subscriptionSignal: null,
        commitmentSignals: [],
        contractSignal: null,
        refundSignal: null,
        trialSignal: null,
        financialEntities: [],
        usageIndicators: [],
        urgencyScore: 2,
        summary: "Spotify receipt",
      };

      const msg2: AnalyzedMessage = {
        messageId: "msg-2",
        threadId: "thread-2",
        timestamp: new Date("2024-02-15T10:00:00Z"),
        sender: "billing@netflix.com",
        senderDomain: "netflix.com",
        classifications: ["renewal_notice"],
        subscriptionSignal: null,
        commitmentSignals: [],
        contractSignal: null,
        refundSignal: null,
        trialSignal: null,
        financialEntities: [],
        usageIndicators: [],
        urgencyScore: 5,
        summary: "Netflix renewal",
      };

      await store.insertMessage(msg1);
      await store.insertMessage(msg2);

      const byDomain = await store.queryMessages({ senderDomain: "spotify.com" });
      expect(byDomain).toHaveLength(1);
      expect(byDomain[0].messageId).toBe("msg-1");

      const byDate = await store.queryMessages({ since: new Date("2024-02-01") });
      expect(byDate).toHaveLength(1);
      expect(byDate[0].messageId).toBe("msg-2");
    });
  });

  // ─── Subscription Tests ────────────────────────────────────────────────

  describe("subscriptions", () => {
    const makeSub = (overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
      id: "sub-1",
      vendor: "Spotify",
      vendorDomain: "spotify.com",
      amount: 9.99,
      currency: "USD",
      billingFrequency: "monthly",
      category: "music-streaming",
      status: "active-used",
      usageScore: 8,
      wasteScore: 1,
      firstSeenDate: new Date("2023-01-01"),
      lastPaymentDate: new Date("2024-01-15"),
      nextRenewalDate: new Date("2024-02-15"),
      autoRenews: true,
      trialEndsDate: null,
      annualPlanAvailable: false,
      annualPlanAmount: null,
      annualSavingsIfSwitched: null,
      priceChangeHistory: [],
      sourceMessageIds: ["msg-1"],
      createdAt: new Date("2023-01-01"),
      updatedAt: new Date("2024-01-15"),
      ...overrides,
    });

    it("should insert and retrieve a subscription", async () => {
      await store.upsertSubscription(makeSub());
      const subs = await store.getSubscriptions();
      expect(subs).toHaveLength(1);
      expect(subs[0].vendor).toBe("Spotify");
      expect(subs[0].amount).toBe(9.99);
    });

    it("should deduplicate subscriptions by vendorDomain", async () => {
      await store.upsertSubscription(makeSub({ amount: 9.99 }));
      await store.upsertSubscription(makeSub({ id: "sub-2", amount: 11.99 }));

      const subs = await store.getSubscriptions();
      expect(subs).toHaveLength(1);
      expect(subs[0].amount).toBe(11.99); // Updated to new amount
    });

    it("should get active subscriptions", async () => {
      await store.upsertSubscription(makeSub({ status: "active-used" }));
      await store.upsertSubscription(makeSub({
        id: "sub-2",
        vendor: "Netflix",
        vendorDomain: "netflix.com",
        status: "cancelled",
      }));

      const active = await store.getActiveSubscriptions();
      expect(active).toHaveLength(1);
      expect(active[0].vendor).toBe("Spotify");
    });

    it("should get zombie subscriptions", async () => {
      await store.upsertSubscription(makeSub({ status: "zombie", usageScore: 0 }));
      await store.upsertSubscription(makeSub({
        id: "sub-2",
        vendor: "Netflix",
        vendorDomain: "netflix.com",
        status: "active-used",
      }));

      const zombies = await store.getZombieSubscriptions();
      expect(zombies).toHaveLength(1);
      expect(zombies[0].vendor).toBe("Spotify");
    });

    it("should filter subscriptions by category", async () => {
      await store.upsertSubscription(makeSub({ category: "music-streaming" }));
      await store.upsertSubscription(makeSub({
        id: "sub-2",
        vendor: "Netflix",
        vendorDomain: "netflix.com",
        category: "video-streaming",
      }));

      const music = await store.getSubscriptionsByCategory("music-streaming");
      expect(music).toHaveLength(1);
      expect(music[0].vendor).toBe("Spotify");
    });
  });

  // ─── Trial Tests ───────────────────────────────────────────────────────

  describe("trials", () => {
    const makeTrial = (overrides: Partial<TrialRecord> = {}): TrialRecord => ({
      id: "trial-1",
      vendor: "Figma",
      vendorDomain: "figma.com",
      category: "productivity",
      trialStartDate: new Date("2024-01-01"),
      trialEndDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
      daysRemaining: 3,
      convertsToAmount: 15,
      convertsToFrequency: "monthly",
      autoConverts: true,
      cancellationUrl: "https://figma.com/cancel",
      status: "active",
      reminderScheduled: false,
      sourceMessageId: "msg-trial-1",
      ...overrides,
    });

    it("should insert and retrieve active trials", async () => {
      await store.insertTrial(makeTrial());
      const trials = await store.getActiveTrials();
      expect(trials).toHaveLength(1);
      expect(trials[0].vendor).toBe("Figma");
      expect(trials[0].autoConverts).toBe(true);
    });

    it("should get expiring trials within days ahead", async () => {
      await store.insertTrial(makeTrial({ daysRemaining: 3 }));
      await store.insertTrial(makeTrial({
        id: "trial-2",
        vendor: "Notion",
        vendorDomain: "notion.so",
        trialEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        daysRemaining: 30,
      }));

      const expiring = await store.getExpiringTrials(7);
      expect(expiring).toHaveLength(1);
      expect(expiring[0].vendor).toBe("Figma");
    });
  });

  // ─── Refund Tests ──────────────────────────────────────────────────────

  describe("refunds", () => {
    const makeRefund = (overrides: Partial<RefundRecord> = {}): RefundRecord => ({
      id: "refund-1",
      vendor: "Adobe",
      amount: 49.99,
      currency: "USD",
      promisedDate: new Date("2024-01-10"),
      expectedByDate: new Date("2024-01-24"),
      actualReceivedDate: null,
      status: "promised",
      daysOverdue: 0,
      originalTransactionDate: new Date("2024-01-01"),
      reason: "Cancelled subscription",
      sourceMessageIds: ["msg-refund-1"],
      lastFollowUpDate: null,
      ...overrides,
    });

    it("should insert and get pending refunds", async () => {
      await store.insertRefund(makeRefund());
      const pending = await store.getPendingRefunds();
      expect(pending).toHaveLength(1);
      expect(pending[0].vendor).toBe("Adobe");
      expect(pending[0].amount).toBe(49.99);
    });

    it("should get overdue refunds", async () => {
      await store.insertRefund(makeRefund({ status: "overdue", daysOverdue: 5 }));
      const overdue = await store.getOverdueRefunds();
      expect(overdue).toHaveLength(1);
      expect(overdue[0].daysOverdue).toBe(5);
    });

    it("should mark refund as received", async () => {
      await store.insertRefund(makeRefund());
      await store.markRefundReceived("refund-1");

      const pending = await store.getPendingRefunds();
      expect(pending).toHaveLength(0);
    });
  });

  // ─── Commitment Tests ──────────────────────────────────────────────────

  describe("commitments", () => {
    const makeCommitment = (overrides: Partial<FinancialCommitment> = {}): FinancialCommitment => ({
      id: "commit-1",
      messageId: "msg-commit-1",
      threadId: "thread-commit-1",
      type: "inbound",
      subtype: "payment_promise",
      description: "Client will pay invoice by Friday",
      owner: "client@example.com",
      counterparty: "me@example.com",
      financialValue: 2500,
      currency: "USD",
      dueDate: new Date("2024-01-20"),
      status: "open",
      isImplicit: false,
      confidence: 0.9,
      priority: 8,
      createdAt: new Date("2024-01-15"),
      updatedAt: new Date("2024-01-15"),
      fulfilledAt: null,
      lastFollowUpDate: null,
      ...overrides,
    });

    it("should insert and get open commitments", async () => {
      await store.insertCommitment(makeCommitment());
      const open = await store.getOpenCommitments();
      expect(open).toHaveLength(1);
      expect(open[0].description).toBe("Client will pay invoice by Friday");
    });

    it("should update commitment status", async () => {
      await store.insertCommitment(makeCommitment());
      await store.updateCommitmentStatus("commit-1", "fulfilled");

      const open = await store.getOpenCommitments();
      expect(open).toHaveLength(0);
    });

    it("should get overdue commitments", async () => {
      await store.insertCommitment(makeCommitment({ status: "overdue" }));
      const overdue = await store.getOverdueCommitments();
      expect(overdue).toHaveLength(1);
    });

    it("should get payment promises", async () => {
      await store.insertCommitment(makeCommitment({ subtype: "payment_promise" }));
      await store.insertCommitment(makeCommitment({
        id: "commit-2",
        messageId: "msg-2",
        subtype: "general_financial",
      }));

      const promises = await store.getPaymentPromises();
      expect(promises).toHaveLength(1);
      expect(promises[0].subtype).toBe("payment_promise");
    });
  });

  // ─── Obligation Tests ──────────────────────────────────────────────────

  describe("obligations", () => {
    const makeObligation = (overrides: Partial<FinancialObligation> = {}): FinancialObligation => ({
      id: "obl-1",
      contractName: "Office Lease",
      contractType: "lease",
      parties: ["Landlord Corp", "Me"],
      totalValue: 24000,
      currency: "USD",
      recurringAmount: 2000,
      paymentFrequency: "monthly",
      keyDates: [
        {
          id: "deadline-1",
          date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
          type: "payment_due",
          description: "Monthly rent due",
          financialConsequence: "Late fee of $50",
          amount: 2000,
          leadTimeAlerts: [7, 3, 1],
          acknowledged: false,
        },
      ],
      penaltyClauses: [
        {
          description: "Late payment penalty",
          triggerCondition: "Payment not received by 5th of month",
          penaltyAmount: 50,
          penaltyType: "fixed",
        },
      ],
      autoRenews: true,
      noticeWindowDays: 60,
      financialExposure: 24000,
      riskFlags: ["auto_renewal", "penalty_clause"],
      sourceMessageIds: ["msg-obl-1"],
      createdAt: new Date("2023-06-01"),
      updatedAt: new Date("2024-01-01"),
      ...overrides,
    });

    it("should upsert and retrieve obligations", async () => {
      await store.upsertObligation(makeObligation());
      const obligations = await store.getObligations();
      expect(obligations).toHaveLength(1);
      expect(obligations[0].contractName).toBe("Office Lease");
      expect(obligations[0].riskFlags).toContain("auto_renewal");
    });

    it("should filter obligations by contract type", async () => {
      await store.upsertObligation(makeObligation());
      await store.upsertObligation(makeObligation({
        id: "obl-2",
        contractName: "SaaS Agreement",
        contractType: "service_agreement",
      }));

      const leases = await store.getObligations({ contractType: "lease" });
      expect(leases).toHaveLength(1);
      expect(leases[0].contractName).toBe("Office Lease");
    });

    it("should get upcoming deadlines", async () => {
      await store.upsertObligation(makeObligation());
      const deadlines = await store.getUpcomingDeadlines(14);
      expect(deadlines).toHaveLength(1);
      expect(deadlines[0].type).toBe("payment_due");
    });
  });

  // ─── Payment Tests ─────────────────────────────────────────────────────

  describe("payments", () => {
    const makePayment = (overrides: Partial<PaymentRecord> = {}): PaymentRecord => ({
      id: "pay-1",
      vendor: "Spotify",
      amount: 9.99,
      currency: "USD",
      category: "music-streaming",
      date: new Date("2024-01-15"),
      type: "subscription",
      sourceMessageId: "msg-pay-1",
      ...overrides,
    });

    it("should insert and get payment history", async () => {
      await store.insertPayment(makePayment());
      await store.insertPayment(makePayment({
        id: "pay-2",
        date: new Date("2024-02-15"),
      }));

      const history = await store.getPaymentHistory({
        start: new Date("2024-01-01"),
        end: new Date("2024-03-01"),
      });
      expect(history).toHaveLength(2);
    });

    it("should get subscription history by vendor", async () => {
      await store.insertPayment(makePayment());
      await store.insertPayment(makePayment({
        id: "pay-2",
        vendor: "Netflix",
        date: new Date("2024-02-15"),
      }));

      const history = await store.getSubscriptionHistory("Spotify");
      expect(history).toHaveLength(1);
      expect(history[0].vendor).toBe("Spotify");
    });

    it("should compute monthly spend summary", async () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 10);

      await store.insertPayment(makePayment({ date: thisMonth, amount: 9.99 }));
      await store.insertPayment(makePayment({
        id: "pay-2",
        vendor: "Netflix",
        category: "video-streaming",
        date: thisMonth,
        amount: 15.49,
      }));

      const summary = await store.getMonthlySpendSummary(1);
      expect(summary).toHaveLength(1);
      expect(summary[0].totalAmount).toBeCloseTo(25.48, 1);
    });

    it("should compute spend by category", async () => {
      await store.insertPayment(makePayment({ amount: 9.99 }));
      await store.insertPayment(makePayment({
        id: "pay-2",
        vendor: "Netflix",
        category: "video-streaming",
        amount: 15.49,
      }));

      const byCategory = await store.getSpendByCategory({
        start: new Date("2024-01-01"),
        end: new Date("2024-12-31"),
      });

      expect(byCategory).toHaveLength(2);
      // Sorted by amount descending
      expect(byCategory[0].category).toBe("video-streaming");
      expect(byCategory[0].totalAmount).toBe(15.49);
    });
  });

  // ─── Cross-Cutting Query Tests ─────────────────────────────────────────

  describe("cross-cutting queries", () => {
    it("should build a financial calendar", async () => {
      const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

      await store.upsertSubscription({
        id: "sub-1",
        vendor: "Spotify",
        vendorDomain: "spotify.com",
        amount: 9.99,
        currency: "USD",
        billingFrequency: "monthly",
        category: "music-streaming",
        status: "active-used",
        usageScore: 8,
        wasteScore: 1,
        firstSeenDate: new Date("2023-01-01"),
        lastPaymentDate: new Date("2024-01-15"),
        nextRenewalDate: futureDate,
        autoRenews: true,
        trialEndsDate: null,
        annualPlanAvailable: false,
        annualPlanAmount: null,
        annualSavingsIfSwitched: null,
        priceChangeHistory: [],
        sourceMessageIds: ["msg-1"],
        createdAt: new Date("2023-01-01"),
        updatedAt: new Date("2024-01-15"),
      });

      const calendar = await store.getFinancialCalendar({
        start: new Date(),
        end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      expect(calendar.length).toBeGreaterThanOrEqual(1);
      expect(calendar[0].type).toBe("renewal");
      expect(calendar[0].vendor).toBe("Spotify");
    });

    it("should search by vendor", async () => {
      await store.upsertSubscription({
        id: "sub-1",
        vendor: "Spotify",
        vendorDomain: "spotify.com",
        amount: 9.99,
        currency: "USD",
        billingFrequency: "monthly",
        category: "music-streaming",
        status: "active-used",
        usageScore: 8,
        wasteScore: 1,
        firstSeenDate: new Date("2023-01-01"),
        lastPaymentDate: new Date("2024-01-15"),
        nextRenewalDate: new Date("2024-02-15"),
        autoRenews: true,
        trialEndsDate: null,
        annualPlanAvailable: false,
        annualPlanAmount: null,
        annualSavingsIfSwitched: null,
        priceChangeHistory: [],
        sourceMessageIds: ["msg-1"],
        createdAt: new Date("2023-01-01"),
        updatedAt: new Date("2024-01-15"),
      });

      await store.insertPayment({
        id: "pay-1",
        vendor: "Spotify",
        amount: 9.99,
        currency: "USD",
        category: "music-streaming",
        date: new Date("2024-01-15"),
        type: "subscription",
        sourceMessageId: "msg-1",
      });

      const profile = await store.searchByVendor("Spotify");
      expect(profile.vendor).toBe("Spotify");
      expect(profile.subscriptions).toHaveLength(1);
      expect(profile.payments).toHaveLength(1);
      expect(profile.totalSpent).toBe(9.99);
    });
  });
});
