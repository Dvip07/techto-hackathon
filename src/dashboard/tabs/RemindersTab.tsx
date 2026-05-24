import React, { useEffect, useState } from 'react';
import { AlertBadge } from '../components/AlertBadge';
import { ActionButton } from '../components/ActionButton';
import type { RenewalAlert } from '../../types/outputs';
import type { TrialRecord, ObligationDeadline } from '../../types/models';

/**
 * RemindersTab — Displays upcoming renewals, expiring trials, and deadline alerts.
 * Allows users to configure custom lead-time days per vendor.
 *
 * Requirements: 19.4, 12.5
 */

// ─── Types ───────────────────────────────────────────────────────────────────

interface LeadTimeConfig {
  vendor: string;
  days: number[];
}

interface RemindersTabProps {
  /** Fetch upcoming renewals from the dashboard API */
  getUpcomingRenewals: () => Promise<RenewalAlert[]>;
  /** Fetch expiring trials from the dashboard API */
  getExpiringTrials: () => Promise<TrialRecord[]>;
  /** Fetch obligation deadlines from the dashboard API */
  getObligationDeadlines?: () => Promise<ObligationDeadline[]>;
  /** Configure lead-time days for a vendor */
  configureLeadTime: (vendor: string, days: number[]) => Promise<void>;
  /** Request a draft (e.g., trial cancellation) */
  onRequestDraft?: (type: string, targetId: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getUrgencyLevel(days: number): 'critical' | 'high' | 'medium' | 'low' {
  if (days < 3) return 'critical';
  if (days < 7) return 'high';
  if (days < 30) return 'medium';
  return 'low';
}

function getUrgencyColor(days: number): string {
  if (days < 3) return 'border-l-red-500 bg-red-50/30';
  if (days < 7) return 'border-l-orange-500 bg-orange-50/30';
  if (days < 30) return 'border-l-yellow-500 bg-yellow-50/30';
  return 'border-l-green-500 bg-green-50/30';
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(amount);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

const DEFAULT_LEAD_TIME_OPTIONS = [30, 14, 7, 3, 1];

// ─── Sub-Components ──────────────────────────────────────────────────────────

function LeadTimeModal({
  vendor,
  currentDays,
  onSave,
  onClose,
}: {
  vendor: string;
  currentDays: number[];
  onSave: (days: number[]) => void;
  onClose: () => void;
}) {
  const [selectedDays, setSelectedDays] = useState<number[]>(currentDays);

  const toggleDay = (day: number) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => b - a)
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-gray-900 mb-1">Configure Reminders</h3>
        <p className="text-sm text-gray-500 mb-4">
          Set reminder days before renewal for <span className="font-medium text-gray-700">{vendor}</span>
        </p>

        <div className="flex flex-wrap gap-2 mb-5">
          {DEFAULT_LEAD_TIME_OPTIONS.map((day) => (
            <button
              key={day}
              onClick={() => toggleDay(day)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                selectedDays.includes(day)
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {day} {day === 1 ? 'day' : 'days'}
            </button>
          ))}
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(selectedDays);
              onClose();
            }}
            disabled={selectedDays.length === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function RemindersTab({
  getUpcomingRenewals,
  getExpiringTrials,
  getObligationDeadlines,
  configureLeadTime,
  onRequestDraft,
}: RemindersTabProps) {
  const [renewals, setRenewals] = useState<RenewalAlert[]>([]);
  const [trials, setTrials] = useState<TrialRecord[]>([]);
  const [deadlines, setDeadlines] = useState<ObligationDeadline[]>([]);
  const [leadTimeConfigs, setLeadTimeConfigs] = useState<LeadTimeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [leadTimeModalVendor, setLeadTimeModalVendor] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [renewalData, trialData] = await Promise.all([
          getUpcomingRenewals(),
          getExpiringTrials(),
        ]);
        setRenewals(renewalData);
        setTrials(trialData);

        if (getObligationDeadlines) {
          const deadlineData = await getObligationDeadlines();
          setDeadlines(deadlineData);
        }
      } catch {
        // Silently handle errors — data will remain empty
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [getUpcomingRenewals, getExpiringTrials, getObligationDeadlines]);

  const handleSaveLeadTime = async (vendor: string, days: number[]) => {
    await configureLeadTime(vendor, days);
    setLeadTimeConfigs((prev) => {
      const existing = prev.findIndex((c) => c.vendor === vendor);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { vendor, days };
        return updated;
      }
      return [...prev, { vendor, days }];
    });
  };

  const getVendorLeadTime = (vendor: string): number[] => {
    return leadTimeConfigs.find((c) => c.vendor === vendor)?.days ?? [30, 7, 3, 1];
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">Reminders</h2>
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading reminders…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-900">Reminders</h2>

      {/* ─── Upcoming Renewals ─────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Upcoming Renewals
          </h3>
          {renewals.length > 0 && (
            <span className="text-xs text-gray-500">{renewals.length} upcoming</span>
          )}
        </div>

        {renewals.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">No upcoming renewals.</p>
        ) : (
          <div className="space-y-2">
            {renewals
              .sort((a, b) => a.daysUntilRenewal - b.daysUntilRenewal)
              .map((renewal) => (
                <div
                  key={renewal.id}
                  className={`border-l-4 rounded-lg p-4 ${getUrgencyColor(renewal.daysUntilRenewal)}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {renewal.vendor}
                        </span>
                        <AlertBadge
                          level={getUrgencyLevel(renewal.daysUntilRenewal)}
                          label={`${renewal.daysUntilRenewal}d`}
                        />
                        {renewal.autoRenews && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700">
                            Auto-renew
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span>{formatCurrency(renewal.amount, renewal.currency)}</span>
                        <span>·</span>
                        <span>{formatDate(renewal.renewalDate)}</span>
                        <span>·</span>
                        <span>{renewal.billingFrequency}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setLeadTimeModalVendor(renewal.vendor)}
                        className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                        title="Configure reminder lead time"
                        aria-label={`Configure lead time for ${renewal.vendor}`}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </button>
                      <ActionButton
                        label="Review"
                        actionType="review"
                        onClick={() => {}}
                        variant="secondary"
                      />
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>

      {/* ─── Expiring Trials ──────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Expiring Trials
          </h3>
          {trials.length > 0 && (
            <span className="text-xs text-gray-500">{trials.length} expiring</span>
          )}
        </div>

        {trials.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">No expiring trials.</p>
        ) : (
          <div className="space-y-2">
            {trials
              .sort((a, b) => a.daysRemaining - b.daysRemaining)
              .map((trial) => (
                <div
                  key={trial.id}
                  className={`border-l-4 rounded-lg p-4 ${getUrgencyColor(trial.daysRemaining)}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {trial.vendor}
                        </span>
                        <AlertBadge
                          level={getUrgencyLevel(trial.daysRemaining)}
                          label={`${trial.daysRemaining}d left`}
                        />
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                        <span>Expires {formatDate(trial.trialEndDate)}</span>
                      </div>
                      {trial.autoConverts && trial.convertsToAmount != null && (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <svg className="w-3.5 h-3.5 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                          </svg>
                          <span className="text-xs font-medium text-amber-700">
                            Auto-converts to {formatCurrency(trial.convertsToAmount, 'USD')}
                            {trial.convertsToFrequency ? `/${trial.convertsToFrequency}` : ''}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <ActionButton
                        label="Cancel Trial"
                        actionType="cancel_trial"
                        onClick={() => onRequestDraft?.('trial_cancellation', trial.id)}
                        variant="danger"
                      />
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>

      {/* ─── Deadline Alerts ──────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Deadline Alerts
          </h3>
          {deadlines.length > 0 && (
            <span className="text-xs text-gray-500">{deadlines.length} deadlines</span>
          )}
        </div>

        {deadlines.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">No upcoming deadlines.</p>
        ) : (
          <div className="space-y-2">
            {deadlines
              .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
              .map((deadline) => {
                const daysUntil = Math.max(
                  0,
                  Math.ceil(
                    (new Date(deadline.date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                  )
                );
                return (
                  <div
                    key={deadline.id}
                    className={`border-l-4 rounded-lg p-4 ${getUrgencyColor(daysUntil)}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-gray-900">
                            {deadline.description}
                          </span>
                          <AlertBadge
                            level={getUrgencyLevel(daysUntil)}
                            label={`${daysUntil}d`}
                          />
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          <span className="capitalize">{deadline.type.replace(/_/g, ' ')}</span>
                          <span>·</span>
                          <span>{formatDate(deadline.date)}</span>
                          {deadline.amount != null && (
                            <>
                              <span>·</span>
                              <span>{formatCurrency(deadline.amount, 'USD')}</span>
                            </>
                          )}
                        </div>
                        {deadline.financialConsequence && (
                          <p className="text-xs text-red-600 mt-1">
                            ⚠ {deadline.financialConsequence}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0">
                        <ActionButton
                          label="Review"
                          actionType="review"
                          onClick={() => {}}
                          variant="secondary"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </section>

      {/* ─── Lead Time Configuration Modal ────────────────────────────── */}
      {leadTimeModalVendor && (
        <LeadTimeModal
          vendor={leadTimeModalVendor}
          currentDays={getVendorLeadTime(leadTimeModalVendor)}
          onSave={(days) => handleSaveLeadTime(leadTimeModalVendor, days)}
          onClose={() => setLeadTimeModalVendor(null)}
        />
      )}
    </div>
  );
}
