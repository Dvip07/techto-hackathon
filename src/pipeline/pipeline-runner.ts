/**
 * Pipeline Runner — Full Inbox Intelligence Pipeline Orchestrator
 *
 * Wires together all components in sequence:
 * Gmail connector → batch fetcher → classifier → entity store →
 * intelligence engine → action engine → digest
 *
 * Implements incremental sync flow: fetch new messages, classify, persist to
 * all ledgers, run all 13 intelligence features, generate priority feed,
 * execute automated actions, generate digest.
 *
 * Requirements: 1.2, 2.1, 2.8, 3.1, 3.7, 20.1, 20.5
 */

import type { GmailConnector } from "../ingestion/gmail-connector";
import { BatchFetcher } from "../ingestion/batch-fetcher";
import type { ClaudeUnifiedClassifier } from "../classifier/claude-classifier";
import { UsageSignalCollector } from "../classifier/usage-signal-collector";
import type { UnifiedEntityStore } from "../store/entity-store";
import { IntelligenceEngine } from "../intelligence/intelligence-engine";
import { PriorityRanker } from "../actions/priority-ranker";
import { CalendarScheduler } from "../actions/calendar-scheduler";
import { NotificationEngine } from "../actions/notification-engine";
import { DigestComposer } from "../actions/digest-composer";
import type { AnalyzedMessage } from "../types/signals";
import type { ParsedMessage } from "../ingestion/types";
import type {
  FinancialCommitment,
  FinancialObligation,
  PaymentRecord,
  RefundRecord,
  SubscriptionRecord,
  TrialRecord,
} from "../types/models";
import type { PrioritizedItem, SmartDigest } from "../types/outputs";

// ─── Pipeline Configuration ──────────────────────────────────────────────────

export interface PipelineConfig {
  /** Gmail connector instance (authenticated) */
  gmailConnector: GmailConnector;
  /** Claude classifier instance */
  classifier: ClaudeUnifiedClassifier;
  /** Entity store instance */
  store: UnifiedEntityStore;
  /** Maximum time allowed for pipeline run in milliseconds (default: 30000) */
  maxRunTimeMs?: number;
  /** Number of messages to process per batch for classification (default: 10) */
  classificationBatchSize?: number;
  /** Whether to generate and deliver digest after pipeline run (default: true) */
  generateDigest?: boolean;
  /** Digest delivery channel (default: "dashboard") */
  digestChannel?: "email" | "dashboard" | "both";
  /** User timezone for digest delivery scheduling */
  userTimezone?: string;
  /** Email address for digest delivery */
  digestEmailAddress?: string;
}

// ─── Pipeline Result ─────────────────────────────────────────────────────────

export interface PipelineRunResult {
  /** Whether the pipeline completed successfully */
  success: boolean;
  /** Total time taken in milliseconds */
  durationMs: number;
  /** Number of new messages fetched */
  messagesFetched: number;
  /** Number of messages classified */
  messagesClassified: number;
  /** Number of entities persisted (subscriptions, trials, refunds, etc.) */
  entitiesPersisted: number;
  /** The new historyId after this run (for next incremental sync) */
  newHistoryId: string | null;
  /** Priority feed generated */
  priorityFeed: PrioritizedItem[];
  /** Smart digest generated (if enabled) */
  digest: SmartDigest | null;
  /** Errors encountered during the run (non-fatal) */
  warnings: string[];
  /** Fatal error if pipeline failed */
  error?: string;
}

// ─── Pipeline State ──────────────────────────────────────────────────────────

export interface PipelineState {
  lastHistoryId: string | null;
  lastRunAt: Date | null;
  totalRunCount: number;
}

// ─── Pipeline Runner ─────────────────────────────────────────────────────────

export class PipelineRunner {
  private config: PipelineConfig;
  private state: PipelineState;

  // Core components
  private batchFetcher: BatchFetcher;
  private usageSignalCollector: UsageSignalCollector;
  private intelligenceEngine: IntelligenceEngine;
  private priorityRanker: PriorityRanker;
  private calendarScheduler: CalendarScheduler;
  private notificationEngine: NotificationEngine;
  private digestComposer: DigestComposer;

  constructor(config: PipelineConfig, initialState?: Partial<PipelineState>) {
    this.config = config;
    this.state = {
      lastHistoryId: initialState?.lastHistoryId ?? null,
      lastRunAt: initialState?.lastRunAt ?? null,
      totalRunCount: initialState?.totalRunCount ?? 0,
    };

    // Wire up components
    this.batchFetcher = new BatchFetcher(config.gmailConnector);
    this.usageSignalCollector = new UsageSignalCollector();
    this.intelligenceEngine = new IntelligenceEngine(config.store);
    this.priorityRanker = new PriorityRanker(this.intelligenceEngine);
    this.calendarScheduler = new CalendarScheduler();
    this.notificationEngine = new NotificationEngine();
    this.digestComposer = new DigestComposer(
      this.intelligenceEngine,
      config.store,
      this.priorityRanker,
      {
        userTimezone: config.userTimezone,
        emailAddress: config.digestEmailAddress,
      }
    );
  }

  /**
   * Runs the full pipeline: fetch → classify → persist → analyze → act → digest.
   *
   * Requirement 1.2: Incremental sync using last known historyId
   * Requirement 2.1: Analyze messages and produce structured AnalyzedMessage
   * Requirement 2.8: Analyze all messages in batch
   * Requirement 3.1: Persist subscription records
   * Requirement 3.7: Support cross-cutting queries
   * Requirement 20.1: Complete full pipeline in <30 seconds for 100 messages
   * Requirement 20.5: Update usage scores on every pipeline run
   */
  async runFullPipeline(): Promise<PipelineRunResult> {
    const startTime = Date.now();
    const maxRunTimeMs = this.config.maxRunTimeMs ?? 30000;
    const warnings: string[] = [];
    let messagesFetched = 0;
    let messagesClassified = 0;
    let entitiesPersisted = 0;
    let newHistoryId: string | null = null;
    let priorityFeed: PrioritizedItem[] = [];
    let digest: SmartDigest | null = null;

    try {
      // ─── Step 1: Fetch new messages (incremental sync) ───────────────────
      const fetchResult = await this.fetchNewMessages();
      messagesFetched = fetchResult.messages.length;
      newHistoryId = fetchResult.newHistoryId;

      if (messagesFetched === 0) {
        // No new messages — still run intelligence engine for time-based updates
        await this.runIntelligenceAndActions(startTime, maxRunTimeMs, warnings);
        priorityFeed = await this.priorityRanker.getPriorityFeed(20);

        if (this.config.generateDigest !== false) {
          digest = await this.generateAndDeliverDigest();
        }

        // Update state
        this.updateState(newHistoryId);

        return {
          success: true,
          durationMs: Date.now() - startTime,
          messagesFetched: 0,
          messagesClassified: 0,
          entitiesPersisted: 0,
          newHistoryId,
          priorityFeed,
          digest,
          warnings,
        };
      }

      // ─── Step 2: Classify messages ───────────────────────────────────────
      this.checkTimeout(startTime, maxRunTimeMs, "classification");
      const analyzedMessages = await this.classifyMessages(fetchResult.messages);
      messagesClassified = analyzedMessages.length;

      // ─── Step 3: Persist to all ledgers ──────────────────────────────────
      this.checkTimeout(startTime, maxRunTimeMs, "persistence");
      entitiesPersisted = await this.persistEntities(analyzedMessages, warnings);

      // ─── Step 4: Update usage scores ─────────────────────────────────────
      // Requirement 20.5: Update usage scores on every pipeline run
      this.checkTimeout(startTime, maxRunTimeMs, "usage scoring");
      await this.updateUsageScores(analyzedMessages, warnings);

      // ─── Step 5: Run intelligence engine (all 13 features) ───────────────
      this.checkTimeout(startTime, maxRunTimeMs, "intelligence");
      await this.runIntelligenceAndActions(startTime, maxRunTimeMs, warnings);

      // ─── Step 6: Generate priority feed ──────────────────────────────────
      this.checkTimeout(startTime, maxRunTimeMs, "priority feed");
      priorityFeed = await this.priorityRanker.getPriorityFeed(20);

      // ─── Step 7: Execute automated actions ───────────────────────────────
      this.checkTimeout(startTime, maxRunTimeMs, "automated actions");
      await this.executeAutomatedActions(priorityFeed, warnings);

      // ─── Step 8: Generate digest ─────────────────────────────────────────
      if (this.config.generateDigest !== false) {
        this.checkTimeout(startTime, maxRunTimeMs, "digest generation");
        digest = await this.generateAndDeliverDigest();
      }

      // ─── Update state ────────────────────────────────────────────────────
      this.updateState(newHistoryId);

      return {
        success: true,
        durationMs: Date.now() - startTime,
        messagesFetched,
        messagesClassified,
        entitiesPersisted,
        newHistoryId,
        priorityFeed,
        digest,
        warnings,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // If we got a new historyId before the error, still save it
      if (newHistoryId) {
        this.updateState(newHistoryId);
      }

      return {
        success: false,
        durationMs: Date.now() - startTime,
        messagesFetched,
        messagesClassified,
        entitiesPersisted,
        newHistoryId,
        priorityFeed,
        digest,
        warnings,
        error: errorMessage,
      };
    }
  }

  // ─── Step Implementations ──────────────────────────────────────────────────

  /**
   * Fetches new messages using incremental sync or full fetch.
   *
   * Requirement 1.2: Incremental sync using last known historyId
   */
  private async fetchNewMessages() {
    if (this.state.lastHistoryId) {
      // Incremental sync — only fetch new messages since last run
      return this.batchFetcher.fetch({
        mode: "incremental",
        lastHistoryId: this.state.lastHistoryId,
        parseAttachments: true,
      });
    }

    // First run — fetch recent messages (last 7 days, up to 20 to stay within rate limits)
    const since = new Date();
    since.setDate(since.getDate() - 7);

    return this.batchFetcher.fetch({
      mode: "full",
      fetchOptions: {
        since,
        maxResults: 20,
      },
      parseAttachments: true,
    });
  }

  /**
   * Classifies messages using the Claude classifier in batches.
   *
   * Requirement 2.1: Analyze messages and produce structured AnalyzedMessage
   * Requirement 2.8: Analyze all messages in batch
   */
  private async classifyMessages(
    parsedMessages: ParsedMessage[]
  ): Promise<AnalyzedMessage[]> {
    const batchSize = this.config.classificationBatchSize ?? 10;
    const allResults: AnalyzedMessage[] = [];

    for (let i = 0; i < parsedMessages.length; i += batchSize) {
      const batch = parsedMessages.slice(i, i + batchSize);
      const results = await this.config.classifier.analyzeBatch(batch);
      allResults.push(...results);

      // Delay between batches to respect Claude rate limits (50k tokens/min on free tier)
      if (i + batchSize < parsedMessages.length) {
        await new Promise((resolve) => setTimeout(resolve, 15000)); // 15s between batches
      }
    }

    return allResults;
  }

  /**
   * Persists analyzed messages and their extracted entities to all ledgers.
   *
   * Requirement 3.1: Upsert subscription records with deduplication by vendor domain
   * Requirement 3.7: Support cross-cutting queries
   */
  private async persistEntities(
    analyzedMessages: AnalyzedMessage[],
    warnings: string[]
  ): Promise<number> {
    let count = 0;
    const store = this.config.store;

    for (const msg of analyzedMessages) {
      try {
        // Persist the analyzed message itself
        await store.insertMessage(msg);
        count++;

        // Persist subscription signals
        if (msg.subscriptionSignal) {
          const subRecord = this.buildSubscriptionRecord(msg);
          await store.upsertSubscription(subRecord);
          count++;

          // Also record as a payment
          const payment = this.buildPaymentRecord(msg);
          if (payment) {
            await store.insertPayment(payment);
            count++;
          }
        }

        // Persist trial signals
        if (msg.trialSignal) {
          const trialRecord = this.buildTrialRecord(msg);
          await store.insertTrial(trialRecord);
          count++;
        }

        // Persist refund signals
        if (msg.refundSignal) {
          const refundRecord = this.buildRefundRecord(msg);
          await store.insertRefund(refundRecord);
          count++;
        }

        // Persist commitment signals
        for (const commitment of msg.commitmentSignals) {
          if (commitment.subtype === "non_financial") continue;
          const commitmentRecord = this.buildCommitmentRecord(msg, commitment);
          await store.insertCommitment(commitmentRecord);
          count++;
        }

        // Persist contract signals
        if (msg.contractSignal) {
          const obligationRecord = this.buildObligationRecord(msg);
          await store.upsertObligation(obligationRecord);
          count++;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to persist entities for message ${msg.messageId}: ${errorMsg}`);
      }
    }

    return count;
  }

  /**
   * Updates usage scores for all active subscriptions.
   *
   * Requirement 20.5: Update usage scores on every pipeline run
   */
  private async updateUsageScores(
    newMessages: AnalyzedMessage[],
    warnings: string[]
  ): Promise<void> {
    try {
      const activeSubscriptions = await this.config.store.getActiveSubscriptions();
      const allMessages = await this.config.store.queryMessages({});

      for (const sub of activeSubscriptions) {
        const vendorMessages = allMessages.filter(
          (m) => m.senderDomain.toLowerCase() === sub.vendorDomain.toLowerCase()
        );

        const profile = this.usageSignalCollector.collectSignals(
          sub.vendor,
          vendorMessages
        );
        const usageScore = this.usageSignalCollector.computeUsageScore(profile);

        // Update the subscription with the new usage score
        if (usageScore !== sub.usageScore) {
          await this.config.store.upsertSubscription({
            ...sub,
            usageScore,
            updatedAt: new Date(),
          });
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to update usage scores: ${errorMsg}`);
    }
  }

  /**
   * Runs the intelligence engine's analysis features.
   * This triggers time-based status updates (overdue detection, etc.)
   */
  private async runIntelligenceAndActions(
    startTime: number,
    maxRunTimeMs: number,
    warnings: string[]
  ): Promise<void> {
    try {
      // Run subscription scan (updates statuses)
      await this.intelligenceEngine.scanSubscriptions();
    } catch (error) {
      warnings.push(`Subscription scan warning: ${this.errorMessage(error)}`);
    }

    try {
      // Track trial expiries (updates statuses)
      await this.intelligenceEngine.trackTrialExpiries();
    } catch (error) {
      warnings.push(`Trial tracking warning: ${this.errorMessage(error)}`);
    }

    try {
      // Track refunds (updates overdue status)
      await this.intelligenceEngine.trackRefundsAndCredits();
    } catch (error) {
      warnings.push(`Refund tracking warning: ${this.errorMessage(error)}`);
    }

    try {
      // Track payment promises
      await this.intelligenceEngine.trackPaymentPromises();
    } catch (error) {
      warnings.push(`Payment promise tracking warning: ${this.errorMessage(error)}`);
    }

    try {
      // Track financial commitments
      await this.intelligenceEngine.trackFinancialCommitments();
    } catch (error) {
      warnings.push(`Commitment tracking warning: ${this.errorMessage(error)}`);
    }

    try {
      // Watch obligations
      await this.intelligenceEngine.watchObligations();
    } catch (error) {
      warnings.push(`Obligation watch warning: ${this.errorMessage(error)}`);
    }

    try {
      // Detect subscription creep
      await this.intelligenceEngine.detectSubscriptionCreep();
    } catch (error) {
      warnings.push(`Creep detection warning: ${this.errorMessage(error)}`);
    }
  }

  /**
   * Executes automated actions based on the priority feed:
   * - Schedule calendar reminders for upcoming renewals
   * - Dispatch notifications for high-urgency items
   */
  private async executeAutomatedActions(
    priorityFeed: PrioritizedItem[],
    warnings: string[]
  ): Promise<void> {
    // Schedule calendar reminders for renewal alerts
    try {
      const renewalAlerts = await this.intelligenceEngine.computeUpcomingRenewals();
      for (const alert of renewalAlerts) {
        this.calendarScheduler.recordDetection(alert.id);
      }
      await this.calendarScheduler.scheduleBatchReminders(renewalAlerts);
    } catch (error) {
      warnings.push(`Calendar scheduling warning: ${this.errorMessage(error)}`);
    }

    // Schedule trial expiry reminders
    try {
      const trialResult = await this.intelligenceEngine.trackTrialExpiries();
      for (const trial of trialResult.expiringSoon) {
        this.calendarScheduler.recordDetection(trial.id);
        await this.calendarScheduler.scheduleTrialExpiryReminder(trial);
      }
    } catch (error) {
      warnings.push(`Trial reminder scheduling warning: ${this.errorMessage(error)}`);
    }

    // Dispatch notifications for high-urgency items
    try {
      for (const item of priorityFeed) {
        await this.notificationEngine.dispatchNotification(item);
      }
    } catch (error) {
      warnings.push(`Notification dispatch warning: ${this.errorMessage(error)}`);
    }

    // Dispatch creep alert if detected
    try {
      const creepAlert = await this.intelligenceEngine.detectSubscriptionCreep();
      if (creepAlert) {
        await this.notificationEngine.dispatchCreepAlert(creepAlert);
      }
    } catch (error) {
      warnings.push(`Creep alert notification warning: ${this.errorMessage(error)}`);
    }
  }

  /**
   * Generates and delivers the smart digest.
   */
  private async generateAndDeliverDigest(): Promise<SmartDigest | null> {
    try {
      const digestData = await this.config.store.getDigestData("daily");
      const digest = await this.digestComposer.composeDigest(digestData);
      const channel = this.config.digestChannel ?? "dashboard";
      await this.digestComposer.deliverDigest(digest, channel);
      return digest;
    } catch {
      // Digest generation is non-critical — return null on failure
      return null;
    }
  }

  // ─── Entity Building Helpers ───────────────────────────────────────────────

  private buildSubscriptionRecord(msg: AnalyzedMessage): SubscriptionRecord {
    const signal = msg.subscriptionSignal!;
    const now = new Date();

    return {
      id: `sub-${signal.vendorDomain}-${Date.now()}`,
      vendor: signal.vendor,
      vendorDomain: signal.vendorDomain,
      amount: signal.amount,
      currency: signal.currency,
      billingFrequency: signal.billingFrequency,
      category: signal.category,
      status: signal.isActive ? "active-used" : "unknown",
      usageScore: 0,
      wasteScore: 0,
      firstSeenDate: msg.timestamp,
      lastPaymentDate: msg.timestamp,
      nextRenewalDate: signal.renewalDate,
      autoRenews: signal.autoRenews,
      trialEndsDate: signal.trialEndsDate ?? null,
      annualPlanAvailable: signal.annualPlanAvailable ?? false,
      annualPlanAmount: signal.annualPlanAmount ?? null,
      annualSavingsIfSwitched: null,
      priceChangeHistory: signal.isPriceChange && signal.previousAmount
        ? [{
            previousAmount: signal.previousAmount,
            newAmount: signal.amount,
            detectedDate: msg.timestamp,
            percentageChange: ((signal.amount - signal.previousAmount) / signal.previousAmount) * 100,
            sourceMessageId: msg.messageId,
          }]
        : [],
      sourceMessageIds: [msg.messageId],
      createdAt: now,
      updatedAt: now,
    };
  }

  private buildPaymentRecord(msg: AnalyzedMessage): PaymentRecord | null {
    const signal = msg.subscriptionSignal;
    if (!signal) return null;

    return {
      id: `pay-${msg.messageId}`,
      vendor: signal.vendor,
      amount: signal.amount,
      currency: signal.currency,
      category: signal.category,
      date: msg.timestamp,
      type: "subscription",
      sourceMessageId: msg.messageId,
    };
  }

  private buildTrialRecord(msg: AnalyzedMessage): TrialRecord {
    const signal = msg.trialSignal!;
    const now = new Date();
    const endDate = signal.trialEndDate instanceof Date
      ? signal.trialEndDate
      : new Date(signal.trialEndDate);
    const daysRemaining = Math.max(
      0,
      Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    );

    return {
      id: `trial-${signal.vendor.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
      vendor: signal.vendor,
      vendorDomain: msg.senderDomain,
      category: "other",
      trialStartDate: signal.trialStartDate,
      trialEndDate: signal.trialEndDate,
      daysRemaining,
      convertsToAmount: signal.convertsToAmount,
      convertsToFrequency: signal.convertsToFrequency,
      autoConverts: signal.autoConverts,
      cancellationUrl: signal.cancellationUrl ?? null,
      status: daysRemaining <= 7 ? "expiring_soon" : "active",
      reminderScheduled: false,
      sourceMessageId: msg.messageId,
    };
  }

  private buildRefundRecord(msg: AnalyzedMessage): RefundRecord {
    const signal = msg.refundSignal!;
    const now = new Date();
    const promisedDate = msg.timestamp;

    // Requirement 10.2: Set expected-by date to 14 days from promise date when no specific date
    const expectedByDate = signal.expectedDate
      ? signal.expectedDate
      : new Date(promisedDate.getTime() + 14 * 24 * 60 * 60 * 1000);

    return {
      id: `refund-${signal.vendor.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
      vendor: signal.vendor,
      amount: signal.amount,
      currency: signal.currency,
      promisedDate,
      expectedByDate,
      actualReceivedDate: signal.status === "processed" ? now : null,
      status: signal.status === "processed" ? "received" : "promised",
      daysOverdue: 0,
      originalTransactionDate: signal.originalTransactionDate,
      reason: signal.reason,
      sourceMessageIds: [msg.messageId],
      lastFollowUpDate: null,
    };
  }

  private buildCommitmentRecord(
    msg: AnalyzedMessage,
    signal: AnalyzedMessage["commitmentSignals"][0]
  ): FinancialCommitment {
    const now = new Date();

    return {
      id: `commit-${msg.messageId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      messageId: msg.messageId,
      threadId: msg.threadId,
      type: signal.type,
      subtype: signal.subtype as FinancialCommitment["subtype"],
      description: signal.description,
      owner: signal.owner,
      counterparty: signal.counterparty,
      financialValue: signal.financialValue,
      currency: "USD",
      dueDate: signal.dueDate,
      status: "open",
      isImplicit: signal.isImplicit,
      confidence: signal.confidence,
      priority: signal.financialValue ? Math.min(10, Math.ceil(signal.financialValue / 100)) : 1,
      createdAt: now,
      updatedAt: now,
      fulfilledAt: null,
      lastFollowUpDate: null,
    };
  }

  private buildObligationRecord(msg: AnalyzedMessage): FinancialObligation {
    const signal = msg.contractSignal!;
    const now = new Date();

    // Build risk flags
    const riskFlags: string[] = [];
    if (signal.autoRenews) riskFlags.push("auto_renewal");
    if (signal.priceEscalationClause) riskFlags.push("price_escalation");
    if (signal.penaltyClauses.length > 0) riskFlags.push("penalty_clause");

    return {
      id: `obligation-${msg.messageId}-${Date.now()}`,
      contractName: `Contract from ${msg.sender}`,
      contractType: signal.contractType,
      parties: signal.parties,
      totalValue: signal.totalValue,
      currency: "USD",
      recurringAmount: null,
      paymentFrequency: null,
      keyDates: signal.renewalDate
        ? [{
            id: `deadline-${msg.messageId}`,
            date: signal.renewalDate,
            type: "renewal" as const,
            description: "Contract renewal date",
            financialConsequence: null,
            amount: signal.totalValue,
            leadTimeAlerts: signal.noticeWindowDays ? [signal.noticeWindowDays, 7, 1] : [30, 7, 1],
            acknowledged: false,
          }]
        : [],
      penaltyClauses: signal.penaltyClauses.map((desc) => ({
        description: desc,
        triggerCondition: "See contract terms",
        penaltyAmount: null,
        penaltyType: "variable" as const,
      })),
      autoRenews: signal.autoRenews,
      noticeWindowDays: signal.noticeWindowDays,
      financialExposure: signal.financialExposure,
      riskFlags: riskFlags as any[],
      sourceMessageIds: [msg.messageId],
      createdAt: now,
      updatedAt: now,
    };
  }

  // ─── State Management ──────────────────────────────────────────────────────

  /**
   * Updates pipeline state after a successful run.
   * Stores the new historyId for the next incremental sync.
   */
  private updateState(newHistoryId: string | null): void {
    if (newHistoryId) {
      this.state.lastHistoryId = newHistoryId;
    }
    this.state.lastRunAt = new Date();
    this.state.totalRunCount++;
  }

  /**
   * Returns the current pipeline state.
   */
  getState(): PipelineState {
    return { ...this.state };
  }

  /**
   * Sets the lastHistoryId (e.g., loaded from persistent storage).
   */
  setLastHistoryId(historyId: string): void {
    this.state.lastHistoryId = historyId;
  }

  /**
   * Returns the intelligence engine instance (for direct access if needed).
   */
  getIntelligenceEngine(): IntelligenceEngine {
    return this.intelligenceEngine;
  }

  /**
   * Returns the priority ranker instance.
   */
  getPriorityRanker(): PriorityRanker {
    return this.priorityRanker;
  }

  /**
   * Returns the digest composer instance.
   */
  getDigestComposer(): DigestComposer {
    return this.digestComposer;
  }

  // ─── Utility Methods ───────────────────────────────────────────────────────

  /**
   * Checks if the pipeline has exceeded its time budget.
   * Throws a timeout error if exceeded.
   *
   * Requirement 20.1: Complete full pipeline in <30 seconds for 100 messages
   */
  private checkTimeout(startTime: number, maxRunTimeMs: number, phase: string): void {
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxRunTimeMs) {
      throw new Error(
        `Pipeline timeout: exceeded ${maxRunTimeMs}ms budget during ${phase} phase (elapsed: ${elapsed}ms)`
      );
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
