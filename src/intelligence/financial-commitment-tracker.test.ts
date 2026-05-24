/**
 * Tests for Financial Commitment Tracker and Contract Watch
 *
 * Requirements: 14.1, 14.2, 14.4, 14.5, 14.6, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IntelligenceEngine } from "./intelligence-engine";
import { SQLiteEntityStore } from "../store/entity-store";
import type { FinancialCommitment, FinancialObligation } from "../types/models";

describe("IntelligenceEngine - trackFinancialCommitments", () => {
  let store: SQLiteEntityStore;
  let engine: IntelligenceEngine;

  beforeEach(() => {
    store = new SQLiteEntityStore(":memory:");
    engine = new IntelligenceEngine(store);
  });

  it("should track both inbound and outbound commitments (Req 14.1)", async () => {
    const now = new Date();
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + 7);

    const inboundCommitment: FinancialCommitment = {
      id: "commit-1",
      messageId: "msg-1",
      threadId: "thread-1",
      type: "inbound",
      subtype: "payment_promise",
      description: "Client will pay invoice by Friday",
      owner: "client@example.com",
      counterparty: "user@example.com",
      financialValue: 500,
      currency: "USD",
      dueDate: futureDate,
      status: "open",
      isImplicit: false,
      confidence: 0.9,
      priority: 0,
      createdAt: now,
      updatedAt: now,
      fulfilledAt: null,
      lastFollowUpDate: null,
    };

    const outboundCommitment: FinancialCommitment = {
      id: "commit-2",
      messageId: "msg-2",
      threadId: "thread-2",
      type: "outbound",
      subtype: "general_financial",
      description: "I will send payment by Monday",
      owner: "user@example.com",
      counterparty: "vendor@example.com",
      financialValue: 200,
      currency: "USD",
      dueDate: futureDate,
      status: "open",
      isImplicit: false,
      confidence: 0.85,
      priority: 0,
      createdAt: now,
      updatedAt: now,
      fulfilledAt: null,
      lastFollowUpDate: null,
    };

    await store.insertCommitment(inboundCommitment);
    await store.insertCommitment(outboundCommitment);

    const result = await engine.trackFinancialCommitments();

    expect(result.inbound.length).toBe(1);
    expect(result.outbound.length).toBe(1);
    expect(result.inbound[0].type).toBe("inbound");
    expect(result.outbound[0].type).toBe("outbound");
  });

  it("should mark commitments as overdue after 14+ days past due date with no activity (Req 14.2)", async () => {
    const now = new Date();
    const pastDueDate = new Date(now);
    pastDueDate.setDate(pastDueDate.getDate() - 20); // 20 days ago

    const overdueCommitment: FinancialCommitment = {
      id: "commit-overdue",
      messageId: "msg-3",
      threadId: "thread-3",
      type: "inbound",
      subtype: "payment_promise",
      description: "Payment promised 20 days ago",
      owner: "debtor@example.com",
      counterparty: "user@example.com",
      financialValue: 1000,
      currency: "USD",
      dueDate: pastDueDate,
      status: "open",
      isImplicit: false,
      confidence: 0.95,
      priority: 0,
      createdAt: new Date(pastDueDate.getTime() - 7 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(pastDueDate.getTime() - 7 * 24 * 60 * 60 * 1000),
      fulfilledAt: null,
      lastFollowUpDate: null,
    };

    await store.insertCommitment(overdueCommitment);

    const result = await engine.trackFinancialCommitments();

    expect(result.overdue.length).toBe(1);
    expect(result.overdue[0].id).toBe("commit-overdue");
  });

  it("should NOT mark as overdue if there was recent activity within 14 days (Req 14.2)", async () => {
    const now = new Date();
    const pastDueDate = new Date(now);
    pastDueDate.setDate(pastDueDate.getDate() - 20); // 20 days past due

    const recentFollowUp = new Date(now);
    recentFollowUp.setDate(recentFollowUp.getDate() - 5); // Follow-up 5 days ago

    const commitmentWithActivity: FinancialCommitment = {
      id: "commit-active",
      messageId: "msg-4",
      threadId: "thread-4",
      type: "inbound",
      subtype: "payment_promise",
      description: "Payment with recent follow-up",
      owner: "debtor@example.com",
      counterparty: "user@example.com",
      financialValue: 750,
      currency: "USD",
      dueDate: pastDueDate,
      status: "open",
      isImplicit: false,
      confidence: 0.9,
      priority: 0,
      createdAt: new Date(pastDueDate.getTime() - 7 * 24 * 60 * 60 * 1000),
      updatedAt: now,
      fulfilledAt: null,
      lastFollowUpDate: recentFollowUp, // Recent activity
    };

    await store.insertCommitment(commitmentWithActivity);

    const result = await engine.trackFinancialCommitments();

    // Should NOT be overdue because there was recent activity
    expect(result.overdue.length).toBe(0);
    expect(result.openRankedByValue.length).toBe(1);
  });

  it("should rank open commitments by financial value (Req 14.4)", async () => {
    const now = new Date();
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + 7);

    const commitments: FinancialCommitment[] = [
      {
        id: "commit-low",
        messageId: "msg-5",
        threadId: "thread-5",
        type: "inbound",
        subtype: "payment_promise",
        description: "Small payment",
        owner: "a@example.com",
        counterparty: "user@example.com",
        financialValue: 50,
        currency: "USD",
        dueDate: futureDate,
        status: "open",
        isImplicit: false,
        confidence: 0.9,
        priority: 0,
        createdAt: now,
        updatedAt: now,
        fulfilledAt: null,
        lastFollowUpDate: null,
      },
      {
        id: "commit-high",
        messageId: "msg-6",
        threadId: "thread-6",
        type: "inbound",
        subtype: "payment_promise",
        description: "Large payment",
        owner: "b@example.com",
        counterparty: "user@example.com",
        financialValue: 5000,
        currency: "USD",
        dueDate: futureDate,
        status: "open",
        isImplicit: false,
        confidence: 0.9,
        priority: 0,
        createdAt: now,
        updatedAt: now,
        fulfilledAt: null,
        lastFollowUpDate: null,
      },
      {
        id: "commit-mid",
        messageId: "msg-7",
        threadId: "thread-7",
        type: "outbound",
        subtype: "general_financial",
        description: "Medium payment",
        owner: "user@example.com",
        counterparty: "c@example.com",
        financialValue: 500,
        currency: "USD",
        dueDate: futureDate,
        status: "open",
        isImplicit: false,
        confidence: 0.85,
        priority: 0,
        createdAt: now,
        updatedAt: now,
        fulfilledAt: null,
        lastFollowUpDate: null,
      },
    ];

    for (const c of commitments) {
      await store.insertCommitment(c);
    }

    const result = await engine.trackFinancialCommitments();

    // Should be ranked by financial value descending
    expect(result.openRankedByValue[0].financialValue).toBe(5000);
    expect(result.openRankedByValue[1].financialValue).toBe(500);
    expect(result.openRankedByValue[2].financialValue).toBe(50);
  });

  it("should feed refund_promise commitments into Refund Tracker (Req 14.6)", async () => {
    const now = new Date();
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + 7);

    const refundCommitment: FinancialCommitment = {
      id: "commit-refund",
      messageId: "msg-8",
      threadId: "thread-8",
      type: "inbound",
      subtype: "refund_promise",
      description: "Vendor promised refund",
      owner: "vendor@example.com",
      counterparty: "user@example.com",
      financialValue: 99.99,
      currency: "USD",
      dueDate: futureDate,
      status: "open",
      isImplicit: false,
      confidence: 0.95,
      priority: 0,
      createdAt: now,
      updatedAt: now,
      fulfilledAt: null,
      lastFollowUpDate: null,
    };

    const paymentCommitment: FinancialCommitment = {
      id: "commit-payment",
      messageId: "msg-9",
      threadId: "thread-9",
      type: "inbound",
      subtype: "payment_promise",
      description: "Client will pay",
      owner: "client@example.com",
      counterparty: "user@example.com",
      financialValue: 250,
      currency: "USD",
      dueDate: futureDate,
      status: "open",
      isImplicit: false,
      confidence: 0.9,
      priority: 0,
      createdAt: now,
      updatedAt: now,
      fulfilledAt: null,
      lastFollowUpDate: null,
    };

    await store.insertCommitment(refundCommitment);
    await store.insertCommitment(paymentCommitment);

    const result = await engine.trackFinancialCommitments();

    expect(result.refundCommitments.length).toBe(1);
    expect(result.refundCommitments[0].subtype).toBe("refund_promise");
    expect(result.paymentPromiseCommitments.length).toBe(1);
    expect(result.paymentPromiseCommitments[0].subtype).toBe("payment_promise");
  });

  it("should compute correct totals", async () => {
    const now = new Date();
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + 7);

    const commitments: FinancialCommitment[] = [
      {
        id: "c1",
        messageId: "m1",
        threadId: "t1",
        type: "inbound",
        subtype: "payment_promise",
        description: "Inbound 1",
        owner: "a@example.com",
        counterparty: "user@example.com",
        financialValue: 100,
        currency: "USD",
        dueDate: futureDate,
        status: "open",
        isImplicit: false,
        confidence: 0.9,
        priority: 0,
        createdAt: now,
        updatedAt: now,
        fulfilledAt: null,
        lastFollowUpDate: null,
      },
      {
        id: "c2",
        messageId: "m2",
        threadId: "t2",
        type: "outbound",
        subtype: "general_financial",
        description: "Outbound 1",
        owner: "user@example.com",
        counterparty: "b@example.com",
        financialValue: 200,
        currency: "USD",
        dueDate: futureDate,
        status: "open",
        isImplicit: false,
        confidence: 0.85,
        priority: 0,
        createdAt: now,
        updatedAt: now,
        fulfilledAt: null,
        lastFollowUpDate: null,
      },
    ];

    for (const c of commitments) {
      await store.insertCommitment(c);
    }

    const result = await engine.trackFinancialCommitments();

    expect(result.totals.totalInbound).toBe(1);
    expect(result.totals.totalOutbound).toBe(1);
    expect(result.totals.totalOpen).toBe(2);
    expect(result.totals.totalOverdue).toBe(0);
    expect(result.totals.totalInboundValue).toBe(100);
    expect(result.totals.totalOutboundValue).toBe(200);
  });
});

describe("IntelligenceEngine - watchObligations", () => {
  let store: SQLiteEntityStore;
  let engine: IntelligenceEngine;

  beforeEach(() => {
    store = new SQLiteEntityStore(":memory:");
    engine = new IntelligenceEngine(store);
  });

  it("should flag contracts with auto-renewal clause (Req 15.2)", async () => {
    const now = new Date();
    const renewalDate = new Date(now);
    renewalDate.setDate(renewalDate.getDate() + 60);

    const obligation: FinancialObligation = {
      id: "obl-1",
      contractName: "SaaS Agreement",
      contractType: "subscription_tos",
      parties: ["User", "Vendor Corp"],
      totalValue: 1200,
      currency: "USD",
      recurringAmount: 100,
      paymentFrequency: "monthly",
      keyDates: [
        {
          id: "kd-1",
          date: renewalDate,
          type: "renewal",
          description: "Annual renewal",
          financialConsequence: "Auto-renews for another year",
          amount: 1200,
          leadTimeAlerts: [30, 7],
          acknowledged: false,
        },
      ],
      penaltyClauses: [],
      autoRenews: true,
      noticeWindowDays: 30,
      financialExposure: 1200,
      riskFlags: [],
      sourceMessageIds: ["msg-1"],
      createdAt: now,
      updatedAt: now,
    };

    await store.upsertObligation(obligation);

    const result = await engine.watchObligations();

    const autoRenewalFlags = result.riskFlags.filter((f) => f.flag === "auto_renewal");
    expect(autoRenewalFlags.length).toBe(1);
    expect(autoRenewalFlags[0].contractName).toBe("SaaS Agreement");
  });

  it("should flag contracts with price escalation clause (Req 15.3)", async () => {
    const now = new Date();
    const rateChangeDate = new Date(now);
    rateChangeDate.setDate(rateChangeDate.getDate() + 90);

    const obligation: FinancialObligation = {
      id: "obl-2",
      contractName: "Office Lease",
      contractType: "lease",
      parties: ["User", "Landlord LLC"],
      totalValue: 24000,
      currency: "USD",
      recurringAmount: 2000,
      paymentFrequency: "monthly",
      keyDates: [
        {
          id: "kd-2",
          date: rateChangeDate,
          type: "rate_change",
          description: "Annual rent increase of 3%",
          financialConsequence: "Rent increases by 3%",
          amount: 60,
          leadTimeAlerts: [30],
          acknowledged: false,
        },
      ],
      penaltyClauses: [],
      autoRenews: false,
      noticeWindowDays: null,
      financialExposure: 24000,
      riskFlags: [],
      sourceMessageIds: ["msg-2"],
      createdAt: now,
      updatedAt: now,
    };

    await store.upsertObligation(obligation);

    const result = await engine.watchObligations();

    const priceEscalationFlags = result.riskFlags.filter((f) => f.flag === "price_escalation");
    expect(priceEscalationFlags.length).toBe(1);
    expect(priceEscalationFlags[0].contractName).toBe("Office Lease");
  });

  it("should flag contracts with penalty clauses and extract trigger + amount (Req 15.4)", async () => {
    const now = new Date();

    const obligation: FinancialObligation = {
      id: "obl-3",
      contractName: "Service Contract",
      contractType: "service_agreement",
      parties: ["User", "Service Provider"],
      totalValue: 5000,
      currency: "USD",
      recurringAmount: null,
      paymentFrequency: null,
      keyDates: [],
      penaltyClauses: [
        {
          description: "Early termination fee",
          triggerCondition: "Cancellation before contract end date",
          penaltyAmount: 1500,
          penaltyType: "fixed",
        },
      ],
      autoRenews: false,
      noticeWindowDays: null,
      financialExposure: 5000,
      riskFlags: [],
      sourceMessageIds: ["msg-3"],
      createdAt: now,
      updatedAt: now,
    };

    await store.upsertObligation(obligation);

    const result = await engine.watchObligations();

    const penaltyFlags = result.riskFlags.filter((f) => f.flag === "penalty_clause");
    expect(penaltyFlags.length).toBe(1);
    expect(penaltyFlags[0].triggerCondition).toBe("Cancellation before contract end date");
    expect(penaltyFlags[0].penaltyAmount).toBe(1500);
  });

  it("should flag contracts where notice window deadline has passed (Req 15.5)", async () => {
    const now = new Date();
    // Renewal in 10 days, but notice window is 30 days — so notice deadline already passed
    const renewalDate = new Date(now);
    renewalDate.setDate(renewalDate.getDate() + 10);

    const obligation: FinancialObligation = {
      id: "obl-4",
      contractName: "Gym Membership",
      contractType: "service_agreement",
      parties: ["User", "Gym Corp"],
      totalValue: 600,
      currency: "USD",
      recurringAmount: 50,
      paymentFrequency: "monthly",
      keyDates: [
        {
          id: "kd-4",
          date: renewalDate,
          type: "renewal",
          description: "Annual renewal",
          financialConsequence: "Auto-renews for another year",
          amount: 600,
          leadTimeAlerts: [30, 7],
          acknowledged: false,
        },
      ],
      penaltyClauses: [],
      autoRenews: true,
      noticeWindowDays: 30, // Notice window is 30 days, but renewal is in 10 days
      financialExposure: 600,
      riskFlags: [],
      sourceMessageIds: ["msg-4"],
      createdAt: now,
      updatedAt: now,
    };

    await store.upsertObligation(obligation);

    const result = await engine.watchObligations();

    const missedNoticeFlags = result.riskFlags.filter((f) => f.flag === "missed_notice_window");
    expect(missedNoticeFlags.length).toBe(1);
    expect(missedNoticeFlags[0].contractName).toBe("Gym Membership");
  });

  it("should compute total financial exposure across all active obligations (Req 15.6)", async () => {
    const now = new Date();

    const obligations: FinancialObligation[] = [
      {
        id: "obl-5",
        contractName: "Contract A",
        contractType: "subscription_tos",
        parties: ["User", "Vendor A"],
        totalValue: 1000,
        currency: "USD",
        recurringAmount: null,
        paymentFrequency: null,
        keyDates: [],
        penaltyClauses: [],
        autoRenews: false,
        noticeWindowDays: null,
        financialExposure: 1000,
        riskFlags: [],
        sourceMessageIds: ["msg-5"],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "obl-6",
        contractName: "Contract B",
        contractType: "lease",
        parties: ["User", "Vendor B"],
        totalValue: 3000,
        currency: "USD",
        recurringAmount: 250,
        paymentFrequency: "monthly",
        keyDates: [],
        penaltyClauses: [],
        autoRenews: false,
        noticeWindowDays: null,
        financialExposure: 3000,
        riskFlags: [],
        sourceMessageIds: ["msg-6"],
        createdAt: now,
        updatedAt: now,
      },
    ];

    for (const o of obligations) {
      await store.upsertObligation(o);
    }

    const result = await engine.watchObligations();

    expect(result.totalFinancialExposure).toBe(4000);
  });

  it("should flag silent renewal when auto-renews with no notice window", async () => {
    const now = new Date();

    const obligation: FinancialObligation = {
      id: "obl-7",
      contractName: "Silent Renewal Contract",
      contractType: "subscription_tos",
      parties: ["User", "Sneaky Corp"],
      totalValue: 500,
      currency: "USD",
      recurringAmount: 50,
      paymentFrequency: "monthly",
      keyDates: [],
      penaltyClauses: [],
      autoRenews: true,
      noticeWindowDays: null, // No notice window defined
      financialExposure: 500,
      riskFlags: [],
      sourceMessageIds: ["msg-7"],
      createdAt: now,
      updatedAt: now,
    };

    await store.upsertObligation(obligation);

    const result = await engine.watchObligations();

    const silentRenewalFlags = result.riskFlags.filter((f) => f.flag === "silent_renewal");
    expect(silentRenewalFlags.length).toBe(1);
    expect(silentRenewalFlags[0].contractName).toBe("Silent Renewal Contract");
  });

  it("should flag high financial exposure (>$5000)", async () => {
    const now = new Date();

    const obligation: FinancialObligation = {
      id: "obl-8",
      contractName: "Expensive Lease",
      contractType: "lease",
      parties: ["User", "Property Corp"],
      totalValue: 60000,
      currency: "USD",
      recurringAmount: 5000,
      paymentFrequency: "monthly",
      keyDates: [],
      penaltyClauses: [],
      autoRenews: false,
      noticeWindowDays: null,
      financialExposure: 60000,
      riskFlags: [],
      sourceMessageIds: ["msg-8"],
      createdAt: now,
      updatedAt: now,
    };

    await store.upsertObligation(obligation);

    const result = await engine.watchObligations();

    const highExposureFlags = result.riskFlags.filter((f) => f.flag === "high_financial_exposure");
    expect(highExposureFlags.length).toBe(1);
    expect(highExposureFlags[0].financialImpact).toBe(60000);
  });

  it("should classify obligations with 2+ risk flags as high risk", async () => {
    const now = new Date();
    const renewalDate = new Date(now);
    renewalDate.setDate(renewalDate.getDate() + 5); // Renewal in 5 days

    const obligation: FinancialObligation = {
      id: "obl-9",
      contractName: "Risky Contract",
      contractType: "service_agreement",
      parties: ["User", "Risky Corp"],
      totalValue: 10000,
      currency: "USD",
      recurringAmount: 1000,
      paymentFrequency: "monthly",
      keyDates: [
        {
          id: "kd-9",
          date: renewalDate,
          type: "renewal",
          description: "Annual renewal",
          financialConsequence: null,
          amount: 10000,
          leadTimeAlerts: [30],
          acknowledged: false,
        },
      ],
      penaltyClauses: [
        {
          description: "Early termination",
          triggerCondition: "Cancel before end",
          penaltyAmount: 2000,
          penaltyType: "fixed",
        },
      ],
      autoRenews: true,
      noticeWindowDays: 30, // Notice window already passed (renewal in 5 days)
      financialExposure: 10000,
      riskFlags: [],
      sourceMessageIds: ["msg-9"],
      createdAt: now,
      updatedAt: now,
    };

    await store.upsertObligation(obligation);

    const result = await engine.watchObligations();

    expect(result.highRiskObligations.length).toBe(1);
    expect(result.highRiskObligations[0].id).toBe("obl-9");
    // Should have multiple risk flags
    expect(result.riskFlags.filter((f) => f.obligationId === "obl-9").length).toBeGreaterThanOrEqual(2);
  });

  it("should return correct summary counts", async () => {
    const now = new Date();

    const obligation: FinancialObligation = {
      id: "obl-10",
      contractName: "Test Contract",
      contractType: "subscription_tos",
      parties: ["User", "Vendor"],
      totalValue: 1200,
      currency: "USD",
      recurringAmount: 100,
      paymentFrequency: "monthly",
      keyDates: [],
      penaltyClauses: [
        {
          description: "Late fee",
          triggerCondition: "Late payment",
          penaltyAmount: 50,
          penaltyType: "fixed",
        },
      ],
      autoRenews: true,
      noticeWindowDays: null,
      financialExposure: 1200,
      riskFlags: [],
      sourceMessageIds: ["msg-10"],
      createdAt: now,
      updatedAt: now,
    };

    await store.upsertObligation(obligation);

    const result = await engine.watchObligations();

    expect(result.summary.totalObligations).toBe(1);
    expect(result.summary.obligationsWithAutoRenewal).toBe(1);
    expect(result.summary.obligationsWithPenalties).toBe(1);
    expect(result.summary.totalRiskFlags).toBeGreaterThan(0);
  });
});
