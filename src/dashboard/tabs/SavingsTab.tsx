import React, { useEffect, useState } from 'react';
import { ActionButton } from '../components/ActionButton';
import type { SavingsSummary } from '../../api/dashboard-api';
import type {
  BillingOptimization,
  NegotiationOpportunity,
  SavingsRecommendation,
} from '../../types/outputs';

/**
 * SavingsTab — Displays savings recommendations, billing optimizations,
 * and negotiation opportunities with one-click action buttons.
 *
 * Requirements: 19.3, 6.5
 */

interface SavingsTabProps {
  /** Fetch total potential savings summary */
  getTotalPotentialSavings: () => Promise<SavingsSummary>;
  /** Fetch savings recommendations ranked by annual savings */
  getSavingsRecommendations: () => Promise<SavingsRecommendation[]>;
  /** Fetch billing optimization opportunities */
  getBillingOptimizations: () => Promise<BillingOptimization[]>;
  /** Fetch negotiation opportunities */
  getNegotiationOpportunities: () => Promise<NegotiationOpportunity[]>;
  /** Handler for one-click actions */
  onAction?: (actionType: string, targetId: string) => void;
}

export function SavingsTab({
  getTotalPotentialSavings,
  getSavingsRecommendations,
  getBillingOptimizations,
  getNegotiationOpportunities,
  onAction,
}: SavingsTabProps) {
  const [summary, setSummary] = useState<SavingsSummary | null>(null);
  const [recommendations, setRecommendations] = useState<SavingsRecommendation[]>([]);
  const [billingOptimizations, setBillingOptimizations] = useState<BillingOptimization[]>([]);
  const [negotiations, setNegotiations] = useState<NegotiationOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        const [summaryData, recsData, billingData, negotiationData] = await Promise.all([
          getTotalPotentialSavings(),
          getSavingsRecommendations(),
          getBillingOptimizations(),
          getNegotiationOpportunities(),
        ]);
        setSummary(summaryData);
        // Sort recommendations by annual savings descending
        setRecommendations(
          [...recsData].sort((a, b) => b.estimatedAnnualSavings - a.estimatedAnnualSavings)
        );
        setBillingOptimizations(billingData);
        setNegotiations(negotiationData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load savings data');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [getTotalPotentialSavings, getSavingsRecommendations, getBillingOptimizations, getNegotiationOpportunities]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Total Potential Savings Summary */}
      {summary && <SavingsSummaryCard summary={summary} />}

      {/* Savings Recommendations */}
      {recommendations.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Savings Recommendations</h3>
          <div className="space-y-3">
            {recommendations.map((rec) => (
              <RecommendationCard key={rec.id} recommendation={rec} onAction={onAction} />
            ))}
          </div>
        </section>
      )}

      {/* Billing Optimizations */}
      {billingOptimizations.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Billing Optimizations</h3>
          <div className="space-y-3">
            {billingOptimizations.map((opt) => (
              <BillingOptimizationCard key={opt.id} optimization={opt} onAction={onAction} />
            ))}
          </div>
        </section>
      )}

      {/* Negotiation Opportunities */}
      {negotiations.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Negotiation Opportunities</h3>
          <div className="space-y-3">
            {negotiations.map((neg) => (
              <NegotiationCard key={neg.id} negotiation={neg} onAction={onAction} />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {recommendations.length === 0 && billingOptimizations.length === 0 && negotiations.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-sm">No savings opportunities found yet.</p>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SavingsSummaryCard({ summary }: { summary: SavingsSummary }) {
  return (
    <div className="rounded-xl bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 p-5">
      <h3 className="text-sm font-medium text-green-800 mb-3">Total Potential Savings</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <p className="text-2xl font-bold text-green-700">
            ${summary.totalPotentialMonthlySavings.toFixed(2)}
          </p>
          <p className="text-xs text-green-600">per month</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-green-700">
            ${summary.totalPotentialAnnualSavings.toFixed(2)}
          </p>
          <p className="text-xs text-green-600">per year</p>
        </div>
        <div>
          <p className="text-lg font-semibold text-gray-700">{summary.recommendationCount}</p>
          <p className="text-xs text-gray-500">recommendations</p>
        </div>
        <div>
          <p className="text-lg font-semibold text-gray-700">
            {summary.negotiationCount + summary.billingOptimizationCount}
          </p>
          <p className="text-xs text-gray-500">opportunities</p>
        </div>
      </div>
    </div>
  );
}

function RecommendationCard({
  recommendation,
  onAction,
}: {
  recommendation: SavingsRecommendation;
  onAction?: (actionType: string, targetId: string) => void;
}) {
  const actionType = recommendation.type === 'redundancy' || recommendation.type === 'cancellation'
    ? 'cancel'
    : 'negotiate';

  const actionLabel = recommendation.type === 'redundancy' || recommendation.type === 'cancellation'
    ? 'Cancel'
    : 'Negotiate';

  const variant = recommendation.type === 'redundancy' || recommendation.type === 'cancellation'
    ? 'danger' as const
    : 'primary' as const;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-medium text-gray-900 truncate">{recommendation.vendor}</h4>
            <ConfidenceBadge confidence={recommendation.confidence} />
          </div>
          <p className="text-xs text-gray-500 mb-2">{recommendation.reason}</p>
          <div className="flex items-center gap-4 text-xs text-gray-600">
            <span>Current: ${recommendation.currentMonthlyAmount.toFixed(2)}/mo</span>
            <span className="text-green-600 font-medium">
              Save ${recommendation.estimatedAnnualSavings.toFixed(2)}/yr
            </span>
          </div>
        </div>
        <ActionButton
          label={actionLabel}
          actionType={actionType}
          variant={variant}
          onClick={() => onAction?.(actionType, recommendation.id)}
        />
      </div>
    </div>
  );
}

function BillingOptimizationCard({
  optimization,
  onAction,
}: {
  optimization: BillingOptimization;
  onAction?: (actionType: string, targetId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-medium text-gray-900 truncate">{optimization.vendor}</h4>
            <ConfidenceBadge confidence={optimization.confidence} />
          </div>
          <p className="text-xs text-gray-500 mb-2">{optimization.recommendation}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
            <span>Monthly: ${optimization.currentMonthlyAmount.toFixed(2)}/mo</span>
            <span>Annual equiv: ${optimization.annualPlanMonthlyEquivalent.toFixed(2)}/mo</span>
            <span className="text-green-600 font-medium">
              Save ${optimization.annualSavings.toFixed(2)}/yr
            </span>
            <span>Break-even: {optimization.breakEvenMonths} months</span>
          </div>
        </div>
        <ActionButton
          label="Switch to Annual"
          actionType="switch_annual"
          variant="primary"
          onClick={() => onAction?.('switch_annual', optimization.id)}
        />
      </div>
    </div>
  );
}

function NegotiationCard({
  negotiation,
  onAction,
}: {
  negotiation: NegotiationOpportunity;
  onAction?: (actionType: string, targetId: string) => void;
}) {
  const reasonLabels: Record<string, string> = {
    price_increase: 'Price Increase',
    competitor_cheaper: 'Competitor Cheaper',
    long_tenure_discount: 'Long Tenure',
    usage_low: 'Low Usage',
    bulk_opportunity: 'Bulk Opportunity',
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-medium text-gray-900 truncate">{negotiation.vendor}</h4>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
              {reasonLabels[negotiation.reason] ?? negotiation.reason}
            </span>
            <ConfidenceBadge confidence={negotiation.confidence} />
          </div>
          <p className="text-xs text-gray-500 mb-2">{negotiation.context}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
            <span>Current: ${negotiation.currentAmount.toFixed(2)}/mo</span>
            <span className="text-green-600 font-medium">
              Est. savings: ${negotiation.estimatedSavings.toFixed(2)}/mo
            </span>
            <span>Tenure: {negotiation.tenure} months</span>
          </div>
        </div>
        <ActionButton
          label="Negotiate"
          actionType="negotiate"
          variant="primary"
          onClick={() => onAction?.('negotiate', negotiation.id)}
        />
      </div>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  const colors: Record<string, string> = {
    high: 'bg-green-100 text-green-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-gray-100 text-gray-600',
  };

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${colors[confidence]}`}>
      {confidence}
    </span>
  );
}
