import { useState, useCallback } from 'react';
import type { DashboardAPI } from '../../api/dashboard-api';
import type { DraftType, EmailDraft } from '../../types/outputs';

/**
 * useActionHandler — Custom hook that handles one-click actions across all tabs.
 *
 * For draft-generating actions (cancel, negotiate, follow_up, cancel_trial, switch_annual):
 *   Calls requestDraft → shows draft preview modal for user approval.
 *
 * For immediate actions (set_reminder, review, acknowledge):
 *   Executes directly without a draft preview.
 *
 * Requirements: 19.8, 17.6
 */

export interface ActionHandlerDeps {
  requestDraft: DashboardAPI['requestDraft'];
  approveDraft: DashboardAPI['approveDraft'];
  acknowledgeCreepAlert: DashboardAPI['acknowledgeCreepAlert'];
  dismissItem: DashboardAPI['dismissItem'];
  markRefundReceived: DashboardAPI['markRefundReceived'];
}

export type ActionStatus = 'idle' | 'loading' | 'success' | 'error';

export interface ActionState {
  status: ActionStatus;
  error: string | null;
}

/** Maps user-facing action types to DraftType values for the API */
const ACTION_TO_DRAFT_TYPE: Record<string, DraftType> = {
  cancel: 'cancellation',
  negotiate: 'negotiation',
  follow_up: 'refund_follow_up',
  cancel_trial: 'trial_cancellation',
  switch_annual: 'payment_follow_up',
};

/** Actions that require a draft preview before execution */
const DRAFT_ACTIONS = new Set(['cancel', 'negotiate', 'follow_up', 'cancel_trial', 'switch_annual']);

export interface UseActionHandlerResult {
  /** Trigger an action by type and target ID */
  handleAction: (actionType: string, targetId: string) => Promise<void>;
  /** The current draft being previewed (null if none) */
  pendingDraft: EmailDraft | null;
  /** Approve and send the pending draft */
  approvePendingDraft: () => Promise<void>;
  /** Cancel/dismiss the pending draft preview */
  cancelPendingDraft: () => void;
  /** Per-action loading state keyed by `${actionType}:${targetId}` */
  actionStates: Record<string, ActionState>;
  /** Whether any action is currently in progress */
  isAnyLoading: boolean;
  /** Last completed action info for UI updates */
  lastCompletedAction: { actionType: string; targetId: string } | null;
}

export function useActionHandler(deps: ActionHandlerDeps): UseActionHandlerResult {
  const [pendingDraft, setPendingDraft] = useState<EmailDraft | null>(null);
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [lastCompletedAction, setLastCompletedAction] = useState<{
    actionType: string;
    targetId: string;
  } | null>(null);

  const setActionState = useCallback((key: string, state: ActionState) => {
    setActionStates((prev) => ({ ...prev, [key]: state }));
  }, []);

  const handleAction = useCallback(
    async (actionType: string, targetId: string) => {
      const key = `${actionType}:${targetId}`;
      setActionState(key, { status: 'loading', error: null });

      try {
        if (DRAFT_ACTIONS.has(actionType)) {
          // Draft-generating action: request draft and show preview
          const draftType = ACTION_TO_DRAFT_TYPE[actionType];
          if (!draftType) {
            throw new Error(`Unknown draft action type: ${actionType}`);
          }
          const draft = await deps.requestDraft(draftType, targetId);
          setPendingDraft(draft);
          setActionState(key, { status: 'idle', error: null });
        } else if (actionType === 'acknowledge') {
          // Immediate action: acknowledge creep alert
          await deps.acknowledgeCreepAlert(targetId);
          setActionState(key, { status: 'success', error: null });
          setLastCompletedAction({ actionType, targetId });
        } else if (actionType === 'set_reminder') {
          // Immediate action: set reminder (handled by UI navigation)
          setActionState(key, { status: 'success', error: null });
          setLastCompletedAction({ actionType, targetId });
        } else if (actionType === 'review') {
          // Immediate action: review/highlight item (handled by UI navigation)
          setActionState(key, { status: 'success', error: null });
          setLastCompletedAction({ actionType, targetId });
        } else if (actionType === 'mark_refund_received') {
          // Immediate action: mark refund as received
          await deps.markRefundReceived(targetId);
          setActionState(key, { status: 'success', error: null });
          setLastCompletedAction({ actionType, targetId });
        } else if (actionType === 'dismiss') {
          // Immediate action: dismiss item
          await deps.dismissItem(targetId);
          setActionState(key, { status: 'success', error: null });
          setLastCompletedAction({ actionType, targetId });
        } else {
          throw new Error(`Unknown action type: ${actionType}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Action failed';
        setActionState(key, { status: 'error', error: message });
      }
    },
    [deps, setActionState]
  );

  const approvePendingDraft = useCallback(async () => {
    if (!pendingDraft) return;

    const key = `approve:${pendingDraft.id}`;
    setActionState(key, { status: 'loading', error: null });

    try {
      await deps.approveDraft(pendingDraft.id);
      setActionState(key, { status: 'success', error: null });
      setLastCompletedAction({
        actionType: pendingDraft.type,
        targetId: pendingDraft.targetId,
      });
      setPendingDraft(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to approve draft';
      setActionState(key, { status: 'error', error: message });
    }
  }, [pendingDraft, deps, setActionState]);

  const cancelPendingDraft = useCallback(() => {
    setPendingDraft(null);
  }, []);

  const isAnyLoading = Object.values(actionStates).some((s) => s.status === 'loading');

  return {
    handleAction,
    pendingDraft,
    approvePendingDraft,
    cancelPendingDraft,
    actionStates,
    isAnyLoading,
    lastCompletedAction,
  };
}
