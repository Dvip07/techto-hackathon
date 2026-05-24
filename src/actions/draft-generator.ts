/**
 * Draft Generator — Action Engine component for email draft generation.
 *
 * Generates ready-to-send email drafts for cancellations, negotiations,
 * refund follow-ups, trial cancellations, and payment promise follow-ups.
 * All drafts require user approval before sending.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6
 */

import type { FinancialCommitment, RefundRecord, SubscriptionRecord, TrialRecord } from "../types/models";
import type { DraftType, EmailDraft, NegotiationReason } from "../types/outputs";

// ─── Draft Generator ─────────────────────────────────────────────────────────

export class DraftGenerator {
  /**
   * Generates a cancellation draft email addressed to the subscription vendor.
   *
   * Requirement 17.1: Generate a cancellation draft email addressed to the subscription vendor
   */
  async generateCancellationDraft(subscription: SubscriptionRecord): Promise<EmailDraft> {
    const subject = `Cancellation Request — ${subscription.vendor} Subscription`;
    const body = [
      `Dear ${subscription.vendor} Support,`,
      "",
      `I am writing to request the cancellation of my subscription (account associated with this email address).`,
      "",
      `Subscription details:`,
      `- Service: ${subscription.vendor}`,
      `- Current billing amount: $${subscription.amount.toFixed(2)}/${subscription.billingFrequency}`,
      `- Billing frequency: ${subscription.billingFrequency}`,
      "",
      `Please confirm the cancellation and let me know if any further steps are required on my end. I would also appreciate confirmation that no further charges will be applied.`,
      "",
      `Thank you for your assistance.`,
      "",
      `Best regards`,
    ].join("\n");

    return this.createDraft({
      to: `support@${subscription.vendorDomain}`,
      subject,
      body,
      type: "cancellation",
      targetId: subscription.id,
    });
  }

  /**
   * Generates a negotiation draft email incorporating reason, current amount,
   * tenure, and requested outcome.
   *
   * Requirement 17.2: Generate a negotiation draft incorporating reason, current amount,
   * user tenure, and requested outcome
   */
  async generateNegotiationDraft(
    subscription: SubscriptionRecord,
    reason: NegotiationReason
  ): Promise<EmailDraft> {
    const tenure = this.computeTenureMonths(subscription.firstSeenDate, new Date());
    const reasonText = this.getNegotiationReasonText(reason, subscription);
    const requestedOutcome = this.getRequestedOutcome(reason, subscription);

    const subject = `Pricing Discussion — ${subscription.vendor} Subscription`;
    const body = [
      `Dear ${subscription.vendor} Support,`,
      "",
      `I have been a loyal customer for ${tenure} months and I would like to discuss my current subscription pricing.`,
      "",
      `Current plan details:`,
      `- Monthly amount: $${subscription.amount.toFixed(2)}`,
      `- Billing frequency: ${subscription.billingFrequency}`,
      `- Customer since: ${this.formatDate(subscription.firstSeenDate)}`,
      "",
      `Reason for reaching out:`,
      reasonText,
      "",
      `Requested outcome:`,
      requestedOutcome,
      "",
      `I value the service and would prefer to continue as a customer. I hope we can find a mutually beneficial arrangement.`,
      "",
      `Thank you for considering my request.`,
      "",
      `Best regards`,
    ].join("\n");

    return this.createDraft({
      to: `support@${subscription.vendorDomain}`,
      subject,
      body,
      type: "negotiation",
      targetId: subscription.id,
    });
  }

  /**
   * Generates a refund follow-up draft referencing original promise date and amount.
   *
   * Requirement 17.3: Generate a follow-up draft referencing the original refund promise date and amount
   */
  async generateRefundFollowUpDraft(refund: RefundRecord): Promise<EmailDraft> {
    const promiseDateText = refund.promisedDate
      ? `on ${this.formatDate(refund.promisedDate)}`
      : "previously";

    const subject = `Follow-Up: Pending Refund of $${refund.amount.toFixed(2)} — ${refund.vendor}`;
    const body = [
      `Dear ${refund.vendor} Support,`,
      "",
      `I am following up on a refund that was promised ${promiseDateText} but has not yet been received.`,
      "",
      `Refund details:`,
      `- Amount: $${refund.amount.toFixed(2)} ${refund.currency}`,
      `- Reason: ${refund.reason}`,
      `- Promise date: ${refund.promisedDate ? this.formatDate(refund.promisedDate) : "Not specified"}`,
      `- Expected by: ${this.formatDate(refund.expectedByDate)}`,
      `- Days overdue: ${refund.daysOverdue}`,
      "",
      `Could you please provide an update on the status of this refund? I would appreciate a timeline for when I can expect to receive it.`,
      "",
      `Thank you for your prompt attention to this matter.`,
      "",
      `Best regards`,
    ].join("\n");

    return this.createDraft({
      to: `support@${refund.vendor.toLowerCase().replace(/\s+/g, "")}.com`,
      subject,
      body,
      type: "refund_follow_up",
      targetId: refund.id,
    });
  }

  /**
   * Generates a trial cancellation draft including cancellation URL when available.
   *
   * Requirement 17.4: Generate a trial cancellation draft including the cancellation URL when available
   */
  async generateTrialCancellationDraft(trial: TrialRecord): Promise<EmailDraft> {
    const cancellationNote = trial.cancellationUrl
      ? `I found the cancellation page at: ${trial.cancellationUrl}\nHowever, I wanted to confirm via email that my trial has been cancelled and no charges will be applied.`
      : `Please cancel my trial immediately and confirm that no charges will be applied upon expiry.`;

    const conversionInfo = trial.convertsToAmount !== null
      ? `\nI understand the trial converts to a paid plan of $${trial.convertsToAmount.toFixed(2)}/${trial.convertsToFrequency ?? "month"} upon expiry. I do not wish to continue with the paid plan.`
      : "";

    const subject = `Trial Cancellation Request — ${trial.vendor}`;
    const body = [
      `Dear ${trial.vendor} Support,`,
      "",
      `I am writing to cancel my free trial before it expires on ${this.formatDate(trial.trialEndDate)}.`,
      conversionInfo,
      "",
      cancellationNote,
      "",
      `Thank you for your assistance.`,
      "",
      `Best regards`,
    ].join("\n");

    return this.createDraft({
      to: `support@${trial.vendorDomain}`,
      subject,
      body,
      type: "trial_cancellation",
      targetId: trial.id,
    });
  }

  /**
   * Generates a follow-up draft for payment promises referencing original promise and due date.
   *
   * Requirement 17.5: Generate a polite follow-up draft referencing the original payment promise and due date
   */
  async generateFollowUpDraft(commitment: FinancialCommitment): Promise<EmailDraft> {
    const dueDateText = commitment.dueDate
      ? `by ${this.formatDate(commitment.dueDate)}`
      : "at an agreed-upon time";

    const amountText = commitment.financialValue !== null
      ? `$${commitment.financialValue.toFixed(2)} ${commitment.currency}`
      : "the agreed amount";

    const subject = `Friendly Follow-Up: Outstanding Payment — ${commitment.counterparty}`;
    const body = [
      `Dear ${commitment.counterparty},`,
      "",
      `I hope this message finds you well. I am writing to follow up on a payment commitment that was made ${dueDateText}.`,
      "",
      `Payment details:`,
      `- Description: ${commitment.description}`,
      `- Amount: ${amountText}`,
      `- Due date: ${commitment.dueDate ? this.formatDate(commitment.dueDate) : "Not specified"}`,
      "",
      `I understand things can get busy, but I wanted to check in on the status of this payment. Could you please provide an update or let me know if there are any issues?`,
      "",
      `Thank you for your attention to this matter.`,
      "",
      `Best regards`,
    ].join("\n");

    return this.createDraft({
      to: commitment.counterparty,
      subject,
      body,
      type: "payment_follow_up",
      targetId: commitment.id,
    });
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Creates an EmailDraft with a unique ID and approval flag.
   *
   * Requirement 17.6: Present all generated drafts for user approval before sending
   */
  private createDraft(params: {
    to: string;
    subject: string;
    body: string;
    type: DraftType;
    targetId: string;
  }): EmailDraft {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      id: `draft-${params.type}-${params.targetId}-${uniqueSuffix}`,
      to: params.to,
      subject: params.subject,
      body: params.body,
      type: params.type,
      targetId: params.targetId,
      requiresApproval: true,
      createdAt: new Date(),
    };
  }

  private computeTenureMonths(firstSeenDate: Date, now: Date): number {
    const first = firstSeenDate instanceof Date ? firstSeenDate : new Date(firstSeenDate);
    const diffMs = now.getTime() - first.getTime();
    return Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.44)));
  }

  private formatDate(date: Date): string {
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  private getNegotiationReasonText(reason: NegotiationReason, subscription: SubscriptionRecord): string {
    switch (reason) {
      case "price_increase": {
        const latestChange = subscription.priceChangeHistory[subscription.priceChangeHistory.length - 1];
        if (latestChange) {
          return `My subscription price was recently increased from $${latestChange.previousAmount.toFixed(2)} to $${latestChange.newAmount.toFixed(2)} (a ${latestChange.percentageChange.toFixed(1)}% increase). As a long-standing customer, I would like to discuss options to maintain my previous rate or receive a comparable discount.`;
        }
        return `I have noticed a recent price increase on my subscription and would like to discuss options for a better rate.`;
      }
      case "competitor_cheaper":
        return `I have found comparable services available at a lower price point. I would prefer to stay with ${subscription.vendor}, but the pricing difference is significant enough that I need to consider alternatives.`;
      case "long_tenure_discount":
        return `As a loyal customer who has been subscribed for an extended period, I believe I qualify for a loyalty discount or retention offer.`;
      case "usage_low":
        return `My usage of the service has been lower than expected. I would like to discuss downgrading to a more appropriate plan or receiving a discount that better reflects my usage level.`;
      case "bulk_opportunity":
        return `I have multiple services and would like to discuss bundling options or a multi-service discount.`;
    }
  }

  private getRequestedOutcome(reason: NegotiationReason, subscription: SubscriptionRecord): string {
    switch (reason) {
      case "price_increase": {
        const latestChange = subscription.priceChangeHistory[subscription.priceChangeHistory.length - 1];
        if (latestChange) {
          return `I would like to return to my previous rate of $${latestChange.previousAmount.toFixed(2)}/${subscription.billingFrequency}, or receive a comparable discount on the new pricing.`;
        }
        return `I would like a discount or return to my previous pricing.`;
      }
      case "competitor_cheaper":
        return `I would appreciate a price match or a discount that makes staying with ${subscription.vendor} the better value.`;
      case "long_tenure_discount":
        return `I am requesting a loyalty discount of 15-20% on my current rate of $${subscription.amount.toFixed(2)}/${subscription.billingFrequency}.`;
      case "usage_low":
        return `I would like to either downgrade to a lower-tier plan or receive a reduced rate that reflects my actual usage.`;
      case "bulk_opportunity":
        return `I would like to discuss a bundled pricing arrangement that provides savings across my services.`;
    }
  }
}
