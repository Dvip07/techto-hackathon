import React, { useState } from 'react';
import type { EmailDraft } from '../../types/outputs';

/**
 * DraftPreviewModal — Shows a generated email draft for user approval before sending.
 *
 * Displays the draft's to, subject, and body fields with "Approve & Send" and "Cancel" buttons.
 * On approve: calls the approveDraft callback. Shows loading state during approval.
 * Closes on cancel or after successful approval.
 *
 * Requirements: 17.6 (user approval before sending)
 */

interface DraftPreviewModalProps {
  /** The email draft to preview */
  draft: EmailDraft;
  /** Called when user approves the draft for sending */
  onApprove: () => Promise<void>;
  /** Called when user cancels/dismisses the preview */
  onCancel: () => void;
}

const draftTypeLabels: Record<string, string> = {
  cancellation: 'Cancellation Email',
  negotiation: 'Negotiation Email',
  refund_follow_up: 'Follow-Up Email',
  trial_cancellation: 'Trial Cancellation Email',
  payment_follow_up: 'Payment Follow-Up Email',
};

export function DraftPreviewModal({ draft, onApprove, onCancel }: DraftPreviewModalProps) {
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    setApproving(true);
    setError(null);
    try {
      await onApprove();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send draft');
      setApproving(false);
    }
  };

  const typeLabel = draftTypeLabels[draft.type] ?? 'Email Draft';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="draft-preview-title"
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 id="draft-preview-title" className="text-base font-semibold text-gray-900">
              {typeLabel}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Review before sending</p>
          </div>
          <button
            onClick={onCancel}
            disabled={approving}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
            aria-label="Close draft preview"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Draft content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* To field */}
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              To
            </label>
            <p className="text-sm text-gray-900 bg-gray-50 rounded-md px-3 py-2">
              {draft.to}
            </p>
          </div>

          {/* Subject field */}
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              Subject
            </label>
            <p className="text-sm font-medium text-gray-900 bg-gray-50 rounded-md px-3 py-2">
              {draft.subject}
            </p>
          </div>

          {/* Body field */}
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              Body
            </label>
            <div className="text-sm text-gray-800 bg-gray-50 rounded-md px-3 py-3 whitespace-pre-wrap leading-relaxed min-h-[120px]">
              {draft.body}
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <button
            onClick={onCancel}
            disabled={approving}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleApprove}
            disabled={approving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {approving ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Sending…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
                Approve &amp; Send
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
