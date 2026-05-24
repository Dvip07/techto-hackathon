import React, { useEffect, useState } from 'react';
import type { RiskFlag } from '../../types/enums';
import type { FinancialObligation, ObligationDeadline, PenaltyClause } from '../../types/models';
import type { ObligationWatchResult } from '../../types/outputs';

/**
 * ObligationsTab — Displays contracts with risk flag badges, financial exposure,
 * upcoming obligation deadlines, and highlighted penalty clauses.
 *
 * Requirement 19.7: Contracts with risk flag badges, financial exposure, deadlines
 */

// ─── Risk Flag Color Mapping ─────────────────────────────────────────────────

const riskFlagConfig: Record<RiskFlag, { bg: string; text: string; label: string }> = {
  auto_renewal: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Auto-Renewal' },
  price_escalation: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Price Escalation' },
  penalty_clause: { bg: 'bg-red-100', text: 'text-red-800', label: 'Penalty Clause' },
  missed_notice_window: { bg: 'bg-red-100', text: 'text-red-800', label: 'Missed Notice' },
  unfavorable_terms: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Unfavorable Terms' },
  silent_renewal: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Silent Renewal' },
  expiring_soon: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Expiring Soon' },
  high_financial_exposure: { bg: 'bg-red-100', text: 'text-red-800', label: 'High Exposure' },
};

// ─── Sub-Components ──────────────────────────────────────────────────────────

function RiskFlagBadge({ flag }: { flag: RiskFlag }) {
  const config = riskFlagConfig[flag];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
}

function ExposureSummary({ totalExposure, summary }: {
  totalExposure: number;
  summary: ObligationWatchResult['summary'];
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      <h3 className="text-sm font-medium text-gray-500 mb-1">Total Financial Exposure</h3>
      <p className="text-3xl font-bold text-gray-900">
        ${totalExposure.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="text-center p-2 bg-gray-50 rounded-lg">
          <p className="text-lg font-semibold text-gray-900">{summary.totalObligations}</p>
          <p className="text-xs text-gray-500">Contracts</p>
        </div>
        <div className="text-center p-2 bg-gray-50 rounded-lg">
          <p className="text-lg font-semibold text-red-600">{summary.totalRiskFlags}</p>
          <p className="text-xs text-gray-500">Risk Flags</p>
        </div>
        <div className="text-center p-2 bg-gray-50 rounded-lg">
          <p className="text-lg font-semibold text-orange-600">{summary.obligationsWithPenalties}</p>
          <p className="text-xs text-gray-500">Penalties</p>
        </div>
        <div className="text-center p-2 bg-gray-50 rounded-lg">
          <p className="text-lg font-semibold text-purple-600">{summary.upcomingDeadlineCount}</p>
          <p className="text-xs text-gray-500">Deadlines</p>
        </div>
      </div>
    </div>
  );
}

function ContractCard({ obligation }: { obligation: FinancialObligation }) {
  const hasMissedNotice = obligation.riskFlags.includes('missed_notice_window');
  const borderClass = hasMissedNotice
    ? 'border-red-300 bg-red-50/30'
    : 'border-gray-200 bg-white';

  return (
    <div className={`rounded-xl border p-4 ${borderClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-gray-900 truncate">{obligation.contractName}</h4>
          <p className="text-xs text-gray-500 mt-0.5 capitalize">
            {obligation.contractType.replace(/_/g, ' ')}
          </p>
        </div>
        {obligation.totalValue != null && (
          <p className="text-sm font-semibold text-gray-900 whitespace-nowrap">
            ${obligation.totalValue.toLocaleString()}
          </p>
        )}
      </div>

      <div className="mt-2 text-xs text-gray-600">
        <span className="font-medium">Parties:</span> {obligation.parties.join(', ')}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        {obligation.autoRenews && (
          <span className="inline-flex items-center gap-1">
            <svg className="w-3 h-3 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
            Auto-renews
          </span>
        )}
        {obligation.keyDates.length > 0 && (
          <span>
            Next: {new Date(obligation.keyDates[0].date).toLocaleDateString()}
          </span>
        )}
      </div>

      {obligation.riskFlags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {obligation.riskFlags.map((flag, idx) => (
            <RiskFlagBadge key={`${flag}-${idx}`} flag={flag} />
          ))}
        </div>
      )}

      {hasMissedNotice && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-red-700 font-medium">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          Notice window missed — review immediately
        </div>
      )}
    </div>
  );
}

function PenaltyClauseCard({ contractName, clause }: { contractName: string; clause: PenaltyClause }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{contractName}</p>
          <p className="text-xs text-gray-600 mt-0.5">{clause.description}</p>
        </div>
        {clause.penaltyAmount != null && (
          <span className="text-sm font-semibold text-red-700 whitespace-nowrap">
            ${clause.penaltyAmount.toLocaleString()}
          </span>
        )}
      </div>
      <div className="mt-2 text-xs text-red-700">
        <span className="font-medium">Trigger:</span> {clause.triggerCondition}
      </div>
    </div>
  );
}

function DeadlineItem({ deadline }: { deadline: ObligationDeadline }) {
  const typeLabels: Record<string, string> = {
    payment_due: 'Payment Due',
    renewal: 'Renewal',
    expiry: 'Expiry',
    notice_period: 'Notice Period',
    penalty_trigger: 'Penalty Trigger',
    rate_change: 'Rate Change',
  };

  const typeColors: Record<string, string> = {
    payment_due: 'bg-blue-100 text-blue-800',
    renewal: 'bg-green-100 text-green-800',
    expiry: 'bg-yellow-100 text-yellow-800',
    notice_period: 'bg-orange-100 text-orange-800',
    penalty_trigger: 'bg-red-100 text-red-800',
    rate_change: 'bg-purple-100 text-purple-800',
  };

  const deadlineDate = new Date(deadline.date);
  const now = new Date();
  const daysUntil = Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0">
      <div className="flex-shrink-0 w-14 text-center">
        <p className="text-xs text-gray-500">{deadlineDate.toLocaleDateString(undefined, { month: 'short' })}</p>
        <p className="text-lg font-bold text-gray-900">{deadlineDate.getDate()}</p>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${typeColors[deadline.type] ?? 'bg-gray-100 text-gray-700'}`}>
            {typeLabels[deadline.type] ?? deadline.type}
          </span>
          {daysUntil <= 7 && daysUntil >= 0 && (
            <span className="text-[10px] font-medium text-red-600">
              {daysUntil === 0 ? 'Today' : `${daysUntil}d left`}
            </span>
          )}
        </div>
        <p className="text-sm text-gray-700 mt-0.5 truncate">{deadline.description}</p>
        {deadline.financialConsequence && (
          <p className="text-xs text-gray-500 mt-0.5">{deadline.financialConsequence}</p>
        )}
      </div>
      {deadline.amount != null && (
        <p className="text-sm font-medium text-gray-900 whitespace-nowrap">
          ${deadline.amount.toLocaleString()}
        </p>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface ObligationsTabProps {
  data?: ObligationWatchResult | null;
  loading?: boolean;
  error?: string | null;
}

export function ObligationsTab({ data: dataProp, loading: loadingProp = false, error: errorProp = null }: ObligationsTabProps) {
  const [fetchedData, setFetchedData] = useState<ObligationWatchResult | null>(null);
  const [fetching, setFetching] = useState(!dataProp);

  const API_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL)
    || 'http://localhost:3001';

  useEffect(() => {
    if (dataProp) return;
    setFetching(true);
    fetch(`${API_URL}/api/obligations`)
      .then((r) => r.json())
      .then((obligations: FinancialObligation[]) => {
        // Build ObligationWatchResult from raw obligations
        const totalExposure = obligations.reduce((sum, o) => sum + o.financialExposure, 0);
        const allDeadlines: ObligationDeadline[] = obligations.flatMap((o) => o.keyDates);
        const totalRiskFlags = obligations.reduce((sum, o) => sum + o.riskFlags.length, 0);
        const withPenalties = obligations.filter((o) => o.penaltyClauses.length > 0).length;

        // Build risk items from obligations
        const riskItems = obligations.flatMap((o) =>
          o.riskFlags.map((flag: any) => ({
            obligationId: o.id,
            contractName: o.contractName,
            flag,
            description: `${flag} detected`,
            financialImpact: o.financialExposure,
          }))
        );
        const highRisk = obligations.filter((o) =>
          o.riskFlags.includes('missed_notice_window') || o.riskFlags.includes('high_financial_exposure')
        );

        setFetchedData({
          obligations,
          riskFlags: riskItems,
          deadlines: allDeadlines,
          totalFinancialExposure: totalExposure,
          highRiskObligations: highRisk,
          summary: {
            totalObligations: obligations.length,
            totalRiskFlags: totalRiskFlags,
            obligationsWithAutoRenewal: obligations.filter((o) => o.autoRenews).length,
            obligationsWithPenalties: withPenalties,
            obligationsWithMissedNotice: obligations.filter((o) => o.riskFlags.includes('missed_notice_window')).length,
            upcomingDeadlineCount: allDeadlines.length,
          },
        });
      })
      .catch(() => {})
      .finally(() => setFetching(false));
  }, [API_URL, dataProp]);

  const loading = loadingProp || fetching;
  const error = errorProp;
  const data = dataProp ?? fetchedData;
  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-32 bg-gray-100 rounded-xl" />
        <div className="h-48 bg-gray-100 rounded-xl" />
        <div className="h-48 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
        <p className="text-sm text-gray-500">No obligation data available.</p>
      </div>
    );
  }

  // Collect all penalty clauses across obligations
  const penaltyItems: { contractName: string; clause: PenaltyClause }[] = [];
  for (const obligation of data.obligations) {
    for (const clause of obligation.penaltyClauses) {
      penaltyItems.push({ contractName: obligation.contractName, clause });
    }
  }

  // Sort deadlines by date (soonest first)
  const sortedDeadlines = [...data.deadlines].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Sort obligations: missed notice window first, then by financial exposure
  const sortedObligations = [...data.obligations].sort((a, b) => {
    const aMissed = a.riskFlags.includes('missed_notice_window') ? 1 : 0;
    const bMissed = b.riskFlags.includes('missed_notice_window') ? 1 : 0;
    if (aMissed !== bMissed) return bMissed - aMissed;
    return b.financialExposure - a.financialExposure;
  });

  return (
    <div className="space-y-6">
      {/* Financial Exposure Summary */}
      <ExposureSummary totalExposure={data.totalFinancialExposure} summary={data.summary} />

      {/* Contracts Section */}
      <section>
        <h3 className="text-base font-semibold text-gray-900 mb-3">Contracts</h3>
        {sortedObligations.length === 0 ? (
          <p className="text-sm text-gray-500">No active contracts.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {sortedObligations.map((obligation) => (
              <ContractCard key={obligation.id} obligation={obligation} />
            ))}
          </div>
        )}
      </section>

      {/* Penalty Clauses Section */}
      {penaltyItems.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-base font-semibold text-gray-900">Penalty Clauses</h3>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-800">
              {penaltyItems.length}
            </span>
          </div>
          <div className="space-y-2">
            {penaltyItems.map((item, idx) => (
              <PenaltyClauseCard
                key={`${item.contractName}-${idx}`}
                contractName={item.contractName}
                clause={item.clause}
              />
            ))}
          </div>
        </section>
      )}

      {/* Upcoming Deadlines Section */}
      <section>
        <h3 className="text-base font-semibold text-gray-900 mb-3">Upcoming Deadlines</h3>
        {sortedDeadlines.length === 0 ? (
          <p className="text-sm text-gray-500">No upcoming deadlines.</p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 px-4">
            {sortedDeadlines.map((deadline) => (
              <DeadlineItem key={deadline.id} deadline={deadline} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
