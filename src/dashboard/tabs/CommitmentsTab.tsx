import React, { useEffect, useState } from 'react';
import { ActionButton } from '../components/ActionButton';
import type { PaymentPromiseResult, CommitmentTrackingResult } from '../../types/outputs';
import type { RefundRecord, FinancialCommitment } from '../../types/models';

/**
 * CommitmentsTab — Displays payment promises, pending refunds, and financial
 * commitment status with follow-up actions.
 *
 * Requirement 19.6: Financial commitment status with follow-up actions
 */

// ─── Status Badge ────────────────────────────────────────────────────────────

type StatusType = 'open' | 'fulfilled' | 'overdue' | 'gone_cold';

const statusColors: Record<StatusType, string> = {
  open: 'bg-blue-50 text-blue-700',
  fulfilled: 'bg-green-50 text-green-700',
  overdue: 'bg-red-50 text-red-700',
  gone_cold: 'bg-gray-100 text-gray-600',
};

const statusDots: Record<StatusType, string> = {
  open: 'bg-blue-500',
  fulfilled: 'bg-green-500',
  overdue: 'bg-red-500',
  gone_cold: 'bg-gray-400',
};

function StatusBadge({ status }: { status: StatusType }) {
  const label = status === 'gone_cold' ? 'Gone Cold' : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${statusColors[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${statusDots[status]}`} aria-hidden="true" />
      {label}
    </span>
  );
}

// ─── Refund Status Badge ─────────────────────────────────────────────────────

type RefundStatusType = 'promised' | 'processing' | 'received' | 'overdue' | 'disputed';

const refundStatusColors: Record<RefundStatusType, string> = {
  promised: 'bg-blue-50 text-blue-700',
  processing: 'bg-yellow-50 text-yellow-700',
  received: 'bg-green-50 text-green-700',
  overdue: 'bg-red-50 text-red-700',
  disputed: 'bg-orange-50 text-orange-700',
};

function RefundStatusBadge({ status }: { status: RefundStatusType }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${refundStatusColors[status]}`}>
      {label}
    </span>
  );
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function formatDate(date: Date | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCurrency(amount: number | null, currency = 'USD'): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface CommitmentsTabProps {
  paymentPromises?: PaymentPromiseResult;
  pendingRefunds?: { pendingRefunds: RefundRecord[]; overdueRefunds: RefundRecord[] };
  financialCommitments?: CommitmentTrackingResult;
  onFollowUp?: (commitmentId: string) => void;
  onMarkRefundReceived?: (refundId: string) => void;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function CommitmentsTab({
  paymentPromises: paymentPromisesProp,
  pendingRefunds: pendingRefundsProp,
  financialCommitments: financialCommitmentsProp,
  onFollowUp,
  onMarkRefundReceived,
}: CommitmentsTabProps) {
  const [fetchedRefunds, setFetchedRefunds] = useState<{ pendingRefunds: RefundRecord[]; overdueRefunds: RefundRecord[] } | undefined>(undefined);
  const [fetchedCommitments, setFetchedCommitments] = useState<CommitmentTrackingResult | undefined>(undefined);

  const API_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL)
    || 'http://localhost:3001';

  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/api/refunds/pending`).then((r) => r.json()),
      fetch(`${API_URL}/api/refunds/overdue`).then((r) => r.json()),
      fetch(`${API_URL}/api/commitments`).then((r) => r.json()),
    ])
      .then(([pending, overdue, commitments]) => {
        setFetchedRefunds({ pendingRefunds: pending, overdueRefunds: overdue });
        // Build CommitmentTrackingResult from the open/overdue structure
        const open: FinancialCommitment[] = commitments.open ?? [];
        const overdueCommitments: FinancialCommitment[] = commitments.overdue ?? [];
        const inbound = open.filter((c: FinancialCommitment) => c.type === 'inbound');
        const outbound = open.filter((c: FinancialCommitment) => c.type === 'outbound');
        const allOpen = [...open, ...overdueCommitments].sort((a, b) => (b.financialValue ?? 0) - (a.financialValue ?? 0));
        setFetchedCommitments({
          inbound,
          outbound,
          overdue: overdueCommitments,
          openRankedByValue: allOpen,
          refundCommitments: allOpen.filter((c: FinancialCommitment) => c.subtype === 'refund_promise'),
          paymentPromiseCommitments: allOpen.filter((c: FinancialCommitment) => c.subtype === 'payment_promise'),
          totals: {
            totalInbound: inbound.length,
            totalOutbound: outbound.length,
            totalOpen: open.length,
            totalOverdue: overdueCommitments.length,
            totalInboundValue: inbound.reduce((s: number, c: FinancialCommitment) => s + (c.financialValue ?? 0), 0),
            totalOutboundValue: outbound.reduce((s: number, c: FinancialCommitment) => s + (c.financialValue ?? 0), 0),
            totalOverdueValue: overdueCommitments.reduce((s: number, c: FinancialCommitment) => s + (c.financialValue ?? 0), 0),
          },
        });
      })
      .catch(() => {});
  }, [API_URL]);

  const pendingRefunds = pendingRefundsProp ?? fetchedRefunds;
  const financialCommitments = financialCommitmentsProp ?? fetchedCommitments;

  return (
    <div className="space-y-8">
      <h2 className="text-xl font-semibold text-gray-900">Commitments — Promises & Refunds</h2>

      {/* Payment Promises Section */}
      <PaymentPromisesSection
        data={paymentPromisesProp}
        onFollowUp={onFollowUp}
      />

      {/* Pending Refunds Section */}
      <PendingRefundsSection
        data={pendingRefunds}
        onMarkReceived={onMarkRefundReceived}
        onFollowUp={onFollowUp}
      />

      {/* Financial Commitments Section */}
      <FinancialCommitmentsSection
        data={financialCommitments}
        onFollowUp={onFollowUp}
      />
    </div>
  );
}

// ─── Payment Promises Section ────────────────────────────────────────────────

function PaymentPromisesSection({
  data,
  onFollowUp,
}: {
  data?: PaymentPromiseResult;
  onFollowUp?: (id: string) => void;
}) {
  if (!data) {
    return (
      <section>
        <h3 className="text-lg font-medium text-gray-800 mb-3">Payment Promises</h3>
        <p className="text-sm text-gray-500">Loading payment promises...</p>
      </section>
    );
  }

  const allPromises = [
    ...data.overduePromises,
    ...data.openPromises,
    ...data.fulfilledPromises,
  ];

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-medium text-gray-800">Payment Promises</h3>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>Open: {formatCurrency(data.totalOpenAmount)}</span>
          <span className="text-red-600">Overdue: {formatCurrency(data.totalOverdueAmount)}</span>
        </div>
      </div>

      {allPromises.length === 0 ? (
        <p className="text-sm text-gray-500">No payment promises tracked.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {allPromises.map((promise) => (
            <div key={promise.commitmentId} className="flex items-center justify-between px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate">
                    {promise.counterparty}
                  </span>
                  <StatusBadge status={promise.status} />
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                  <span>{formatCurrency(promise.amount, promise.currency)}</span>
                  <span>Due: {formatDate(promise.dueDate)}</span>
                  {promise.daysOverdue > 0 && (
                    <span className="text-red-600 font-medium">{promise.daysOverdue} days overdue</span>
                  )}
                </div>
              </div>
              {promise.status === 'overdue' && onFollowUp && (
                <ActionButton
                  label="Follow Up"
                  actionType="follow_up"
                  variant="primary"
                  onClick={() => onFollowUp(promise.commitmentId)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Pending Refunds Section ─────────────────────────────────────────────────

function PendingRefundsSection({
  data,
  onMarkReceived,
  onFollowUp,
}: {
  data?: { pendingRefunds: RefundRecord[]; overdueRefunds: RefundRecord[] };
  onMarkReceived?: (id: string) => void;
  onFollowUp?: (id: string) => void;
}) {
  if (!data) {
    return (
      <section>
        <h3 className="text-lg font-medium text-gray-800 mb-3">Pending Refunds</h3>
        <p className="text-sm text-gray-500">Loading pending refunds...</p>
      </section>
    );
  }

  const allRefunds = [...data.overdueRefunds, ...data.pendingRefunds];

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-medium text-gray-800">Pending Refunds</h3>
        <span className="text-xs text-gray-500">{allRefunds.length} tracked</span>
      </div>

      {allRefunds.length === 0 ? (
        <p className="text-sm text-gray-500">No pending refunds.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {allRefunds.map((refund) => (
            <div key={refund.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate">
                    {refund.vendor}
                  </span>
                  <RefundStatusBadge status={refund.status} />
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                  <span>{formatCurrency(refund.amount, refund.currency)}</span>
                  <span>Expected: {formatDate(refund.expectedByDate)}</span>
                  {refund.daysOverdue > 0 && (
                    <span className="text-red-600 font-medium">{refund.daysOverdue} days overdue</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {refund.status === 'overdue' && onFollowUp && (
                  <ActionButton
                    label="Follow Up"
                    actionType="follow_up"
                    variant="danger"
                    onClick={() => onFollowUp(refund.id)}
                  />
                )}
                {onMarkReceived && refund.status !== 'received' && (
                  <ActionButton
                    label="Mark Received"
                    actionType="acknowledge"
                    variant="secondary"
                    onClick={() => onMarkReceived(refund.id)}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Financial Commitments Section ───────────────────────────────────────────

function FinancialCommitmentsSection({
  data,
  onFollowUp,
}: {
  data?: CommitmentTrackingResult;
  onFollowUp?: (id: string) => void;
}) {
  if (!data) {
    return (
      <section>
        <h3 className="text-lg font-medium text-gray-800 mb-3">Financial Commitments</h3>
        <p className="text-sm text-gray-500">Loading financial commitments...</p>
      </section>
    );
  }

  const allCommitments = [
    ...data.overdue,
    ...data.inbound.filter((c) => c.status !== 'overdue'),
    ...data.outbound.filter((c) => c.status !== 'overdue'),
  ];

  // Deduplicate by id
  const seen = new Set<string>();
  const uniqueCommitments = allCommitments.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-medium text-gray-800">Financial Commitments</h3>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>Inbound: {data.totals.totalInbound}</span>
          <span>Outbound: {data.totals.totalOutbound}</span>
          <span className="text-red-600">Overdue: {data.totals.totalOverdue}</span>
        </div>
      </div>

      {uniqueCommitments.length === 0 ? (
        <p className="text-sm text-gray-500">No financial commitments tracked.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {uniqueCommitments.map((commitment) => (
            <div key={commitment.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate">
                    {commitment.counterparty}
                  </span>
                  <StatusBadge status={commitment.status} />
                  <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${
                    commitment.type === 'inbound'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-purple-50 text-purple-700'
                  }`}>
                    {commitment.type === 'inbound' ? 'Inbound' : 'Outbound'}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                  <span>{commitment.description}</span>
                  {commitment.financialValue != null && (
                    <span className="font-medium text-gray-700">
                      {formatCurrency(commitment.financialValue, commitment.currency)}
                    </span>
                  )}
                  {commitment.dueDate && (
                    <span>Due: {formatDate(commitment.dueDate)}</span>
                  )}
                </div>
              </div>
              {(commitment.status === 'overdue' || commitment.status === 'gone_cold') && onFollowUp && (
                <ActionButton
                  label="Follow Up"
                  actionType="follow_up"
                  variant={commitment.status === 'overdue' ? 'primary' : 'secondary'}
                  onClick={() => onFollowUp(commitment.id)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
