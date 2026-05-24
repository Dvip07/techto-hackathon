import React from 'react';
import type { PrioritizedItem } from '../../types/outputs';
import { ActionButton } from './ActionButton';
import { AlertBadge } from './AlertBadge';

/**
 * PriorityCard — Displays a single prioritized insight with urgency indicator,
 * financial impact, and suggested actions.
 *
 * Used in the Overview tab priority feed and across other tabs.
 */

interface PriorityCardProps {
  item: PrioritizedItem;
  onAction?: (actionType: string, targetId: string) => void;
  onDismiss?: (itemId: string) => void;
}

function getUrgencyLevel(score: number): 'critical' | 'high' | 'medium' | 'low' {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatFeatureArea(area: string): string {
  return area
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function PriorityCard({ item, onAction, onDismiss }: PriorityCardProps) {
  const urgency = getUrgencyLevel(item.urgencyScore);

  const urgencyColors: Record<string, string> = {
    critical: 'border-l-red-500',
    high: 'border-l-orange-500',
    medium: 'border-l-yellow-500',
    low: 'border-l-green-500',
  };

  return (
    <article
      className={`bg-white rounded-lg border border-gray-200 border-l-4 ${urgencyColors[urgency]} shadow-sm hover:shadow-md transition-shadow`}
    >
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <AlertBadge level={urgency} />
              <span className="text-xs text-gray-500 font-medium">
                {formatFeatureArea(item.featureArea)}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-gray-900 leading-tight">
              {item.title}
            </h3>
          </div>

          {/* Dismiss button */}
          {onDismiss && (
            <button
              onClick={() => onDismiss(item.id)}
              className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
              aria-label="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Description */}
        <p className="mt-2 text-sm text-gray-600 leading-relaxed">
          {item.description}
        </p>

        {/* Meta row */}
        <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
          {item.financialImpact > 0 && (
            <span className="flex items-center gap-1 font-medium text-gray-700">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formatCurrency(item.financialImpact)}
            </span>
          )}
          {item.relatedVendor && (
            <span>{item.relatedVendor}</span>
          )}
          {item.dueDate && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
              {new Date(item.dueDate).toLocaleDateString()}
            </span>
          )}
        </div>

        {/* Actions */}
        {item.suggestedActions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {item.suggestedActions.map((action, idx) => (
              <ActionButton
                key={idx}
                label={action.label}
                actionType={action.type}
                onClick={() => onAction?.(action.type, item.id)}
                variant={idx === 0 ? 'primary' : 'secondary'}
              />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
