import React, { useState } from 'react';
import { ActionButton } from '../components/ActionButton';
import { AlertBadge } from '../components/AlertBadge';
import type {
  SpendAnalysis,
  MoMComparison,
  CategorySpend,
  MonthlySpend,
  CreepAlert,
  RecurringSpendSnapshot,
} from '../../types/outputs';

/**
 * PatternsTab — Displays spend trends, month-over-month comparison,
 * category breakdown, creep alerts, and recurring spend timeline.
 *
 * Requirement 19.5: Spend trend charts, MoM comparison, category breakdown,
 * creep alerts with acknowledge action, recurring spend timeline.
 */

// ─── Demo Data ───────────────────────────────────────────────────────────────

const demoMonthlyTotals: MonthlySpend[] = [
  { month: '2025-07', totalAmount: 312, byCategory: {} as any, subscriptionCount: 8 },
  { month: '2025-08', totalAmount: 345, byCategory: {} as any, subscriptionCount: 9 },
  { month: '2025-09', totalAmount: 328, byCategory: {} as any, subscriptionCount: 9 },
  { month: '2025-10', totalAmount: 389, byCategory: {} as any, subscriptionCount: 10 },
  { month: '2025-11', totalAmount: 412, byCategory: {} as any, subscriptionCount: 11 },
  { month: '2025-12', totalAmount: 435, byCategory: {} as any, subscriptionCount: 12 },
];

const demoMoM: MoMComparison = {
  currentMonth: 435,
  previousMonth: 412,
  absoluteChange: 23,
  percentageChange: 5.58,
  direction: 'increasing',
};

const demoCategoryBreakdown: CategorySpend[] = [
  { category: 'productivity', totalAmount: 145, percentageOfTotal: 33.3, subscriptionCount: 4, trend: 'stable' },
  { category: 'video-streaming', totalAmount: 89, percentageOfTotal: 20.5, subscriptionCount: 3, trend: 'increasing' },
  { category: 'cloud-storage', totalAmount: 65, percentageOfTotal: 14.9, subscriptionCount: 2, trend: 'stable' },
  { category: 'software-saas', totalAmount: 56, percentageOfTotal: 12.9, subscriptionCount: 2, trend: 'decreasing' },
  { category: 'utilities', totalAmount: 45, percentageOfTotal: 10.3, subscriptionCount: 1, trend: 'stable' },
  { category: 'other', totalAmount: 35, percentageOfTotal: 8.1, subscriptionCount: 1, trend: 'stable' },
];

const demoCreepAlert: CreepAlert = {
  id: 'creep-001',
  detectedAt: new Date('2025-12-15'),
  periodMonths: 6,
  startingMonthlySpend: 312,
  currentMonthlySpend: 435,
  absoluteIncrease: 123,
  percentageIncrease: 39.4,
  newSubscriptionsAdded: [],
  priceIncreasesDetected: [],
  insight:
    'Your monthly subscription spend has increased by 39.4% over the last 6 months, from $312 to $435. This is driven by 4 new subscriptions and 2 price increases.',
  acknowledged: false,
};

const demoRecurringTimeline: RecurringSpendSnapshot[] = [
  { month: '2025-10', totalMonthlyRecurring: 389, subscriptionCount: 10, newThisMonth: ['Notion'], cancelledThisMonth: [], priceChangesThisMonth: [] },
  { month: '2025-11', totalMonthlyRecurring: 412, subscriptionCount: 11, newThisMonth: ['Linear'], cancelledThisMonth: [], priceChangesThisMonth: [] },
  { month: '2025-12', totalMonthlyRecurring: 435, subscriptionCount: 12, newThisMonth: ['Figma'], cancelledThisMonth: [], priceChangesThisMonth: [] },
];

// ─── Component ───────────────────────────────────────────────────────────────

export function PatternsTab() {
  const [creepAcknowledged, setCreepAcknowledged] = useState(false);

  const monthlyTotals = demoMonthlyTotals;
  const mom = demoMoM;
  const categoryBreakdown = demoCategoryBreakdown;
  const creepAlert = demoCreepAlert;
  const recurringTimeline = demoRecurringTimeline;

  const maxMonthlyAmount = Math.max(...monthlyTotals.map((m) => m.totalAmount));

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-900">Patterns — Trends & Creep Alerts</h2>

      {/* Spend Trends Section */}
      <SpendTrendsSection monthlyTotals={monthlyTotals} maxAmount={maxMonthlyAmount} />

      {/* Month-over-Month Section */}
      <MoMSection mom={mom} />

      {/* Category Breakdown Section */}
      <CategoryBreakdownSection categories={categoryBreakdown} />

      {/* Creep Alerts Section */}
      <CreepAlertSection
        alert={creepAlert}
        acknowledged={creepAcknowledged}
        onAcknowledge={() => setCreepAcknowledged(true)}
      />

      {/* Recurring Spend Timeline Section */}
      <RecurringTimelineSection snapshots={recurringTimeline} />
    </div>
  );
}

// ─── Spend Trends ────────────────────────────────────────────────────────────

function SpendTrendsSection({
  monthlyTotals,
  maxAmount,
}: {
  monthlyTotals: MonthlySpend[];
  maxAmount: number;
}) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Spend Trends</h3>
      <div className="flex items-end gap-2 h-40">
        {monthlyTotals.map((month) => {
          const heightPercent = maxAmount > 0 ? (month.totalAmount / maxAmount) * 100 : 0;
          const monthLabel = formatMonthShort(month.month);
          return (
            <div key={month.month} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] text-gray-500 font-medium">
                ${month.totalAmount}
              </span>
              <div className="w-full flex justify-center">
                <div
                  className="w-8 bg-brand-500 rounded-t-md transition-all"
                  style={{ height: `${heightPercent}%`, minHeight: '4px' }}
                  title={`${monthLabel}: $${month.totalAmount}`}
                />
              </div>
              <span className="text-[10px] text-gray-400">{monthLabel}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Month-over-Month ────────────────────────────────────────────────────────

function MoMSection({ mom }: { mom: MoMComparison }) {
  const isIncrease = mom.direction === 'increasing';
  const isDecrease = mom.direction === 'decreasing';
  const changeColor = isDecrease
    ? 'text-green-600'
    : isIncrease
      ? 'text-red-600'
      : 'text-gray-600';
  const changeBg = isDecrease
    ? 'bg-green-50'
    : isIncrease
      ? 'bg-red-50'
      : 'bg-gray-50';
  const arrow = isIncrease ? '↑' : isDecrease ? '↓' : '→';

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Month-over-Month</h3>
      <div className="grid grid-cols-3 gap-4">
        <div className="text-center">
          <p className="text-xs text-gray-500 mb-1">Previous Month</p>
          <p className="text-lg font-semibold text-gray-900">${mom.previousMonth.toFixed(0)}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-500 mb-1">Current Month</p>
          <p className="text-lg font-semibold text-gray-900">${mom.currentMonth.toFixed(0)}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-500 mb-1">Change</p>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm font-medium ${changeBg} ${changeColor}`}>
            {arrow} {Math.abs(mom.percentageChange).toFixed(1)}%
          </span>
        </div>
      </div>
    </section>
  );
}

// ─── Category Breakdown ──────────────────────────────────────────────────────

function CategoryBreakdownSection({ categories }: { categories: CategorySpend[] }) {
  const categoryColors: Record<string, string> = {
    productivity: 'bg-blue-500',
    'video-streaming': 'bg-purple-500',
    'music-streaming': 'bg-pink-500',
    'cloud-storage': 'bg-cyan-500',
    'software-saas': 'bg-amber-500',
    utilities: 'bg-green-500',
    other: 'bg-gray-400',
    'security-vpn': 'bg-red-500',
    education: 'bg-indigo-500',
    fitness: 'bg-emerald-500',
    'news-media': 'bg-orange-500',
    'food-delivery': 'bg-yellow-500',
    gaming: 'bg-violet-500',
    insurance: 'bg-rose-500',
  };

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Category Breakdown</h3>
      <div className="space-y-3">
        {categories.map((cat) => {
          const barColor = categoryColors[cat.category] ?? 'bg-gray-400';
          return (
            <div key={cat.category}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-700 capitalize">
                  {cat.category.replace(/-/g, ' ')}
                </span>
                <span className="text-xs text-gray-500">
                  ${cat.totalAmount} ({cat.percentageOfTotal.toFixed(1)}%)
                </span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${barColor}`}
                  style={{ width: `${cat.percentageOfTotal}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Creep Alerts ────────────────────────────────────────────────────────────

function CreepAlertSection({
  alert,
  acknowledged,
  onAcknowledge,
}: {
  alert: CreepAlert | null;
  acknowledged: boolean;
  onAcknowledge: () => void;
}) {
  if (!alert) {
    return (
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Creep Alerts</h3>
        <p className="text-sm text-gray-500">No subscription creep detected. Your spending is stable.</p>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Creep Alerts</h3>
        <AlertBadge level="high" label="Creep Detected" />
      </div>

      {acknowledged ? (
        <p className="text-sm text-gray-500">Alert acknowledged. We'll continue monitoring.</p>
      ) : (
        <div className="space-y-3">
          {/* Insight text */}
          <p className="text-sm text-gray-800">{alert.insight}</p>

          {/* Breakdown */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-red-50 rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wide text-red-600 font-medium mb-1">
                Increase
              </p>
              <p className="text-lg font-bold text-red-700">
                +${alert.absoluteIncrease.toFixed(0)}/mo
              </p>
              <p className="text-xs text-red-600">
                +{alert.percentageIncrease.toFixed(1)}% over {alert.periodMonths} months
              </p>
            </div>
            <div className="bg-orange-50 rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wide text-orange-600 font-medium mb-1">
                Contributing Factors
              </p>
              <p className="text-xs text-orange-800">
                {alert.newSubscriptionsAdded.length} new subscription{alert.newSubscriptionsAdded.length !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-orange-800">
                {alert.priceIncreasesDetected.length} price increase{alert.priceIncreasesDetected.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {/* Acknowledge button */}
          <div className="pt-1">
            <ActionButton
              label="Acknowledge"
              actionType="acknowledge"
              onClick={onAcknowledge}
              variant="primary"
            />
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Recurring Spend Timeline ────────────────────────────────────────────────

function RecurringTimelineSection({ snapshots }: { snapshots: RecurringSpendSnapshot[] }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Recurring Spend Timeline</h3>
      {snapshots.length === 0 ? (
        <p className="text-sm text-gray-500">No recurring spend data available.</p>
      ) : (
        <div className="space-y-3">
          {snapshots.map((snapshot) => (
            <div
              key={snapshot.month}
              className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
            >
              <div>
                <p className="text-sm font-medium text-gray-800">
                  {formatMonthFull(snapshot.month)}
                </p>
                <p className="text-xs text-gray-500">
                  {snapshot.subscriptionCount} subscription{snapshot.subscriptionCount !== 1 ? 's' : ''}
                  {snapshot.newThisMonth.length > 0 && (
                    <span className="text-green-600 ml-2">
                      +{snapshot.newThisMonth.length} new ({snapshot.newThisMonth.join(', ')})
                    </span>
                  )}
                  {snapshot.cancelledThisMonth.length > 0 && (
                    <span className="text-red-600 ml-2">
                      −{snapshot.cancelledThisMonth.length} cancelled ({snapshot.cancelledThisMonth.join(', ')})
                    </span>
                  )}
                </p>
              </div>
              <p className="text-sm font-semibold text-gray-900">
                ${snapshot.totalMonthlyRecurring.toFixed(0)}/mo
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMonthShort(month: string): string {
  const [year, m] = month.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[parseInt(m, 10) - 1] ?? m;
}

function formatMonthFull(month: string): string {
  const [year, m] = month.split('-');
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${months[parseInt(m, 10) - 1]} ${year}`;
}
