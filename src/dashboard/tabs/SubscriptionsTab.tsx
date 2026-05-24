import React, { useEffect, useState } from 'react';
import type { SubscriptionRecord, TrialRecord } from '../../types/models';
import type { SubscriptionStatus, SubscriptionCategory, BillingFrequency } from '../../types/enums';
import type { ZombieSubscription } from '../../classifier/usage-signal-collector';
import type { SubscriptionOverviewData, UsageScoringResult } from '../../api/dashboard-api';
import { ActionButton } from '../components/ActionButton';

/**
 * SubscriptionsTab — Displays subscription scanner results, usage scores,
 * active trials with countdown timers, and zombie subscriptions.
 *
 * Requirement 19.2: Subscriptions tab with scanner + usage + trials
 */

// ─── Status Badge Configuration ──────────────────────────────────────────────

const statusConfig: Record<SubscriptionStatus, { label: string; bg: string; text: string; dot: string }> = {
  'active-used': { label: 'Active', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  'active-unused': { label: 'Unused', bg: 'bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  'zombie': { label: 'Zombie', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  'price-increased': { label: 'Price Increased', bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
  'renewing-soon': { label: 'Renewing Soon', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  'trial-active': { label: 'Trial', bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500' },
  'cancelled': { label: 'Cancelled', bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-400' },
  'unknown': { label: 'Unknown', bg: 'bg-gray-50', text: 'text-gray-500', dot: 'bg-gray-400' },
};

// ─── Helper Components ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SubscriptionStatus }) {
  const config = statusConfig[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${config.bg} ${config.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} aria-hidden="true" />
      {config.label}
    </span>
  );
}

function UsageScoreBar({ score }: { score: number }) {
  const percentage = (score / 10) * 100;
  const getColor = (s: number) => {
    if (s >= 7) return 'bg-green-500';
    if (s >= 4) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${getColor(score)}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs text-gray-600 font-medium">{score}/10</span>
    </div>
  );
}

function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFrequency(freq: BillingFrequency): string {
  const labels: Record<BillingFrequency, string> = {
    weekly: '/wk',
    monthly: '/mo',
    quarterly: '/qtr',
    'semi-annual': '/6mo',
    annual: '/yr',
    'one-time': 'one-time',
  };
  return labels[freq];
}

function formatCategory(category: SubscriptionCategory): string {
  return category
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ─── Section Components ──────────────────────────────────────────────────────

function OverviewStats({ overview }: { overview: SubscriptionOverviewData }) {
  const stats = [
    { label: 'Total Subscriptions', value: overview.totalSubscriptions, color: 'text-gray-900' },
    { label: 'Monthly Recurring', value: formatCurrency(overview.totalMonthlyRecurring), color: 'text-gray-900' },
    { label: 'Zombies', value: overview.zombieCount, color: 'text-red-600' },
    { label: 'Active Trials', value: overview.trialCount, color: 'text-purple-600' },
    { label: 'Price Increased', value: overview.priceIncreasedCount, color: 'text-orange-600' },
    { label: 'Renewing Soon', value: overview.renewingSoonCount, color: 'text-blue-600' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {stats.map((stat) => (
        <div key={stat.label} className="bg-white rounded-lg border border-gray-200 p-3">
          <p className="text-xs text-gray-500 mb-1">{stat.label}</p>
          <p className={`text-lg font-semibold ${stat.color}`}>{stat.value}</p>
        </div>
      ))}
    </div>
  );
}

function SubscriptionList({ subscriptions }: { subscriptions: SubscriptionRecord[] }) {
  if (subscriptions.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        No subscriptions detected yet.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider">Vendor</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider">Usage</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">Category</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">Last Payment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {subscriptions.map((sub) => (
              <tr key={sub.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{sub.vendor}</div>
                  <div className="text-xs text-gray-500">{sub.vendorDomain}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={sub.status} />
                </td>
                <td className="px-4 py-3">
                  <span className="font-medium text-gray-900">
                    {formatCurrency(sub.amount, sub.currency)}
                  </span>
                  <span className="text-xs text-gray-500 ml-1">
                    {formatFrequency(sub.billingFrequency)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <UsageScoreBar score={sub.usageScore} />
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <span className="text-xs text-gray-600">{formatCategory(sub.category)}</span>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <span className="text-xs text-gray-600">{formatDate(sub.lastPaymentDate)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActiveTrialsSection({ trials }: { trials: TrialRecord[] }) {
  if (trials.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold text-gray-900">Active Trials</h3>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-purple-50 text-purple-700">
          {trials.length}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {trials.map((trial) => {
          const isExpiringSoon = trial.daysRemaining <= 3;
          const isWarning = trial.daysRemaining <= 7;

          return (
            <div
              key={trial.id}
              className={`bg-white rounded-lg border p-4 ${
                isExpiringSoon ? 'border-red-200 bg-red-50/30' : isWarning ? 'border-orange-200' : 'border-gray-200'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-medium text-gray-900">{trial.vendor}</p>
                  <p className="text-xs text-gray-500">{formatCategory(trial.category)}</p>
                </div>
                <div className={`text-right ${isExpiringSoon ? 'text-red-600' : isWarning ? 'text-orange-600' : 'text-purple-600'}`}>
                  <p className="text-lg font-bold">{trial.daysRemaining}</p>
                  <p className="text-[10px] uppercase tracking-wider font-medium">days left</p>
                </div>
              </div>

              {trial.autoConverts && trial.convertsToAmount != null && (
                <div className="mt-2 px-2 py-1.5 bg-orange-50 border border-orange-100 rounded text-xs text-orange-700">
                  <span className="font-medium">⚠ Auto-converts</span> to{' '}
                  {formatCurrency(trial.convertsToAmount)}
                  {trial.convertsToFrequency && formatFrequency(trial.convertsToFrequency)}
                </div>
              )}

              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  Ends {formatDate(trial.trialEndDate)}
                </span>
                {trial.cancellationUrl && (
                  <ActionButton
                    label="Cancel Trial"
                    actionType="cancel_trial"
                    onClick={() => {}}
                    variant="danger"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ZombieSubscriptionsSection({ zombies }: { zombies: ZombieSubscription[] }) {
  if (zombies.length === 0) {
    return null;
  }

  const totalMonthlyWaste = zombies.reduce((sum, z) => sum + z.monthlyWaste, 0);
  const totalAnnualWaste = zombies.reduce((sum, z) => sum + z.annualWaste, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold text-gray-900">Zombie Subscriptions</h3>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-700">
          {zombies.length} found
        </span>
      </div>

      {/* Waste summary banner */}
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-red-800">Total waste from zombie subscriptions</p>
          <p className="text-xs text-red-600 mt-0.5">Subscriptions with zero engagement for 60+ days</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-red-700">{formatCurrency(totalMonthlyWaste)}/mo</p>
          <p className="text-xs text-red-600">{formatCurrency(totalAnnualWaste)}/yr</p>
        </div>
      </div>

      {/* Zombie list */}
      <div className="space-y-2">
        {zombies.map((zombie) => (
          <div
            key={zombie.subscription.id}
            className="bg-white border border-red-100 rounded-lg p-4 flex items-center justify-between"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium text-gray-900">{zombie.subscription.vendor}</p>
                <StatusBadge status="zombie" />
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                <span>{formatCategory(zombie.subscription.category)}</span>
                <span>•</span>
                <span>{zombie.daysSinceLastEngagement} days inactive</span>
                <span>•</span>
                <span>Usage: {zombie.usageScore}/10</span>
              </div>
            </div>
            <div className="text-right ml-4">
              <p className="font-semibold text-red-700">{formatCurrency(zombie.monthlyWaste)}/mo</p>
              <p className="text-xs text-red-500">{formatCurrency(zombie.annualWaste)}/yr wasted</p>
            </div>
            <div className="ml-4">
              <ActionButton
                label="Cancel"
                actionType="cancel"
                onClick={() => {}}
                variant="danger"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

/** Props for SubscriptionsTab when data is provided externally (e.g., for testing) */
export interface SubscriptionsTabProps {
  overview?: SubscriptionOverviewData;
  usageScores?: UsageScoringResult;
  activeTrials?: TrialRecord[];
  zombieSubscriptions?: ZombieSubscription[];
  loading?: boolean;
}

export function SubscriptionsTab({
  overview,
  usageScores,
  activeTrials,
  zombieSubscriptions,
  loading = false,
}: SubscriptionsTabProps) {
  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-64" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 bg-gray-200 rounded-lg" />
          ))}
        </div>
        <div className="h-64 bg-gray-200 rounded-lg" />
      </div>
    );
  }

  // Use provided data or show empty state
  const subscriptions = overview?.subscriptions ?? [];
  const trials = activeTrials ?? [];
  const zombies = zombieSubscriptions ?? [];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Subscriptions</h2>
        <p className="text-sm text-gray-500 mt-1">
          Scanner results, usage scores, active trials, and zombie detection.
        </p>
      </div>

      {/* Overview stats */}
      {overview && <OverviewStats overview={overview} />}

      {/* Zombie subscriptions — highlighted section */}
      <ZombieSubscriptionsSection zombies={zombies} />

      {/* Active trials with countdown */}
      <ActiveTrialsSection trials={trials} />

      {/* All subscriptions table with usage scores */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-900">All Subscriptions</h3>
        <SubscriptionList subscriptions={subscriptions} />
      </div>
    </div>
  );
}
