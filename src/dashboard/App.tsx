import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { TabBar, type TabItem } from './components/TabBar';
import { DraftPreviewModal } from './components/DraftPreviewModal';
import { GmailConnectScreen } from './components/GmailConnectScreen';
import { RemindersTab } from './tabs/RemindersTab';
import { ObligationsTab } from './tabs/ObligationsTab';
import { OverviewTab } from './tabs/OverviewTab';
import { CommitmentsTab } from './tabs/CommitmentsTab';
import { SavingsTab } from './tabs/SavingsTab';
import { PatternsTab } from './tabs/PatternsTab';
import { SubscriptionsTab } from './tabs/SubscriptionsTab';
import { useActionHandler, type ActionHandlerDeps } from './hooks/useActionHandler';
import type { DashboardAPI } from '../api/dashboard-api';

/**
 * Dashboard App — Unified React + Tailwind frontend that surfaces
 * prioritized insights with one-click actions across all feature tabs.
 *
 * Requirements: 19.1, 19.8, 17.6
 */

export type DashboardTab =
  | 'overview'
  | 'subscriptions'
  | 'savings'
  | 'reminders'
  | 'patterns'
  | 'commitments'
  | 'obligations';

const tabs: TabItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    id: 'subscriptions',
    label: 'Subscriptions',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
      </svg>
    ),
  },
  {
    id: 'savings',
    label: 'Savings',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id: 'reminders',
    label: 'Reminders',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
    ),
  },
  {
    id: 'patterns',
    label: 'Patterns',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
  {
    id: 'commitments',
    label: 'Commitments',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id: 'obligations',
    label: 'Obligations',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
  },
];

/** Props for the App component — accepts an optional DashboardAPI instance */
export interface AppProps {
  api?: DashboardAPI;
}

export function App({ api }: AppProps = {}) {
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);

  const API_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL)
    || 'http://localhost:3001';

  const [pipelineStatus, setPipelineStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');

  // Check Gmail connection status on mount
  useEffect(() => {
    fetch(`${API_URL}/auth/status`)
      .then((res) => res.json())
      .then((data) => {
        setGmailConnected(data.connected === true);
        // If connected, check if pipeline has run; if not, trigger it
        if (data.connected === true) {
          fetch(`${API_URL}/api/pipeline/status`)
            .then((r) => r.json())
            .then((status) => {
              if (!status.lastResult && !status.running) {
                setPipelineStatus('running');
                fetch(`${API_URL}/api/pipeline/run`, { method: 'POST' })
                  .then((r) => r.json())
                  .then((result) => setPipelineStatus(result.success ? 'done' : 'error'))
                  .catch(() => setPipelineStatus('error'));
              } else if (status.running) {
                setPipelineStatus('running');
              } else {
                setPipelineStatus('done');
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => setGmailConnected(false));
  }, [API_URL]);

  // Create action handler dependencies from the API (or use no-op stubs)
  const actionDeps: ActionHandlerDeps = useMemo(() => ({
    requestDraft: api
      ? (type, targetId) => api.requestDraft(type, targetId)
      : async () => { throw new Error('API not connected'); },
    approveDraft: api
      ? (draftId) => api.approveDraft(draftId)
      : async () => { throw new Error('API not connected'); },
    acknowledgeCreepAlert: api
      ? (alertId) => api.acknowledgeCreepAlert(alertId)
      : async () => {},
    dismissItem: api
      ? (itemId) => api.dismissItem(itemId)
      : async () => {},
    markRefundReceived: api
      ? (refundId) => api.markRefundReceived(refundId)
      : async () => {},
  }), [api]);

  const {
    handleAction,
    pendingDraft,
    approvePendingDraft,
    cancelPendingDraft,
  } = useActionHandler(actionDeps);

  // Show Gmail connect screen if not connected
  if (gmailConnected === false) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <GmailConnectScreen
          apiUrl={API_URL}
          onConnected={() => {
            setGmailConnected(true);
            // Trigger pipeline to fetch and parse emails
            setPipelineStatus('running');
            fetch(`${API_URL}/api/pipeline/run`, { method: 'POST' })
              .then((r) => r.json())
              .then((result) => setPipelineStatus(result.success ? 'done' : 'error'))
              .catch(() => setPipelineStatus('error'));
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Pipeline status banner */}
      {pipelineStatus === 'running' && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-brand-600 text-white text-center text-sm py-2 px-4">
          Scanning your inbox and analyzing emails with AI... This may take a minute.
        </div>
      )}

      {/* Sidebar navigation — desktop */}
      <aside className="hidden md:flex md:flex-col md:w-64 bg-white border-r border-gray-200">
        <div className="flex items-center gap-2 px-6 py-5 border-b border-gray-100">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-gray-900">Inbox Intelligence</h1>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as DashboardTab)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header */}
        <header className="md:hidden flex items-center gap-2 px-4 py-3 bg-white border-b border-gray-200">
          <div className="w-7 h-7 rounded-md bg-brand-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
          <h1 className="text-base font-semibold text-gray-900">Inbox Intelligence</h1>
        </header>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
          <TabContent activeTab={activeTab} onAction={handleAction} api={api} />
        </div>
      </main>

      {/* Bottom tab bar — mobile */}
      <TabBar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as DashboardTab)}
      />

      {/* Draft Preview Modal — shown when a draft action is pending approval */}
      {pendingDraft && (
        <DraftPreviewModal
          draft={pendingDraft}
          onApprove={approvePendingDraft}
          onCancel={cancelPendingDraft}
        />
      )}
    </div>
  );
}

/** Tab content — renders the active tab's component with the shared onAction handler */
function TabContent({
  activeTab,
  onAction,
}: {
  activeTab: DashboardTab;
  onAction: (actionType: string, targetId: string) => Promise<void>;
  api?: DashboardAPI;
}) {
  const API_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL)
    || 'http://localhost:3001';

  const getPriorityFeed = useCallback(
    async (limit: number) => {
      const res = await fetch(`${API_URL}/api/priority-feed?limit=${limit}`);
      if (!res.ok) return [];
      return res.json();
    },
    [API_URL]
  );

  const getSmartDigest = useCallback(
    async (_period: 'daily' | 'weekly') => {
      const res = await fetch(`${API_URL}/api/digest`);
      if (!res.ok) {
        return {
          id: 'digest-empty',
          period: 'daily' as const,
          generatedAt: new Date(),
          coveringRange: { start: new Date(), end: new Date() },
          totalRecurringSpend: 0,
          spendChangeFromLastPeriod: 0,
          totalPotentialSavings: 0,
          topAlerts: [],
          renewalsThisPeriod: [],
          expiringTrials: [],
          overdueRefunds: [],
          brokenPaymentPromises: [],
          savingsOpportunities: [],
          spendingInsight: '',
          creepWarning: null,
          oneClickActions: [],
        };
      }
      const data = await res.json();
      return data ?? {
        id: 'digest-empty',
        period: 'daily' as const,
        generatedAt: new Date(),
        coveringRange: { start: new Date(), end: new Date() },
        totalRecurringSpend: 0,
        spendChangeFromLastPeriod: 0,
        totalPotentialSavings: 0,
        topAlerts: [],
        renewalsThisPeriod: [],
        expiringTrials: [],
        overdueRefunds: [],
        brokenPaymentPromises: [],
        savingsOpportunities: [],
        spendingInsight: '',
        creepWarning: null,
        oneClickActions: [],
      };
    },
    [API_URL]
  );

  const dismissItem = useCallback(async (_itemId: string) => {}, []);

  if (activeTab === 'overview') {
    return (
      <OverviewTab
        getPriorityFeed={getPriorityFeed}
        getSmartDigest={getSmartDigest}
        dismissItem={dismissItem}
        onAction={(actionType, targetId) => {
          onAction(actionType, targetId);
        }}
      />
    );
  }

  if (activeTab === 'savings') {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">Savings — Recommendations, Optimizer & Negotiation</h2>
        <SavingsTab
          getTotalPotentialSavings={async () => ({
            totalPotentialMonthlySavings: 0,
            totalPotentialAnnualSavings: 0,
            recommendationCount: 0,
            negotiationCount: 0,
            billingOptimizationCount: 0,
          })}
          getSavingsRecommendations={async () => []}
          getBillingOptimizations={async () => []}
          getNegotiationOpportunities={async () => []}
          onAction={(actionType, targetId) => {
            onAction(actionType, targetId);
          }}
        />
      </div>
    );
  }

  if (activeTab === 'subscriptions') {
    return <SubscriptionsTab />;
  }

  if (activeTab === 'commitments') {
    return (
      <CommitmentsTab
        onFollowUp={(commitmentId) => {
          onAction('follow_up', commitmentId);
        }}
        onMarkRefundReceived={(refundId) => {
          onAction('mark_refund_received', refundId);
        }}
      />
    );
  }

  if (activeTab === 'obligations') {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">Obligations — Contracts & Risk</h2>
        <ObligationsTab />
      </div>
    );
  }

  if (activeTab === 'patterns') {
    return <PatternsTab />;
  }

  if (activeTab === 'reminders') {
    return (
      <RemindersTab
        getUpcomingRenewals={async () => {
          const res = await fetch(`${API_URL}/api/subscriptions`);
          if (!res.ok) return [];
          const subs = await res.json();
          return subs
            .filter((s: any) => s.nextRenewalDate)
            .map((s: any) => ({
              id: s.id,
              vendor: s.vendor,
              amount: s.amount,
              currency: s.currency,
              renewalDate: s.nextRenewalDate,
              daysUntilRenewal: Math.ceil((new Date(s.nextRenewalDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
              autoRenews: s.autoRenews,
              billingFrequency: s.billingFrequency,
              cancellationUrl: null,
              leadTimeAlerts: [30, 7, 1],
            }));
        }}
        getExpiringTrials={async () => {
          const res = await fetch(`${API_URL}/api/trials`);
          if (!res.ok) return [];
          return res.json();
        }}
        getObligationDeadlines={async () => []}
        configureLeadTime={async () => {}}
        onRequestDraft={(type, targetId) => {
          onAction(type === 'trial_cancellation' ? 'cancel_trial' : type, targetId);
        }}
      />
    );
  }

  return null;
}
