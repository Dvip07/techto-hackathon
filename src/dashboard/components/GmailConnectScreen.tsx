import React, { useEffect, useState } from 'react';

/**
 * GmailConnectScreen — Shown when Gmail is not yet connected.
 * Provides a button to start the OAuth2 flow and shows connection status.
 */

interface AuthStatus {
  connected: boolean;
  expired?: boolean;
  expiresAt?: string;
  scope?: string;
  hasRefreshToken?: boolean;
}

interface GmailConnectScreenProps {
  /** Base URL for the backend API (default: http://localhost:3001) */
  apiUrl?: string;
  /** Called when connection is established */
  onConnected?: () => void;
}

export function GmailConnectScreen({
  apiUrl = 'http://localhost:3001',
  onConnected,
}: GmailConnectScreenProps) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check auth status on mount and periodically
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    async function checkStatus() {
      try {
        const res = await fetch(`${apiUrl}/auth/status`);
        if (res.ok) {
          const data: AuthStatus = await res.json();
          setStatus(data);
          if (data.connected && !data.expired) {
            onConnected?.();
          }
        }
      } catch {
        setError('Cannot reach backend server. Make sure it\'s running on port 3001.');
      } finally {
        setLoading(false);
      }
    }

    checkStatus();
    // Poll every 3 seconds to detect when OAuth callback completes
    interval = setInterval(checkStatus, 3000);

    return () => clearInterval(interval);
  }, [apiUrl, onConnected]);

  const handleConnect = () => {
    // Open OAuth flow in the same window
    window.location.href = `${apiUrl}/auth/google`;
  };

  const handleDisconnect = async () => {
    try {
      await fetch(`${apiUrl}/auth/disconnect`, { method: 'POST' });
      setStatus({ connected: false });
    } catch {
      setError('Failed to disconnect');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-3 text-gray-500">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Checking connection status...
        </div>
      </div>
    );
  }

  // Already connected
  if (status?.connected && !status.expired) {
    return (
      <div className="max-w-md mx-auto mt-12 text-center space-y-4">
        <div className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-gray-900">Gmail Connected</h2>
        <p className="text-sm text-gray-500">
          Your inbox is linked. The system will scan your emails for financial intelligence.
        </p>
        <button
          onClick={handleDisconnect}
          className="text-sm text-red-600 hover:text-red-700 underline"
        >
          Disconnect Gmail
        </button>
      </div>
    );
  }

  // Not connected — show connect screen
  return (
    <div className="max-w-lg mx-auto mt-12 space-y-8">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="w-20 h-20 mx-auto rounded-2xl bg-brand-50 flex items-center justify-center">
          <svg className="w-10 h-10 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Connect Your Gmail</h1>
        <p className="text-gray-600 max-w-sm mx-auto">
          Inbox Intelligence needs read-only access to your Gmail to detect subscriptions,
          track commitments, and surface financial insights.
        </p>
      </div>

      {/* Error message */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* What we access */}
      <div className="bg-gray-50 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">What we'll access:</h3>
        <ul className="space-y-2">
          {[
            { icon: '📧', text: 'Read your emails (read-only — we never send or delete)' },
            { icon: '📎', text: 'Download attachments (receipts, invoices, contracts)' },
            { icon: '📅', text: 'Create calendar reminders for renewals and deadlines' },
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
              <span className="text-base">{item.icon}</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Privacy note */}
      <div className="bg-blue-50 rounded-xl p-4 flex items-start gap-3">
        <svg className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
        <div className="text-sm text-blue-800">
          <p className="font-medium">Your data stays private</p>
          <p className="mt-0.5 text-blue-700">
            All data is stored locally in SQLite on your machine. Nothing is sent to third-party servers
            except the Claude API for email classification.
          </p>
        </div>
      </div>

      {/* Connect button */}
      <div className="text-center">
        <button
          onClick={handleConnect}
          className="inline-flex items-center gap-3 px-6 py-3 bg-white border-2 border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-gray-300 transition-all text-sm font-medium text-gray-700"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Connect with Google
        </button>
      </div>

      {/* Setup instructions */}
      <details className="text-sm text-gray-500">
        <summary className="cursor-pointer hover:text-gray-700 font-medium">
          First time? Setup instructions
        </summary>
        <div className="mt-3 space-y-2 pl-4 border-l-2 border-gray-200">
          <p>1. Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" className="text-brand-600 underline">Google Cloud Console</a></p>
          <p>2. Create a new OAuth 2.0 Client ID (Web application)</p>
          <p>3. Add <code className="bg-gray-100 px-1 rounded">http://localhost:3001/auth/google/callback</code> as an authorized redirect URI</p>
          <p>4. Enable the <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener" className="text-brand-600 underline">Gmail API</a> and <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener" className="text-brand-600 underline">Calendar API</a></p>
          <p>5. Copy your Client ID and Secret into <code className="bg-gray-100 px-1 rounded">.env.local</code></p>
          <p>6. Restart the backend server: <code className="bg-gray-100 px-1 rounded">npm run server</code></p>
        </div>
      </details>
    </div>
  );
}
