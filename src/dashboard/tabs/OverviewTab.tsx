import React, { useEffect, useState, useCallback } from 'react';
import type { PrioritizedItem, SmartDigest, DigestAlert } from '../../types/outputs';
import { PriorityCard } from '../components/PriorityCard';
import { ActionButton } from '../components/ActionButton';

/**
 * OverviewTab — Primary dashboard view displaying the priority feed
 * with urgency-ranked cards and a smart digest summary.
 *
 * Requirements: 19.1, 18.6, 19.9
 */

interface OverviewTabProps {
  /** Fetches the priority feed items ranked by urgency */
  getPriorityFeed: (limit: number) => Promise<PrioritizedItem[]>;
  /** Fetches the smart digest summary */
  getSmartDigest: (period: 'daily' | 'weekly') => Promise<SmartDigest>;
  /** Dismisses an item and records dismissal for priority adjustment */
  dismissItem: (itemId: string) => Promise<void>;
  /** Handles one-click actions from digest or priority cards */
  onAction?: (actionType: string, targetId: string) => void;
}

type LoadingState = 'idle' | 'loading' | 'loaded' | 'error';

export function OverviewTab({
  getPriorityFeed,
  getSmartDigest,
  dismissItem,
  onAction,
}: OverviewTabProps) {
  const [feedItems, setFeedItems] = useState<PrioritizedItem[]>([]);
  const [digest, setDigest] = useState<SmartDigest | null>(null);
  const [feedState, setFeedState] = useState<LoadingState>('idle');
  const [digestState, setDigestState] = useState<LoadingState>('idle');
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());

  // Fetch priority feed
  useEffect(() => {
    let cancelled = false;
    setFeedState('loading');

    getPriorityFeed(20)
      .then((items) => {
        if (!cancelled) {
          setFeedItems(items);
          setFeedState('loaded');
        }
      })
      .catch(() => {
        if (!cancelled) setFeedState('error');
      });

    return () => { cancelled = true; };
  }, [getPriorityFeed]);

  // Fetch smart digest
  useEffect(() => {
    let cancelled = false;
    setDigestState('loading');

    getSmartDigest('daily')
      .then((data) => {
        if (!cancelled) {
          setDigest(data);
          setDigestState('loaded');
        }
      })
      .catch(() => {
        if (!cancelled) setDigestState('error');
      });

    return () => { cancelled = true; };
  }, [getSmartDigest]);

  // Dismiss handler — calls API and removes from local state
  const handleDismiss = useCallback(
    async (itemId: string) => {
      setDismissingIds((prev) => new Set(prev).add(itemId));
      try {
        await dismissItem(itemId);
        setFeedItems((prev) => prev.filter((item) => item.id !== itemId));
      } finally {
        setDismissingIds((prev) => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
      }
    },
    [dismissItem]
  );

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Overview</h2>
        <p className="mt-1 text-sm text-gray-500">
          Your priority feed and daily financial digest at a glance.
        </p>
      </div>

      {/* Smart Digest Summary */}
      <DigestSummarySection digest={digest} state={digestState} onAction={onAction} />

      {/* Priority Feed */}
      <section aria-label="Priority Feed">
        <h3 className="text-lg font-medium text-gray-900 mb-3">Priority Feed</h3>

        {feedState === 'loading' && <FeedSkeleton />}

        {feedState === 'error' && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
            Failed to load priority feed. Please try again later.
          </div>
        )}

        {feedState === 'loaded' && feedItems.length === 0 && (
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-6 text-center">
            <svg
              className="mx-auto h-10 w-10 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="mt-2 text-sm text-gray-600">
              All caught up! No priority items right now.
            </p>
          </div>
        )}

        {feedState === 'loaded' && feedItems.length > 0 && (
          <div className="space-y-3">
            {feedItems.map((item) => (
              <div
                key={item.id}
                className={dismissingIds.has(item.id) ? 'opacity-50 pointer-events-none' : ''}
              >
                <PriorityCard
                  item={item}
                  onAction={onAction}
                  onDismiss={handleDismiss}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Digest Summary Sub-Component ────────────────────────────────────────────

function DigestSummarySection({
  digest,
  state,
  onAction,
}: {
  digest: SmartDigest | null;
  state: LoadingState;
  onAction?: (actionType: string, targetId: string) => void;
}) {
  if (state === 'loading') {
    return <DigestSkeleton />;
  }

  if (state === 'error') {
    return (
      <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4 text-sm text-yellow-700">
        Unable to load your daily digest.
      </div>
    );
  }

  if (!digest) return null;

  return (
    <section aria-label="Smart Digest" className="space-y-4">
      <h3 className="text-lg font-medium text-gray-900">Daily Digest</h3>

      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Total Recurring Spend"
          value={formatCurrency(digest.totalRecurringSpend)}
          subtext={formatSpendChange(digest.spendChangeFromLastPeriod)}
          subtextColor={digest.spendChangeFromLastPeriod > 0 ? 'text-red-600' : 'text-green-600'}
        />
        <StatCard
          label="Spend Change"
          value={formatPercentChange(digest.spendChangeFromLastPeriod, digest.totalRecurringSpend)}
          subtext="vs last period"
        />
        <StatCard
          label="Potential Savings"
          value={formatCurrency(digest.totalPotentialSavings)}
          subtext="identified opportunities"
          subtextColor="text-green-600"
        />
      </div>

      {/* Top alerts with one-click actions */}
      {digest.topAlerts.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700">Top Alerts</h4>
          <div className="space-y-2">
            {digest.topAlerts.map((alert, idx) => (
              <AlertRow key={idx} alert={alert} onAction={onAction} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Alert Row ───────────────────────────────────────────────────────────────

function AlertRow({
  alert,
  onAction,
}: {
  alert: DigestAlert;
  onAction?: (actionType: string, targetId: string) => void;
}) {
  const urgencyColors: Record<string, string> = {
    critical: 'bg-red-50 border-red-200',
    high: 'bg-orange-50 border-orange-200',
    medium: 'bg-yellow-50 border-yellow-200',
    low: 'bg-gray-50 border-gray-200',
  };

  return (
    <div
      className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${urgencyColors[alert.urgency] ?? 'bg-gray-50 border-gray-200'}`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{alert.title}</p>
        <p className="text-xs text-gray-600 truncate">{alert.description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {alert.financialImpact > 0 && (
          <span className="text-xs font-medium text-gray-700">
            {formatCurrency(alert.financialImpact)}
          </span>
        )}
        <ActionButton
          label={alert.action.label}
          actionType={alert.action.type}
          onClick={() => onAction?.(alert.action.type, alert.action.targetId)}
          variant="primary"
        />
      </div>
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  subtext,
  subtextColor = 'text-gray-500',
}: {
  label: string;
  value: string;
  subtext?: string;
  subtextColor?: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
      {subtext && <p className={`mt-0.5 text-xs ${subtextColor}`}>{subtext}</p>}
    </div>
  );
}

// ─── Loading Skeletons ───────────────────────────────────────────────────────

function DigestSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-5 w-32 bg-gray-200 rounded" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
            <div className="h-3 w-24 bg-gray-200 rounded" />
            <div className="h-6 w-20 bg-gray-200 rounded" />
            <div className="h-3 w-16 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-lg border border-gray-200 border-l-4 border-l-gray-300 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-4 w-16 bg-gray-200 rounded" />
            <div className="h-3 w-20 bg-gray-200 rounded" />
          </div>
          <div className="h-4 w-3/4 bg-gray-200 rounded" />
          <div className="h-3 w-full bg-gray-200 rounded" />
          <div className="flex gap-2">
            <div className="h-7 w-20 bg-gray-200 rounded" />
            <div className="h-7 w-16 bg-gray-200 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Formatting Helpers ──────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatSpendChange(change: number): string {
  const sign = change > 0 ? '+' : '';
  return `${sign}${formatCurrency(change)} from last period`;
}

function formatPercentChange(change: number, total: number): string {
  // Calculate % change relative to previous period (total - change)
  const previousTotal = total - change;
  if (previousTotal === 0) return change > 0 ? '+100%' : '0%';
  const pct = (change / previousTotal) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}
