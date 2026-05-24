/**
 * HTTP API Client — Bridges the frontend dashboard to the backend REST API.
 *
 * Each method calls the corresponding Express endpoint and returns typed data.
 */

import type { SubscriptionRecord, TrialRecord, RefundRecord, FinancialCommitment, FinancialObligation } from '../types/models';
import type { MonthlySpend, PrioritizedItem, SmartDigest, RecurringSpendSnapshot, CategorySpend } from '../types/outputs';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubscriptionOverviewData {
  totalSubscriptions: number;
  totalMonthlyRecurring: number;
  totalAnnualRecurring: number;
  activeCount: number;
  zombieCount: number;
  trialCount: number;
  priceIncreasedCount: number;
  renewingSoonCount: number;
  subscriptions: SubscriptionRecord[];
}

export interface CommitmentsData {
  open: FinancialCommitment[];
  overdue: FinancialCommitment[];
}

export interface PipelineStatus {
  running: boolean;
  lastResult: {
    success: boolean;
    durationMs: number;
    messagesFetched: number;
    messagesClassified: number;
    entitiesPersisted: number;
    warnings: string[];
    error?: string;
  } | null;
}

// ─── API Client ───────────────────────────────────────────────────────────────

export class ApiClient {
  constructor(private baseUrl: string = 'http://localhost:3001') {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  async getAuthStatus(): Promise<{ connected: boolean; expired?: boolean }> {
    return this.get('/auth/status');
  }

  // ─── Pipeline ─────────────────────────────────────────────────────────────

  async getPipelineStatus(): Promise<PipelineStatus> {
    return this.get('/api/pipeline/status');
  }

  async runPipeline(): Promise<{ success: boolean; error?: string }> {
    return this.post('/api/pipeline/run');
  }

  // ─── Subscriptions ────────────────────────────────────────────────────────

  async getSubscriptions(): Promise<SubscriptionRecord[]> {
    return this.get('/api/subscriptions');
  }

  async getZombieSubscriptions(): Promise<SubscriptionRecord[]> {
    return this.get('/api/subscriptions/zombies');
  }

  // ─── Trials ───────────────────────────────────────────────────────────────

  async getTrials(): Promise<TrialRecord[]> {
    return this.get('/api/trials');
  }

  // ─── Refunds ──────────────────────────────────────────────────────────────

  async getPendingRefunds(): Promise<RefundRecord[]> {
    return this.get('/api/refunds/pending');
  }

  async getOverdueRefunds(): Promise<RefundRecord[]> {
    return this.get('/api/refunds/overdue');
  }

  async markRefundReceived(refundId: string): Promise<void> {
    await this.post(`/api/refunds/${refundId}/received`);
  }

  // ─── Commitments ──────────────────────────────────────────────────────────

  async getCommitments(): Promise<CommitmentsData> {
    return this.get('/api/commitments');
  }

  // ─── Obligations ──────────────────────────────────────────────────────────

  async getObligations(): Promise<FinancialObligation[]> {
    return this.get('/api/obligations');
  }

  // ─── Spend / Patterns ─────────────────────────────────────────────────────

  async getMonthlySpend(months = 6): Promise<MonthlySpend[]> {
    return this.get(`/api/spend/monthly?months=${months}`);
  }

  async getSpendByCategory(): Promise<CategorySpend[]> {
    return this.get('/api/spend/categories');
  }

  async getRecurringSpendTimeline(): Promise<RecurringSpendSnapshot[]> {
    return this.get('/api/spend/recurring');
  }

  // ─── Digest ───────────────────────────────────────────────────────────────

  async getDigest(): Promise<SmartDigest | null> {
    try {
      return await this.get('/api/digest');
    } catch {
      return null;
    }
  }

  // ─── Priority Feed ────────────────────────────────────────────────────────

  async getPriorityFeed(limit = 20): Promise<PrioritizedItem[]> {
    return this.get(`/api/priority-feed?limit=${limit}`);
  }
}
