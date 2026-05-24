import React from 'react';

/**
 * AlertBadge — Visual urgency indicator used in priority cards and alerts.
 * Maps urgency levels to colors and labels.
 */

interface AlertBadgeProps {
  level: 'critical' | 'high' | 'medium' | 'low';
  label?: string;
  count?: number;
}

const levelConfig: Record<string, { bg: string; text: string; dot: string; defaultLabel: string }> = {
  critical: {
    bg: 'bg-red-50',
    text: 'text-red-700',
    dot: 'bg-red-500',
    defaultLabel: 'Critical',
  },
  high: {
    bg: 'bg-orange-50',
    text: 'text-orange-700',
    dot: 'bg-orange-500',
    defaultLabel: 'High',
  },
  medium: {
    bg: 'bg-yellow-50',
    text: 'text-yellow-700',
    dot: 'bg-yellow-500',
    defaultLabel: 'Medium',
  },
  low: {
    bg: 'bg-green-50',
    text: 'text-green-700',
    dot: 'bg-green-500',
    defaultLabel: 'Low',
  },
};

export function AlertBadge({ level, label, count }: AlertBadgeProps) {
  const config = levelConfig[level];
  const displayLabel = label ?? config.defaultLabel;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${config.bg} ${config.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} aria-hidden="true" />
      {displayLabel}
      {count != null && count > 0 && (
        <span className="ml-0.5 font-semibold">({count})</span>
      )}
    </span>
  );
}
