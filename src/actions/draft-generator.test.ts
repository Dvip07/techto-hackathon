/**
 * Unit tests for Draft Generator.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6
 */

import { describe, it, expect, beforeEach } from "vitest";
import { DraftGenerator } from "./draft-generator";
import type { FinancialCommitment, RefundRecord, SubscriptionRecord, TrialRecord } from "../types/models";

describe("DraftGenerator", () => {
  let generator: DraftGenerator;

  beforeEach(() => {
    generator = new DraftGenerator();
  });

  // ─── Test Fixtures ───────────────────────────────────────────────────────

  const mockSubscription: SubscriptionRecord = {
    id: "sub-123",
    vendor: "Netflix",
    vendorDomain: "netflix.com",
    amount: 15.99,
    currency: "USD",
    billingFrequency: "monthly",
    category: "video-streaming",
    status: "active-used",
    usageScore: 5,
    wasteScore: 2,
    firstSeenDate: new Date("2023-01-15"),
    lastPaymentDate: new Date("2024-11-01"),
    nextRenewalDate: new Date("2024-12-01"),
    autoRenews: true,
    trialEndsDate: null,
    annualPlanAvailable: true,
    annualPlanAmount: 149.99,
    annualSavingsIfSwitched: 41.89,
    priceChangeHistory: [
      {
        previousAmount: 13.99,
        newAmount: 15.99,
        detectedDate: new Date("2024-06-01"),
        percentageChange: 14.3,
        sourceMessageId: "msg-456",
      },
    ],
    sourceMessageIds: ["msg-001"],
    createdAt: new Date("2023-01-15"),
    updatedAt: new Date("2024-11-01"),
  };

  const mockTrial: TrialRecord = {
    id: "trial-456",
    vendor: "Notion",
    vendorDomain: "notion.so",
    category: "productivity",
    trialStartDate: new Date("2024-11-01"),
    trialEndDate: new Date("2024-11-15"),
    daysRemaining: 3,
    convertsToAmount: 10.0,
    convertsToFrequency: "monthly",
    autoConverts: true,
    cancellationUrl: "https://notion.so/settings/billing/cancel",
    status: "expiring_soon",
    reminderScheduled: false,
    sourceMessageId: "msg-789",
  };

  const mockRefund: RefundRecord = {
    id: "refund-789",
    vendor: "Adobe",
    amount: 54.99,
    currency: "USD",
    promisedDate: new Date("2024-10-15"),
    expectedByDate: new Date("2024-10-29"),
    actualReceivedDate: null,
    status: "overdue",
    daysOverdue: 14,
    originalTransactionDate: new Date("2024-09-15"),
    reason: "Duplicate charge",
    sourceMessageIds: ["msg-101"],
    lastFollowUpDate: null,
  };

  const mockCommitment: FinancialCommitment = {
    id: "commit-101",
    messageId: "msg-201",
    threadId: "thread-201",
    type: "inbound",
    subtype: "payment_promise",
    description: "Payment for freelance design work",
    owner: "Client Corp",
    counterparty: "Client Corp",
    financialValue: 2500.0,
    currency: "USD",
    dueDate: new Date("2024-10-30"),
    status: "overdue",
    isImplicit: false,
    confidence: 0.95,
    priority: 8,
    createdAt: new Date("2024-10-01"),
    updatedAt: new Date("2024-11-05"),
    fulfilledAt: null,
    lastFollowUpDate: null,
  };

  // ─── Cancellation Draft Tests ────────────────────────────────────────────

  describe("generateCancellationDraft", () => {
    it("should generate a draft addressed to the subscription vendor", async () => {
      const draft = await generator.generateCancellationDraft(mockSubscription);

      expect(draft.to).toBe("support@netflix.com");
      expect(draft.subject).toContain("Netflix");
      expect(draft.subject).toContain("Cancellation");
      expect(draft.body).toContain("Netflix");
      expect(draft.body).toContain("$15.99");
      expect(draft.body).toContain("monthly");
    });

    it("should set type to cancellation", async () => {
      const draft = await generator.generateCancellationDraft(mockSubscription);
      expect(draft.type).toBe("cancellation");
    });

    it("should reference the subscription ID as targetId", async () => {
      const draft = await generator.generateCancellationDraft(mockSubscription);
      expect(draft.targetId).toBe("sub-123");
    });

    it("should require user approval", async () => {
      const draft = await generator.generateCancellationDraft(mockSubscription);
      expect(draft.requiresApproval).toBe(true);
    });

    it("should include a unique draft ID", async () => {
      const draft = await generator.generateCancellationDraft(mockSubscription);
      expect(draft.id).toMatch(/^draft-cancellation-sub-123-/);
    });

    it("should include createdAt timestamp", async () => {
      const draft = await generator.generateCancellationDraft(mockSubscription);
      expect(draft.createdAt).toBeInstanceOf(Date);
    });
  });

  // ─── Negotiation Draft Tests ─────────────────────────────────────────────

  describe("generateNegotiationDraft", () => {
    it("should incorporate the negotiation reason for price_increase", async () => {
      const draft = await generator.generateNegotiationDraft(mockSubscription, "price_increase");

      expect(draft.body).toContain("$13.99");
      expect(draft.body).toContain("$15.99");
      expect(draft.body).toContain("14.3%");
    });

    it("should include current amount", async () => {
      const draft = await generator.generateNegotiationDraft(mockSubscription, "price_increase");
      expect(draft.body).toContain("$15.99");
    });

    it("should include user tenure", async () => {
      const draft = await generator.generateNegotiationDraft(mockSubscription, "long_tenure_discount");
      // Tenure should be computed from firstSeenDate
      expect(draft.body).toMatch(/\d+ months/);
    });

    it("should include requested outcome", async () => {
      const draft = await generator.generateNegotiationDraft(mockSubscription, "price_increase");
      expect(draft.body).toContain("Requested outcome");
      expect(draft.body).toContain("$13.99");
    });

    it("should handle competitor_cheaper reason", async () => {
      const draft = await generator.generateNegotiationDraft(mockSubscription, "competitor_cheaper");
      expect(draft.body).toContain("comparable services");
      expect(draft.body).toContain("lower price");
    });

    it("should handle usage_low reason", async () => {
      const draft = await generator.generateNegotiationDraft(mockSubscription, "usage_low");
      expect(draft.body).toContain("usage");
      expect(draft.body).toContain("lower");
    });

    it("should set type to negotiation", async () => {
      const draft = await generator.generateNegotiationDraft(mockSubscription, "price_increase");
      expect(draft.type).toBe("negotiation");
    });

    it("should require user approval", async () => {
      const draft = await generator.generateNegotiationDraft(mockSubscription, "price_increase");
      expect(draft.requiresApproval).toBe(true);
    });
  });

  // ─── Refund Follow-Up Draft Tests ────────────────────────────────────────

  describe("generateRefundFollowUpDraft", () => {
    it("should reference the original promise date", async () => {
      const draft = await generator.generateRefundFollowUpDraft(mockRefund);
      // The date is formatted using toLocaleDateString, so check it contains the formatted promise date
      const formattedDate = mockRefund.promisedDate!.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      expect(draft.body).toContain(formattedDate);
    });

    it("should reference the refund amount", async () => {
      const draft = await generator.generateRefundFollowUpDraft(mockRefund);
      expect(draft.body).toContain("$54.99");
      expect(draft.subject).toContain("$54.99");
    });

    it("should include the vendor name", async () => {
      const draft = await generator.generateRefundFollowUpDraft(mockRefund);
      expect(draft.body).toContain("Adobe");
      expect(draft.subject).toContain("Adobe");
    });

    it("should include days overdue", async () => {
      const draft = await generator.generateRefundFollowUpDraft(mockRefund);
      expect(draft.body).toContain("14");
    });

    it("should handle refund with no promised date", async () => {
      const refundNoDate: RefundRecord = {
        ...mockRefund,
        promisedDate: null,
      };
      const draft = await generator.generateRefundFollowUpDraft(refundNoDate);
      expect(draft.body).toContain("previously");
      expect(draft.body).toContain("Not specified");
    });

    it("should set type to refund_follow_up", async () => {
      const draft = await generator.generateRefundFollowUpDraft(mockRefund);
      expect(draft.type).toBe("refund_follow_up");
    });

    it("should require user approval", async () => {
      const draft = await generator.generateRefundFollowUpDraft(mockRefund);
      expect(draft.requiresApproval).toBe(true);
    });
  });

  // ─── Trial Cancellation Draft Tests ──────────────────────────────────────

  describe("generateTrialCancellationDraft", () => {
    it("should include cancellation URL when available", async () => {
      const draft = await generator.generateTrialCancellationDraft(mockTrial);
      expect(draft.body).toContain("https://notion.so/settings/billing/cancel");
    });

    it("should handle trial without cancellation URL", async () => {
      const trialNoUrl: TrialRecord = {
        ...mockTrial,
        cancellationUrl: null,
      };
      const draft = await generator.generateTrialCancellationDraft(trialNoUrl);
      expect(draft.body).not.toContain("cancellation page at:");
      expect(draft.body).toContain("cancel my trial immediately");
    });

    it("should include conversion amount when available", async () => {
      const draft = await generator.generateTrialCancellationDraft(mockTrial);
      expect(draft.body).toContain("$10.00");
    });

    it("should be addressed to the vendor", async () => {
      const draft = await generator.generateTrialCancellationDraft(mockTrial);
      expect(draft.to).toBe("support@notion.so");
    });

    it("should set type to trial_cancellation", async () => {
      const draft = await generator.generateTrialCancellationDraft(mockTrial);
      expect(draft.type).toBe("trial_cancellation");
    });

    it("should require user approval", async () => {
      const draft = await generator.generateTrialCancellationDraft(mockTrial);
      expect(draft.requiresApproval).toBe(true);
    });
  });

  // ─── Payment Follow-Up Draft Tests ───────────────────────────────────────

  describe("generateFollowUpDraft", () => {
    it("should reference the original payment promise", async () => {
      const draft = await generator.generateFollowUpDraft(mockCommitment);
      expect(draft.body).toContain("Payment for freelance design work");
    });

    it("should reference the due date", async () => {
      const draft = await generator.generateFollowUpDraft(mockCommitment);
      // The date is formatted using toLocaleDateString, so check it contains the formatted due date
      const formattedDate = mockCommitment.dueDate!.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      expect(draft.body).toContain(formattedDate);
    });

    it("should include the amount", async () => {
      const draft = await generator.generateFollowUpDraft(mockCommitment);
      expect(draft.body).toContain("$2500.00");
    });

    it("should be addressed to the counterparty", async () => {
      const draft = await generator.generateFollowUpDraft(mockCommitment);
      expect(draft.to).toBe("Client Corp");
    });

    it("should handle commitment with no due date", async () => {
      const commitmentNoDate: FinancialCommitment = {
        ...mockCommitment,
        dueDate: null,
      };
      const draft = await generator.generateFollowUpDraft(commitmentNoDate);
      expect(draft.body).toContain("at an agreed-upon time");
    });

    it("should handle commitment with no financial value", async () => {
      const commitmentNoValue: FinancialCommitment = {
        ...mockCommitment,
        financialValue: null,
      };
      const draft = await generator.generateFollowUpDraft(commitmentNoValue);
      expect(draft.body).toContain("the agreed amount");
    });

    it("should set type to payment_follow_up", async () => {
      const draft = await generator.generateFollowUpDraft(mockCommitment);
      expect(draft.type).toBe("payment_follow_up");
    });

    it("should require user approval", async () => {
      const draft = await generator.generateFollowUpDraft(mockCommitment);
      expect(draft.requiresApproval).toBe(true);
    });
  });

  // ─── Common Draft Properties ─────────────────────────────────────────────

  describe("common draft properties", () => {
    it("all drafts should have requiresApproval set to true (Req 17.6)", async () => {
      const cancellation = await generator.generateCancellationDraft(mockSubscription);
      const negotiation = await generator.generateNegotiationDraft(mockSubscription, "price_increase");
      const refundFollowUp = await generator.generateRefundFollowUpDraft(mockRefund);
      const trialCancellation = await generator.generateTrialCancellationDraft(mockTrial);
      const followUp = await generator.generateFollowUpDraft(mockCommitment);

      expect(cancellation.requiresApproval).toBe(true);
      expect(negotiation.requiresApproval).toBe(true);
      expect(refundFollowUp.requiresApproval).toBe(true);
      expect(trialCancellation.requiresApproval).toBe(true);
      expect(followUp.requiresApproval).toBe(true);
    });

    it("all drafts should have unique IDs", async () => {
      const draft1 = await generator.generateCancellationDraft(mockSubscription);
      const draft2 = await generator.generateCancellationDraft(mockSubscription);

      // IDs should be different due to timestamp
      expect(draft1.id).not.toBe(draft2.id);
    });

    it("all drafts should have a createdAt date", async () => {
      const draft = await generator.generateCancellationDraft(mockSubscription);
      expect(draft.createdAt).toBeInstanceOf(Date);
      expect(draft.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });
});
