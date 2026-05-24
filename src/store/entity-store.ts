/**
 * Unified Entity Store — SQLite implementation using better-sqlite3.
 *
 * Single persistent store for all financial intelligence data.
 * All feature areas read from this store.
 */

import Database from "better-sqlite3";
import type {
  BillingFrequency,
  CommitmentStatus,
  ContractType,
  FeatureArea,
  RiskFlag,
  SubscriptionCategory,
  SubscriptionStatus,
} from "../types/enums";
import type {
  FinancialCommitment,
  FinancialObligation,
  ObligationDeadline,
  PaymentRecord,
  PenaltyClause,
  PriceChange,
  RefundRecord,
  SubscriptionRecord,
  TrialRecord,
} from "../types/models";
import type { AnalyzedMessage } from "../types/signals";
import type {
  CalendarEntry,
  CategorySpend,
  DateRange,
  MonthlySpend,
  RecurringSpendSnapshot,
} from "../types/outputs";

// ─── Filter Types ────────────────────────────────────────────────────────────

export interface MessageFilter {
  since?: Date;
  until?: Date;
  senderDomain?: string;
  classifications?: string[];
}

export interface SubscriptionFilter {
  status?: SubscriptionStatus;
  category?: SubscriptionCategory;
  vendor?: string;
  minAmount?: number;
  maxAmount?: number;
}

export interface ObligationFilter {
  contractType?: ContractType;
  hasRiskFlags?: boolean;
  autoRenews?: boolean;
}

export interface VendorProfile {
  vendor: string;
  vendorDomain: string;
  subscriptions: SubscriptionRecord[];
  payments: PaymentRecord[];
  trials: TrialRecord[];
  refunds: RefundRecord[];
  commitments: FinancialCommitment[];
  obligations: FinancialObligation[];
  totalSpent: number;
  firstInteraction: Date | null;
  lastInteraction: Date | null;
}

export interface DigestData {
  totalRecurringSpend: number;
  spendChangeFromLastPeriod: number;
  totalPotentialSavings: number;
  upcomingRenewals: SubscriptionRecord[];
  expiringTrials: TrialRecord[];
  overdueRefunds: RefundRecord[];
  overdueCommitments: FinancialCommitment[];
  recentPayments: PaymentRecord[];
}

// ─── Entity Store Interface ──────────────────────────────────────────────────

export interface UnifiedEntityStore {
  // Core message records
  insertMessage(record: AnalyzedMessage): Promise<void>;
  getMessage(messageId: string): Promise<AnalyzedMessage | null>;
  queryMessages(filter: MessageFilter): Promise<AnalyzedMessage[]>;

  // Subscription Ledger
  upsertSubscription(sub: SubscriptionRecord): Promise<void>;
  getSubscriptions(filter?: SubscriptionFilter): Promise<SubscriptionRecord[]>;
  getSubscriptionsByCategory(category: SubscriptionCategory): Promise<SubscriptionRecord[]>;
  getActiveSubscriptions(): Promise<SubscriptionRecord[]>;
  getZombieSubscriptions(): Promise<SubscriptionRecord[]>;
  getSubscriptionHistory(vendor: string): Promise<PaymentRecord[]>;

  // Free Trial Registry
  insertTrial(trial: TrialRecord): Promise<void>;
  getActiveTrials(): Promise<TrialRecord[]>;
  getExpiringTrials(daysAhead: number): Promise<TrialRecord[]>;

  // Refund Tracker
  insertRefund(refund: RefundRecord): Promise<void>;
  getPendingRefunds(): Promise<RefundRecord[]>;
  getOverdueRefunds(): Promise<RefundRecord[]>;
  markRefundReceived(refundId: string): Promise<void>;

  // Commitment Ledger
  insertCommitment(commitment: FinancialCommitment): Promise<void>;
  updateCommitmentStatus(id: string, status: CommitmentStatus): Promise<void>;
  getOpenCommitments(): Promise<FinancialCommitment[]>;
  getOverdueCommitments(): Promise<FinancialCommitment[]>;
  getPaymentPromises(): Promise<FinancialCommitment[]>;

  // Obligation Ledger
  upsertObligation(obligation: FinancialObligation): Promise<void>;
  getObligations(filter?: ObligationFilter): Promise<FinancialObligation[]>;
  getUpcomingDeadlines(daysAhead: number): Promise<ObligationDeadline[]>;

  // Payment History
  insertPayment(payment: PaymentRecord): Promise<void>;
  getPaymentHistory(range: DateRange): Promise<PaymentRecord[]>;
  getMonthlySpendSummary(months: number): Promise<MonthlySpend[]>;
  getSpendByCategory(range: DateRange): Promise<CategorySpend[]>;
  getTotalRecurringSpend(): Promise<RecurringSpendSnapshot[]>;

  // Cross-cutting queries
  getFinancialCalendar(range: DateRange): Promise<CalendarEntry[]>;
  searchByVendor(vendor: string): Promise<VendorProfile>;
  getDigestData(period: "daily" | "weekly"): Promise<DigestData>;
}


// ─── SQLite Implementation ───────────────────────────────────────────────────

export class SQLiteEntityStore implements UnifiedEntityStore {
  private db: Database.Database;

  constructor(dbPath: string = ":memory:") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        sender TEXT NOT NULL,
        sender_domain TEXT NOT NULL,
        classifications TEXT NOT NULL DEFAULT '[]',
        subscription_signal TEXT,
        commitment_signals TEXT NOT NULL DEFAULT '[]',
        contract_signal TEXT,
        refund_signal TEXT,
        trial_signal TEXT,
        financial_entities TEXT NOT NULL DEFAULT '[]',
        usage_indicators TEXT NOT NULL DEFAULT '[]',
        urgency_score REAL NOT NULL DEFAULT 0,
        summary TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        vendor TEXT NOT NULL,
        vendor_domain TEXT NOT NULL UNIQUE,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        billing_frequency TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'other',
        status TEXT NOT NULL DEFAULT 'unknown',
        usage_score REAL NOT NULL DEFAULT 0,
        waste_score REAL NOT NULL DEFAULT 0,
        first_seen_date TEXT NOT NULL,
        last_payment_date TEXT NOT NULL,
        next_renewal_date TEXT,
        auto_renews INTEGER NOT NULL DEFAULT 0,
        trial_ends_date TEXT,
        annual_plan_available INTEGER NOT NULL DEFAULT 0,
        annual_plan_amount REAL,
        annual_savings_if_switched REAL,
        price_change_history TEXT NOT NULL DEFAULT '[]',
        source_message_ids TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trials (
        id TEXT PRIMARY KEY,
        vendor TEXT NOT NULL,
        vendor_domain TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'other',
        trial_start_date TEXT NOT NULL,
        trial_end_date TEXT NOT NULL,
        days_remaining INTEGER NOT NULL DEFAULT 0,
        converts_to_amount REAL,
        converts_to_frequency TEXT,
        auto_converts INTEGER NOT NULL DEFAULT 0,
        cancellation_url TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        reminder_scheduled INTEGER NOT NULL DEFAULT 0,
        source_message_id TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS refunds (
        id TEXT PRIMARY KEY,
        vendor TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        promised_date TEXT,
        expected_by_date TEXT NOT NULL,
        actual_received_date TEXT,
        status TEXT NOT NULL DEFAULT 'promised',
        days_overdue INTEGER NOT NULL DEFAULT 0,
        original_transaction_date TEXT,
        reason TEXT NOT NULL DEFAULT '',
        source_message_ids TEXT NOT NULL DEFAULT '[]',
        last_follow_up_date TEXT
      );

      CREATE TABLE IF NOT EXISTS commitments (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        type TEXT NOT NULL,
        subtype TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        owner TEXT NOT NULL DEFAULT '',
        counterparty TEXT NOT NULL DEFAULT '',
        financial_value REAL,
        currency TEXT NOT NULL DEFAULT 'USD',
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        is_implicit INTEGER NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        fulfilled_at TEXT,
        last_follow_up_date TEXT
      );

      CREATE TABLE IF NOT EXISTS obligations (
        id TEXT PRIMARY KEY,
        contract_name TEXT NOT NULL,
        contract_type TEXT NOT NULL,
        parties TEXT NOT NULL DEFAULT '[]',
        total_value REAL,
        currency TEXT NOT NULL DEFAULT 'USD',
        recurring_amount REAL,
        payment_frequency TEXT,
        key_dates TEXT NOT NULL DEFAULT '[]',
        penalty_clauses TEXT NOT NULL DEFAULT '[]',
        auto_renews INTEGER NOT NULL DEFAULT 0,
        notice_window_days INTEGER,
        financial_exposure REAL NOT NULL DEFAULT 0,
        risk_flags TEXT NOT NULL DEFAULT '[]',
        source_message_ids TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        vendor TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        category TEXT NOT NULL DEFAULT 'other',
        date TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'subscription',
        source_message_id TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS spend_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month TEXT NOT NULL UNIQUE,
        total_monthly_recurring REAL NOT NULL DEFAULT 0,
        subscription_count INTEGER NOT NULL DEFAULT 0,
        new_this_month TEXT NOT NULL DEFAULT '[]',
        cancelled_this_month TEXT NOT NULL DEFAULT '[]',
        price_changes_this_month TEXT NOT NULL DEFAULT '[]'
      );

      CREATE INDEX IF NOT EXISTS idx_messages_sender_domain ON messages(sender_domain);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_vendor_domain ON subscriptions(vendor_domain);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_category ON subscriptions(category);
      CREATE INDEX IF NOT EXISTS idx_trials_status ON trials(status);
      CREATE INDEX IF NOT EXISTS idx_trials_end_date ON trials(trial_end_date);
      CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status);
      CREATE INDEX IF NOT EXISTS idx_commitments_status ON commitments(status);
      CREATE INDEX IF NOT EXISTS idx_commitments_type ON commitments(type);
      CREATE INDEX IF NOT EXISTS idx_obligations_contract_type ON obligations(contract_type);
      CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
      CREATE INDEX IF NOT EXISTS idx_payments_vendor ON payments(vendor);
    `);
  }

  // ─── Helper Methods ──────────────────────────────────────────────────────

  private toISOString(date: Date | null | undefined): string | null {
    if (!date) return null;
    return date instanceof Date ? date.toISOString() : String(date);
  }

  private toDate(isoString: string | null | undefined): Date | null {
    if (!isoString) return null;
    return new Date(isoString);
  }

  private toDateRequired(isoString: string): Date {
    return new Date(isoString);
  }

  // ─── Message Methods ─────────────────────────────────────────────────────

  async insertMessage(record: AnalyzedMessage): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO messages (
        message_id, thread_id, timestamp, sender, sender_domain,
        classifications, subscription_signal, commitment_signals,
        contract_signal, refund_signal, trial_signal,
        financial_entities, usage_indicators, urgency_score, summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.messageId,
      record.threadId,
      this.toISOString(record.timestamp),
      record.sender,
      record.senderDomain,
      JSON.stringify(record.classifications),
      record.subscriptionSignal ? JSON.stringify(record.subscriptionSignal) : null,
      JSON.stringify(record.commitmentSignals),
      record.contractSignal ? JSON.stringify(record.contractSignal) : null,
      record.refundSignal ? JSON.stringify(record.refundSignal) : null,
      record.trialSignal ? JSON.stringify(record.trialSignal) : null,
      JSON.stringify(record.financialEntities),
      JSON.stringify(record.usageIndicators),
      record.urgencyScore,
      record.summary
    );
  }

  async getMessage(messageId: string): Promise<AnalyzedMessage | null> {
    const row = this.db.prepare("SELECT * FROM messages WHERE message_id = ?").get(messageId) as any;
    if (!row) return null;
    return this.rowToAnalyzedMessage(row);
  }

  async queryMessages(filter: MessageFilter): Promise<AnalyzedMessage[]> {
    let sql = "SELECT * FROM messages WHERE 1=1";
    const params: any[] = [];

    if (filter.since) {
      sql += " AND timestamp >= ?";
      params.push(this.toISOString(filter.since));
    }
    if (filter.until) {
      sql += " AND timestamp <= ?";
      params.push(this.toISOString(filter.until));
    }
    if (filter.senderDomain) {
      sql += " AND sender_domain = ?";
      params.push(filter.senderDomain);
    }

    sql += " ORDER BY timestamp DESC";

    const rows = this.db.prepare(sql).all(...params) as any[];
    const results = rows.map((row) => this.rowToAnalyzedMessage(row));

    if (filter.classifications && filter.classifications.length > 0) {
      return results.filter((msg) =>
        filter.classifications!.some((c) => msg.classifications.includes(c as any))
      );
    }

    return results;
  }

  private rowToAnalyzedMessage(row: any): AnalyzedMessage {
    return {
      messageId: row.message_id,
      threadId: row.thread_id,
      timestamp: this.toDateRequired(row.timestamp),
      sender: row.sender,
      senderDomain: row.sender_domain,
      classifications: JSON.parse(row.classifications),
      subscriptionSignal: row.subscription_signal ? JSON.parse(row.subscription_signal) : null,
      commitmentSignals: JSON.parse(row.commitment_signals),
      contractSignal: row.contract_signal ? JSON.parse(row.contract_signal) : null,
      refundSignal: row.refund_signal ? JSON.parse(row.refund_signal) : null,
      trialSignal: row.trial_signal ? JSON.parse(row.trial_signal) : null,
      financialEntities: JSON.parse(row.financial_entities),
      usageIndicators: JSON.parse(row.usage_indicators),
      urgencyScore: row.urgency_score,
      summary: row.summary,
    };
  }

  // ─── Subscription Ledger Methods ─────────────────────────────────────────

  async upsertSubscription(sub: SubscriptionRecord): Promise<void> {
    // Deduplication by vendorDomain: if exists, update; otherwise insert
    const existing = this.db
      .prepare("SELECT id FROM subscriptions WHERE vendor_domain = ?")
      .get(sub.vendorDomain) as any;

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE subscriptions SET
          vendor = ?, amount = ?, currency = ?, billing_frequency = ?,
          category = ?, status = ?, usage_score = ?, waste_score = ?,
          last_payment_date = ?, next_renewal_date = ?, auto_renews = ?,
          trial_ends_date = ?, annual_plan_available = ?, annual_plan_amount = ?,
          annual_savings_if_switched = ?, price_change_history = ?,
          source_message_ids = ?, updated_at = ?
        WHERE vendor_domain = ?
      `);
      stmt.run(
        sub.vendor,
        sub.amount,
        sub.currency,
        sub.billingFrequency,
        sub.category,
        sub.status,
        sub.usageScore,
        sub.wasteScore,
        this.toISOString(sub.lastPaymentDate),
        this.toISOString(sub.nextRenewalDate),
        sub.autoRenews ? 1 : 0,
        this.toISOString(sub.trialEndsDate),
        sub.annualPlanAvailable ? 1 : 0,
        sub.annualPlanAmount,
        sub.annualSavingsIfSwitched,
        JSON.stringify(sub.priceChangeHistory),
        JSON.stringify(sub.sourceMessageIds),
        new Date().toISOString(),
        sub.vendorDomain
      );
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO subscriptions (
          id, vendor, vendor_domain, amount, currency, billing_frequency,
          category, status, usage_score, waste_score, first_seen_date,
          last_payment_date, next_renewal_date, auto_renews, trial_ends_date,
          annual_plan_available, annual_plan_amount, annual_savings_if_switched,
          price_change_history, source_message_ids, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        sub.id,
        sub.vendor,
        sub.vendorDomain,
        sub.amount,
        sub.currency,
        sub.billingFrequency,
        sub.category,
        sub.status,
        sub.usageScore,
        sub.wasteScore,
        this.toISOString(sub.firstSeenDate),
        this.toISOString(sub.lastPaymentDate),
        this.toISOString(sub.nextRenewalDate),
        sub.autoRenews ? 1 : 0,
        this.toISOString(sub.trialEndsDate),
        sub.annualPlanAvailable ? 1 : 0,
        sub.annualPlanAmount,
        sub.annualSavingsIfSwitched,
        JSON.stringify(sub.priceChangeHistory),
        JSON.stringify(sub.sourceMessageIds),
        this.toISOString(sub.createdAt),
        this.toISOString(sub.updatedAt)
      );
    }
  }

  async getSubscriptions(filter?: SubscriptionFilter): Promise<SubscriptionRecord[]> {
    let sql = "SELECT * FROM subscriptions WHERE 1=1";
    const params: any[] = [];

    if (filter) {
      if (filter.status) {
        sql += " AND status = ?";
        params.push(filter.status);
      }
      if (filter.category) {
        sql += " AND category = ?";
        params.push(filter.category);
      }
      if (filter.vendor) {
        sql += " AND vendor LIKE ?";
        params.push(`%${filter.vendor}%`);
      }
      if (filter.minAmount !== undefined) {
        sql += " AND amount >= ?";
        params.push(filter.minAmount);
      }
      if (filter.maxAmount !== undefined) {
        sql += " AND amount <= ?";
        params.push(filter.maxAmount);
      }
    }

    sql += " ORDER BY updated_at DESC";
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.rowToSubscription(row));
  }

  async getSubscriptionsByCategory(category: SubscriptionCategory): Promise<SubscriptionRecord[]> {
    return this.getSubscriptions({ category });
  }

  async getActiveSubscriptions(): Promise<SubscriptionRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM subscriptions WHERE status IN ('active-used', 'active-unused', 'renewing-soon', 'trial-active') ORDER BY amount DESC")
      .all() as any[];
    return rows.map((row) => this.rowToSubscription(row));
  }

  async getZombieSubscriptions(): Promise<SubscriptionRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM subscriptions WHERE status = 'zombie' ORDER BY amount DESC")
      .all() as any[];
    return rows.map((row) => this.rowToSubscription(row));
  }

  async getSubscriptionHistory(vendor: string): Promise<PaymentRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM payments WHERE vendor LIKE ? ORDER BY date DESC")
      .all(`%${vendor}%`) as any[];
    return rows.map((row) => this.rowToPayment(row));
  }

  private rowToSubscription(row: any): SubscriptionRecord {
    return {
      id: row.id,
      vendor: row.vendor,
      vendorDomain: row.vendor_domain,
      amount: row.amount,
      currency: row.currency,
      billingFrequency: row.billing_frequency as BillingFrequency,
      category: row.category as SubscriptionCategory,
      status: row.status as SubscriptionStatus,
      usageScore: row.usage_score,
      wasteScore: row.waste_score,
      firstSeenDate: this.toDateRequired(row.first_seen_date),
      lastPaymentDate: this.toDateRequired(row.last_payment_date),
      nextRenewalDate: this.toDate(row.next_renewal_date),
      autoRenews: row.auto_renews === 1,
      trialEndsDate: this.toDate(row.trial_ends_date),
      annualPlanAvailable: row.annual_plan_available === 1,
      annualPlanAmount: row.annual_plan_amount,
      annualSavingsIfSwitched: row.annual_savings_if_switched,
      priceChangeHistory: JSON.parse(row.price_change_history) as PriceChange[],
      sourceMessageIds: JSON.parse(row.source_message_ids) as string[],
      createdAt: this.toDateRequired(row.created_at),
      updatedAt: this.toDateRequired(row.updated_at),
    };
  }

  // ─── Trial Registry Methods ──────────────────────────────────────────────

  async insertTrial(trial: TrialRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO trials (
        id, vendor, vendor_domain, category, trial_start_date, trial_end_date,
        days_remaining, converts_to_amount, converts_to_frequency, auto_converts,
        cancellation_url, status, reminder_scheduled, source_message_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      trial.id,
      trial.vendor,
      trial.vendorDomain,
      trial.category,
      this.toISOString(trial.trialStartDate),
      this.toISOString(trial.trialEndDate),
      trial.daysRemaining,
      trial.convertsToAmount,
      trial.convertsToFrequency,
      trial.autoConverts ? 1 : 0,
      trial.cancellationUrl,
      trial.status,
      trial.reminderScheduled ? 1 : 0,
      trial.sourceMessageId
    );
  }

  async getActiveTrials(): Promise<TrialRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM trials WHERE status IN ('active', 'expiring_soon') ORDER BY trial_end_date ASC")
      .all() as any[];
    return rows.map((row) => this.rowToTrial(row));
  }

  async getExpiringTrials(daysAhead: number): Promise<TrialRecord[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);
    const rows = this.db
      .prepare("SELECT * FROM trials WHERE status IN ('active', 'expiring_soon') AND trial_end_date <= ? ORDER BY trial_end_date ASC")
      .all(cutoff.toISOString()) as any[];
    return rows.map((row) => this.rowToTrial(row));
  }

  private rowToTrial(row: any): TrialRecord {
    return {
      id: row.id,
      vendor: row.vendor,
      vendorDomain: row.vendor_domain,
      category: row.category as SubscriptionCategory,
      trialStartDate: this.toDateRequired(row.trial_start_date),
      trialEndDate: this.toDateRequired(row.trial_end_date),
      daysRemaining: row.days_remaining,
      convertsToAmount: row.converts_to_amount,
      convertsToFrequency: row.converts_to_frequency as BillingFrequency | null,
      autoConverts: row.auto_converts === 1,
      cancellationUrl: row.cancellation_url,
      status: row.status as "active" | "expiring_soon" | "expired" | "cancelled",
      reminderScheduled: row.reminder_scheduled === 1,
      sourceMessageId: row.source_message_id,
    };
  }

  // ─── Refund Tracker Methods ──────────────────────────────────────────────

  async insertRefund(refund: RefundRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO refunds (
        id, vendor, amount, currency, promised_date, expected_by_date,
        actual_received_date, status, days_overdue, original_transaction_date,
        reason, source_message_ids, last_follow_up_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      refund.id,
      refund.vendor,
      refund.amount,
      refund.currency,
      this.toISOString(refund.promisedDate),
      this.toISOString(refund.expectedByDate),
      this.toISOString(refund.actualReceivedDate),
      refund.status,
      refund.daysOverdue,
      this.toISOString(refund.originalTransactionDate),
      refund.reason,
      JSON.stringify(refund.sourceMessageIds),
      this.toISOString(refund.lastFollowUpDate)
    );
  }

  async getPendingRefunds(): Promise<RefundRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM refunds WHERE status IN ('promised', 'processing') ORDER BY expected_by_date ASC")
      .all() as any[];
    return rows.map((row) => this.rowToRefund(row));
  }

  async getOverdueRefunds(): Promise<RefundRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM refunds WHERE status = 'overdue' ORDER BY days_overdue DESC")
      .all() as any[];
    return rows.map((row) => this.rowToRefund(row));
  }

  async markRefundReceived(refundId: string): Promise<void> {
    this.db
      .prepare("UPDATE refunds SET status = 'received', actual_received_date = ? WHERE id = ?")
      .run(new Date().toISOString(), refundId);
  }

  private rowToRefund(row: any): RefundRecord {
    return {
      id: row.id,
      vendor: row.vendor,
      amount: row.amount,
      currency: row.currency,
      promisedDate: this.toDate(row.promised_date),
      expectedByDate: this.toDateRequired(row.expected_by_date),
      actualReceivedDate: this.toDate(row.actual_received_date),
      status: row.status as RefundRecord["status"],
      daysOverdue: row.days_overdue,
      originalTransactionDate: this.toDate(row.original_transaction_date),
      reason: row.reason,
      sourceMessageIds: JSON.parse(row.source_message_ids) as string[],
      lastFollowUpDate: this.toDate(row.last_follow_up_date),
    };
  }

  // ─── Commitment Ledger Methods ───────────────────────────────────────────

  async insertCommitment(commitment: FinancialCommitment): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO commitments (
        id, message_id, thread_id, type, subtype, description, owner,
        counterparty, financial_value, currency, due_date, status,
        is_implicit, confidence, priority, created_at, updated_at,
        fulfilled_at, last_follow_up_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      commitment.id,
      commitment.messageId,
      commitment.threadId,
      commitment.type,
      commitment.subtype,
      commitment.description,
      commitment.owner,
      commitment.counterparty,
      commitment.financialValue,
      commitment.currency,
      this.toISOString(commitment.dueDate),
      commitment.status,
      commitment.isImplicit ? 1 : 0,
      commitment.confidence,
      commitment.priority,
      this.toISOString(commitment.createdAt),
      this.toISOString(commitment.updatedAt),
      this.toISOString(commitment.fulfilledAt),
      this.toISOString(commitment.lastFollowUpDate)
    );
  }

  async updateCommitmentStatus(id: string, status: CommitmentStatus): Promise<void> {
    const now = new Date().toISOString();
    if (status === "fulfilled") {
      this.db
        .prepare("UPDATE commitments SET status = ?, fulfilled_at = ?, updated_at = ? WHERE id = ?")
        .run(status, now, now, id);
    } else {
      this.db
        .prepare("UPDATE commitments SET status = ?, updated_at = ? WHERE id = ?")
        .run(status, now, id);
    }
  }

  async getOpenCommitments(): Promise<FinancialCommitment[]> {
    const rows = this.db
      .prepare("SELECT * FROM commitments WHERE status = 'open' ORDER BY priority DESC, financial_value DESC")
      .all() as any[];
    return rows.map((row) => this.rowToCommitment(row));
  }

  async getOverdueCommitments(): Promise<FinancialCommitment[]> {
    const rows = this.db
      .prepare("SELECT * FROM commitments WHERE status = 'overdue' ORDER BY financial_value DESC")
      .all() as any[];
    return rows.map((row) => this.rowToCommitment(row));
  }

  async getPaymentPromises(): Promise<FinancialCommitment[]> {
    const rows = this.db
      .prepare("SELECT * FROM commitments WHERE subtype = 'payment_promise' AND status IN ('open', 'overdue') ORDER BY due_date ASC")
      .all() as any[];
    return rows.map((row) => this.rowToCommitment(row));
  }

  private rowToCommitment(row: any): FinancialCommitment {
    return {
      id: row.id,
      messageId: row.message_id,
      threadId: row.thread_id,
      type: row.type as "outbound" | "inbound",
      subtype: row.subtype as FinancialCommitment["subtype"],
      description: row.description,
      owner: row.owner,
      counterparty: row.counterparty,
      financialValue: row.financial_value,
      currency: row.currency,
      dueDate: this.toDate(row.due_date),
      status: row.status as CommitmentStatus,
      isImplicit: row.is_implicit === 1,
      confidence: row.confidence,
      priority: row.priority,
      createdAt: this.toDateRequired(row.created_at),
      updatedAt: this.toDateRequired(row.updated_at),
      fulfilledAt: this.toDate(row.fulfilled_at),
      lastFollowUpDate: this.toDate(row.last_follow_up_date),
    };
  }


  // ─── Obligation Ledger Methods ───────────────────────────────────────────

  async upsertObligation(obligation: FinancialObligation): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO obligations (
        id, contract_name, contract_type, parties, total_value, currency,
        recurring_amount, payment_frequency, key_dates, penalty_clauses,
        auto_renews, notice_window_days, financial_exposure, risk_flags,
        source_message_ids, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      obligation.id,
      obligation.contractName,
      obligation.contractType,
      JSON.stringify(obligation.parties),
      obligation.totalValue,
      obligation.currency,
      obligation.recurringAmount,
      obligation.paymentFrequency,
      JSON.stringify(obligation.keyDates.map((d) => ({
        ...d,
        date: this.toISOString(d.date),
      }))),
      JSON.stringify(obligation.penaltyClauses),
      obligation.autoRenews ? 1 : 0,
      obligation.noticeWindowDays,
      obligation.financialExposure,
      JSON.stringify(obligation.riskFlags),
      JSON.stringify(obligation.sourceMessageIds),
      this.toISOString(obligation.createdAt),
      this.toISOString(obligation.updatedAt)
    );
  }

  async getObligations(filter?: ObligationFilter): Promise<FinancialObligation[]> {
    let sql = "SELECT * FROM obligations WHERE 1=1";
    const params: any[] = [];

    if (filter) {
      if (filter.contractType) {
        sql += " AND contract_type = ?";
        params.push(filter.contractType);
      }
      if (filter.autoRenews !== undefined) {
        sql += " AND auto_renews = ?";
        params.push(filter.autoRenews ? 1 : 0);
      }
    }

    sql += " ORDER BY financial_exposure DESC";
    const rows = this.db.prepare(sql).all(...params) as any[];
    const results = rows.map((row) => this.rowToObligation(row));

    if (filter?.hasRiskFlags) {
      return results.filter((o) => o.riskFlags.length > 0);
    }

    return results;
  }

  async getUpcomingDeadlines(daysAhead: number): Promise<ObligationDeadline[]> {
    const now = new Date();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);

    const obligations = await this.getObligations();
    const deadlines: ObligationDeadline[] = [];

    for (const obligation of obligations) {
      for (const deadline of obligation.keyDates) {
        const deadlineDate = deadline.date instanceof Date ? deadline.date : new Date(deadline.date as any);
        if (deadlineDate >= now && deadlineDate <= cutoff) {
          deadlines.push(deadline);
        }
      }
    }

    return deadlines.sort((a, b) => {
      const dateA = a.date instanceof Date ? a.date.getTime() : new Date(a.date as any).getTime();
      const dateB = b.date instanceof Date ? b.date.getTime() : new Date(b.date as any).getTime();
      return dateA - dateB;
    });
  }

  private rowToObligation(row: any): FinancialObligation {
    const keyDatesRaw = JSON.parse(row.key_dates) as any[];
    const keyDates: ObligationDeadline[] = keyDatesRaw.map((d: any) => ({
      ...d,
      date: new Date(d.date),
    }));

    return {
      id: row.id,
      contractName: row.contract_name,
      contractType: row.contract_type as ContractType,
      parties: JSON.parse(row.parties) as string[],
      totalValue: row.total_value,
      currency: row.currency,
      recurringAmount: row.recurring_amount,
      paymentFrequency: row.payment_frequency as BillingFrequency | null,
      keyDates,
      penaltyClauses: JSON.parse(row.penalty_clauses) as PenaltyClause[],
      autoRenews: row.auto_renews === 1,
      noticeWindowDays: row.notice_window_days,
      financialExposure: row.financial_exposure,
      riskFlags: JSON.parse(row.risk_flags) as RiskFlag[],
      sourceMessageIds: JSON.parse(row.source_message_ids) as string[],
      createdAt: this.toDateRequired(row.created_at),
      updatedAt: this.toDateRequired(row.updated_at),
    };
  }

  // ─── Payment History Methods ─────────────────────────────────────────────

  async insertPayment(payment: PaymentRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO payments (
        id, vendor, amount, currency, category, date, type, source_message_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      payment.id,
      payment.vendor,
      payment.amount,
      payment.currency,
      payment.category,
      this.toISOString(payment.date),
      payment.type,
      payment.sourceMessageId
    );
  }

  async getPaymentHistory(range: DateRange): Promise<PaymentRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM payments WHERE date >= ? AND date <= ? ORDER BY date DESC")
      .all(this.toISOString(range.start), this.toISOString(range.end)) as any[];
    return rows.map((row) => this.rowToPayment(row));
  }

  async getMonthlySpendSummary(months: number): Promise<MonthlySpend[]> {
    const results: MonthlySpend[] = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
      const monthKey = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`;

      const rows = this.db
        .prepare("SELECT * FROM payments WHERE date >= ? AND date <= ? AND type != 'refund'")
        .all(monthStart.toISOString(), monthEnd.toISOString()) as any[];

      const payments = rows.map((row) => this.rowToPayment(row));
      const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);

      const byCategory = {} as Record<SubscriptionCategory, number>;
      for (const payment of payments) {
        byCategory[payment.category] = (byCategory[payment.category] || 0) + payment.amount;
      }

      // Count unique vendors for subscription count
      const uniqueVendors = new Set(payments.filter((p) => p.type === "subscription").map((p) => p.vendor));

      results.push({
        month: monthKey,
        totalAmount,
        byCategory,
        subscriptionCount: uniqueVendors.size,
      });
    }

    return results;
  }

  async getSpendByCategory(range: DateRange): Promise<CategorySpend[]> {
    const rows = this.db
      .prepare("SELECT * FROM payments WHERE date >= ? AND date <= ? AND type != 'refund'")
      .all(this.toISOString(range.start), this.toISOString(range.end)) as any[];

    const payments = rows.map((row) => this.rowToPayment(row));
    const totalSpend = payments.reduce((sum, p) => sum + p.amount, 0);

    const categoryMap = new Map<SubscriptionCategory, { total: number; vendors: Set<string> }>();

    for (const payment of payments) {
      const existing = categoryMap.get(payment.category) || { total: 0, vendors: new Set<string>() };
      existing.total += payment.amount;
      existing.vendors.add(payment.vendor);
      categoryMap.set(payment.category, existing);
    }

    const results: CategorySpend[] = [];
    for (const [category, data] of categoryMap.entries()) {
      results.push({
        category,
        totalAmount: data.total,
        percentageOfTotal: totalSpend > 0 ? (data.total / totalSpend) * 100 : 0,
        subscriptionCount: data.vendors.size,
        trend: "stable", // Trend calculation would require historical data comparison
      });
    }

    return results.sort((a, b) => b.totalAmount - a.totalAmount);
  }

  async getTotalRecurringSpend(): Promise<RecurringSpendSnapshot[]> {
    const rows = this.db
      .prepare("SELECT * FROM spend_snapshots ORDER BY month ASC")
      .all() as any[];

    return rows.map((row) => ({
      month: row.month,
      totalMonthlyRecurring: row.total_monthly_recurring,
      subscriptionCount: row.subscription_count,
      newThisMonth: JSON.parse(row.new_this_month) as string[],
      cancelledThisMonth: JSON.parse(row.cancelled_this_month) as string[],
      priceChangesThisMonth: JSON.parse(row.price_changes_this_month) as PriceChange[],
    }));
  }

  private rowToPayment(row: any): PaymentRecord {
    return {
      id: row.id,
      vendor: row.vendor,
      amount: row.amount,
      currency: row.currency,
      category: row.category as SubscriptionCategory,
      date: this.toDateRequired(row.date),
      type: row.type as PaymentRecord["type"],
      sourceMessageId: row.source_message_id,
    };
  }

  // ─── Cross-Cutting Query Methods ─────────────────────────────────────────

  async getFinancialCalendar(range: DateRange): Promise<CalendarEntry[]> {
    const entries: CalendarEntry[] = [];
    const startISO = this.toISOString(range.start)!;
    const endISO = this.toISOString(range.end)!;

    // Subscription renewals
    const renewals = this.db
      .prepare("SELECT * FROM subscriptions WHERE next_renewal_date >= ? AND next_renewal_date <= ?")
      .all(startISO, endISO) as any[];

    for (const row of renewals) {
      entries.push({
        date: this.toDateRequired(row.next_renewal_date),
        type: "renewal",
        vendor: row.vendor,
        amount: row.amount,
        description: `${row.vendor} subscription renewal`,
        featureArea: "renewals" as FeatureArea,
      });
    }

    // Trial expiries
    const trials = this.db
      .prepare("SELECT * FROM trials WHERE trial_end_date >= ? AND trial_end_date <= ? AND status IN ('active', 'expiring_soon')")
      .all(startISO, endISO) as any[];

    for (const row of trials) {
      entries.push({
        date: this.toDateRequired(row.trial_end_date),
        type: "trial_expiry",
        vendor: row.vendor,
        amount: row.converts_to_amount,
        description: `${row.vendor} trial expires`,
        featureArea: "trials" as FeatureArea,
      });
    }

    // Expected refunds
    const refunds = this.db
      .prepare("SELECT * FROM refunds WHERE expected_by_date >= ? AND expected_by_date <= ? AND status IN ('promised', 'processing')")
      .all(startISO, endISO) as any[];

    for (const row of refunds) {
      entries.push({
        date: this.toDateRequired(row.expected_by_date),
        type: "refund_expected",
        vendor: row.vendor,
        amount: row.amount,
        description: `Expected refund from ${row.vendor}`,
        featureArea: "refunds" as FeatureArea,
      });
    }

    // Commitment due dates
    const commitments = this.db
      .prepare("SELECT * FROM commitments WHERE due_date >= ? AND due_date <= ? AND status = 'open'")
      .all(startISO, endISO) as any[];

    for (const row of commitments) {
      entries.push({
        date: this.toDateRequired(row.due_date),
        type: "commitment_due",
        vendor: row.counterparty,
        amount: row.financial_value,
        description: row.description,
        featureArea: "commitments" as FeatureArea,
      });
    }

    // Obligation deadlines
    const obligations = await this.getObligations();
    for (const obligation of obligations) {
      for (const deadline of obligation.keyDates) {
        const deadlineDate = deadline.date instanceof Date ? deadline.date : new Date(deadline.date as any);
        if (deadlineDate >= range.start && deadlineDate <= range.end) {
          entries.push({
            date: deadlineDate,
            type: deadline.type === "payment_due" ? "payment_due" :
                  deadline.type === "renewal" ? "renewal" :
                  deadline.type === "expiry" ? "contract_expiry" :
                  "notice_deadline",
            vendor: obligation.parties[0] || obligation.contractName,
            amount: deadline.amount,
            description: deadline.description,
            featureArea: "obligations" as FeatureArea,
          });
        }
      }
    }

    return entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  async searchByVendor(vendor: string): Promise<VendorProfile> {
    const subscriptions = this.db
      .prepare("SELECT * FROM subscriptions WHERE vendor LIKE ? OR vendor_domain LIKE ?")
      .all(`%${vendor}%`, `%${vendor}%`) as any[];

    const payments = this.db
      .prepare("SELECT * FROM payments WHERE vendor LIKE ?")
      .all(`%${vendor}%`) as any[];

    const trials = this.db
      .prepare("SELECT * FROM trials WHERE vendor LIKE ? OR vendor_domain LIKE ?")
      .all(`%${vendor}%`, `%${vendor}%`) as any[];

    const refunds = this.db
      .prepare("SELECT * FROM refunds WHERE vendor LIKE ?")
      .all(`%${vendor}%`) as any[];

    const commitments = this.db
      .prepare("SELECT * FROM commitments WHERE counterparty LIKE ? OR owner LIKE ?")
      .all(`%${vendor}%`, `%${vendor}%`) as any[];

    const obligations = this.db
      .prepare("SELECT * FROM obligations WHERE contract_name LIKE ?")
      .all(`%${vendor}%`) as any[];

    const subRecords = subscriptions.map((r: any) => this.rowToSubscription(r));
    const payRecords = payments.map((r: any) => this.rowToPayment(r));
    const trialRecords = trials.map((r: any) => this.rowToTrial(r));
    const refundRecords = refunds.map((r: any) => this.rowToRefund(r));
    const commitmentRecords = commitments.map((r: any) => this.rowToCommitment(r));
    const obligationRecords = obligations.map((r: any) => this.rowToObligation(r));

    const totalSpent = payRecords
      .filter((p) => p.type !== "refund")
      .reduce((sum, p) => sum + p.amount, 0);

    const allDates = [
      ...payRecords.map((p) => p.date),
      ...subRecords.map((s) => s.firstSeenDate),
    ].filter(Boolean);

    const firstInteraction = allDates.length > 0
      ? new Date(Math.min(...allDates.map((d) => d.getTime())))
      : null;
    const lastInteraction = allDates.length > 0
      ? new Date(Math.max(...allDates.map((d) => d.getTime())))
      : null;

    return {
      vendor,
      vendorDomain: subRecords[0]?.vendorDomain || "",
      subscriptions: subRecords,
      payments: payRecords,
      trials: trialRecords,
      refunds: refundRecords,
      commitments: commitmentRecords,
      obligations: obligationRecords,
      totalSpent,
      firstInteraction,
      lastInteraction,
    };
  }

  async getDigestData(period: "daily" | "weekly"): Promise<DigestData> {
    const now = new Date();
    const periodStart = new Date(now);
    if (period === "daily") {
      periodStart.setDate(periodStart.getDate() - 1);
    } else {
      periodStart.setDate(periodStart.getDate() - 7);
    }

    // Total recurring spend from active subscriptions
    const activeRows = this.db
      .prepare("SELECT * FROM subscriptions WHERE status IN ('active-used', 'active-unused', 'renewing-soon', 'trial-active', 'zombie')")
      .all() as any[];
    const activeSubs = activeRows.map((r: any) => this.rowToSubscription(r));
    const totalRecurringSpend = activeSubs.reduce((sum, s) => {
      return sum + this.normalizeToMonthly(s.amount, s.billingFrequency);
    }, 0);

    // Spend change: compare current month vs previous month
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const currentPayments = this.db
      .prepare("SELECT SUM(amount) as total FROM payments WHERE date >= ? AND type != 'refund'")
      .get(currentMonthStart.toISOString()) as any;
    const prevPayments = this.db
      .prepare("SELECT SUM(amount) as total FROM payments WHERE date >= ? AND date <= ? AND type != 'refund'")
      .get(prevMonthStart.toISOString(), prevMonthEnd.toISOString()) as any;

    const currentTotal = currentPayments?.total || 0;
    const prevTotal = prevPayments?.total || 0;
    const spendChange = prevTotal > 0 ? ((currentTotal - prevTotal) / prevTotal) * 100 : 0;

    // Upcoming renewals within the period
    const renewalCutoff = new Date(now);
    renewalCutoff.setDate(renewalCutoff.getDate() + (period === "daily" ? 1 : 7));
    const renewalRows = this.db
      .prepare("SELECT * FROM subscriptions WHERE next_renewal_date >= ? AND next_renewal_date <= ?")
      .all(now.toISOString(), renewalCutoff.toISOString()) as any[];
    const upcomingRenewals = renewalRows.map((r: any) => this.rowToSubscription(r));

    // Expiring trials
    const expiringTrials = await this.getExpiringTrials(period === "daily" ? 3 : 7);

    // Overdue refunds
    const overdueRefunds = await this.getOverdueRefunds();

    // Overdue commitments
    const overdueCommitments = await this.getOverdueCommitments();

    // Recent payments
    const recentPaymentRows = this.db
      .prepare("SELECT * FROM payments WHERE date >= ? ORDER BY date DESC LIMIT 10")
      .all(periodStart.toISOString()) as any[];
    const recentPayments = recentPaymentRows.map((r: any) => this.rowToPayment(r));

    return {
      totalRecurringSpend,
      spendChangeFromLastPeriod: spendChange,
      totalPotentialSavings: 0, // Calculated by intelligence engine
      upcomingRenewals,
      expiringTrials,
      overdueRefunds,
      overdueCommitments,
      recentPayments,
    };
  }

  // ─── Utility Methods ─────────────────────────────────────────────────────

  private normalizeToMonthly(amount: number, frequency: BillingFrequency): number {
    switch (frequency) {
      case "weekly": return amount * 4.33;
      case "monthly": return amount;
      case "quarterly": return amount / 3;
      case "semi-annual": return amount / 6;
      case "annual": return amount / 12;
      case "one-time": return 0;
      default: return amount;
    }
  }

  /** Close the database connection */
  close(): void {
    this.db.close();
  }
}
