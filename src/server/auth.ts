/**
 * Gmail OAuth2 Authentication Router
 *
 * Handles the OAuth2 flow:
 * 1. GET /auth/google → Redirects to Google consent screen
 * 2. GET /auth/google/callback → Exchanges code for tokens, stores them
 * 3. GET /auth/status → Returns current auth status
 * 4. POST /auth/disconnect → Clears stored tokens
 */

import { Router } from "express";
import type { AuthToken } from "../ingestion/types.js";

const router = Router();

// In-memory token storage (in production, persist to DB or encrypted file)
let storedToken: AuthToken | null = null;

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

// ─── Helper: Get OAuth config from env ───────────────────────────────────────

function getOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3001/auth/google/callback";

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env"
    );
  }

  return { clientId, clientSecret, redirectUri };
}

// ─── GET /auth/google — Start OAuth flow ─────────────────────────────────────

router.get("/google", (_req, res) => {
  try {
    const { clientId, redirectUri } = getOAuthConfig();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
    });

    res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  } catch (err) {
    res.status(500).json({
      error: "OAuth not configured",
      message: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local",
    });
  }
});

// ─── GET /auth/google/callback — Exchange code for tokens ────────────────────

router.get("/google/callback", async (req, res) => {
  const code = req.query.code as string;
  const error = req.query.error as string;

  if (error) {
    return res.status(400).send(`
      <html>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h2>❌ Authentication Failed</h2>
          <p>Error: ${error}</p>
          <p><a href="http://localhost:5173">Return to Dashboard</a></p>
        </body>
      </html>
    `);
  }

  if (!code) {
    return res.status(400).send("Missing authorization code");
  }

  try {
    const { clientId, clientSecret, redirectUri } = getOAuthConfig();

    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${errBody}`);
    }

    const data = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
      scope: string;
    };

    storedToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? "",
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      tokenType: data.token_type,
      scope: data.scope,
    };

    console.log("✓ Gmail authenticated successfully");

    // Redirect back to dashboard with success and auto-trigger pipeline
    res.send(`
      <html>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h2>✅ Gmail Connected Successfully!</h2>
          <p>Your inbox is now linked to Inbox Intelligence.</p>
          <p>Starting inbox scan... Redirecting to dashboard...</p>
          <script>
            // Trigger pipeline run after a short delay to let token settle
            setTimeout(() => {
              fetch('http://localhost:3001/api/pipeline/run', { method: 'POST' })
                .catch(() => {});
            }, 3000);
            setTimeout(() => window.location.href = 'http://localhost:5173', 2000);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.status(500).send(`
      <html>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h2>❌ Authentication Error</h2>
          <p>${err instanceof Error ? err.message : "Unknown error"}</p>
          <p><a href="http://localhost:5173">Return to Dashboard</a></p>
        </body>
      </html>
    `);
  }
});

// ─── GET /auth/status — Check current auth state ─────────────────────────────

router.get("/status", (_req, res) => {
  if (!storedToken) {
    return res.json({ connected: false });
  }

  const isExpired = storedToken.expiresAt <= new Date();

  res.json({
    connected: true,
    expired: isExpired,
    expiresAt: storedToken.expiresAt,
    scope: storedToken.scope,
    hasRefreshToken: !!storedToken.refreshToken,
  });
});

// ─── POST /auth/disconnect — Clear stored tokens ─────────────────────────────

router.post("/disconnect", (_req, res) => {
  storedToken = null;
  console.log("✓ Gmail disconnected");
  res.json({ success: true, message: "Gmail disconnected" });
});

// ─── Export ──────────────────────────────────────────────────────────────────

export const authRouter = router;

export function getStoredToken(): AuthToken | null {
  return storedToken;
}

export function setStoredToken(token: AuthToken): void {
  storedToken = token;
}
