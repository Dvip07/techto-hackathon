/**
 * Backend Server — Express API + OAuth flow + SQLite database.
 *
 * Serves the Dashboard API endpoints, handles Gmail OAuth2 authentication,
 * and manages the SQLite database lifecycle.
 *
 * Run with: npx tsx src/server/index.ts
 */

import express from "express";
import cors from "cors";
import { config } from "dotenv";
import path from "path";
import fs from "fs";
import { SQLiteEntityStore } from "../store/entity-store.js";
import { authRouter, getStoredToken } from "./auth.js";
import { GmailConnector } from "../ingestion/gmail-connector.js";
import { createClaudeClassifier } from "../classifier/claude-classifier.js";
import { PipelineRunner } from "../pipeline/pipeline-runner.js";
import type { PipelineRunResult } from "../pipeline/pipeline-runner.js";

// Load environment variables from .env.local
config({ path: path.resolve(process.cwd(), ".env.local") });

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const DB_PATH = process.env.DATABASE_PATH ?? "./data/inbox-intelligence.db";

// Ensure data directory exists
const dataDir = path.dirname(path.resolve(process.cwd(), DB_PATH));
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ─── Initialize Database ─────────────────────────────────────────────────────

const store = new SQLiteEntityStore(path.resolve(process.cwd(), DB_PATH));
console.log(`✓ Database initialized at ${DB_PATH}`);

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();

app.use(cors({ origin: ["http://localhost:5173", "http://localhost:3000"], credentials: true }));
app.use(express.json());

// ─── Auth Routes (Gmail OAuth2) ──────────────────────────────────────────────

app.use("/auth", authRouter);

// ─── Health Check ────────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  const token = getStoredToken();
  res.json({
    status: "ok",
    database: "connected",
    gmail: token ? "connected" : "not_connected",
    gmailTokenExpiry: token?.expiresAt ?? null,
  });
});

// ─── API Routes ──────────────────────────────────────────────────────────────

// Priority Feed
app.get("/api/priority-feed", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    if (lastPipelineResult?.priorityFeed) {
      res.json(lastPipelineResult.priorityFeed.slice(0, limit));
    } else {
      res.json([]);
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch priority feed" });
  }
});

// Digest
app.get("/api/digest", async (_req, res) => {
  try {
    if (lastPipelineResult?.digest) {
      res.json(lastPipelineResult.digest);
    } else {
      res.json(null);
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch digest" });
  }
});

// Spend by Category
app.get("/api/spend/categories", async (_req, res) => {
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const categories = await store.getSpendByCategory({ start, end });
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch spend categories" });
  }
});

// Recurring Spend Timeline
app.get("/api/spend/recurring", async (_req, res) => {
  try {
    const snapshots = await store.getTotalRecurringSpend();
    res.json(snapshots);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch recurring spend" });
  }
});

// Subscriptions
app.get("/api/subscriptions", async (_req, res) => {
  try {
    const subscriptions = await store.getActiveSubscriptions();
    res.json(subscriptions);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch subscriptions" });
  }
});

app.get("/api/subscriptions/zombies", async (_req, res) => {
  try {
    const zombies = await store.getZombieSubscriptions();
    res.json(zombies);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch zombie subscriptions" });
  }
});

// Trials
app.get("/api/trials", async (_req, res) => {
  try {
    const trials = await store.getActiveTrials();
    res.json(trials);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch trials" });
  }
});

// Refunds
app.get("/api/refunds/pending", async (_req, res) => {
  try {
    const pending = await store.getPendingRefunds();
    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch pending refunds" });
  }
});

app.get("/api/refunds/overdue", async (_req, res) => {
  try {
    const overdue = await store.getOverdueRefunds();
    res.json(overdue);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch overdue refunds" });
  }
});

app.post("/api/refunds/:id/received", async (req, res) => {
  try {
    await store.markRefundReceived(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to mark refund received" });
  }
});

// Commitments
app.get("/api/commitments", async (_req, res) => {
  try {
    const open = await store.getOpenCommitments();
    const overdue = await store.getOverdueCommitments();
    res.json({ open, overdue });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch commitments" });
  }
});

// Obligations
app.get("/api/obligations", async (_req, res) => {
  try {
    const obligations = await store.getObligations();
    res.json(obligations);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch obligations" });
  }
});

// Payments / Spend
app.get("/api/spend/monthly", async (req, res) => {
  try {
    const months = parseInt(req.query.months as string) || 6;
    const summary = await store.getMonthlySpendSummary(months);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch monthly spend" });
  }
});

// Financial Calendar
app.get("/api/calendar", async (req, res) => {
  try {
    const start = req.query.start ? new Date(req.query.start as string) : new Date();
    const end = req.query.end
      ? new Date(req.query.end as string)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const entries = await store.getFinancialCalendar({ start, end });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch calendar" });
  }
});

// ─── Pipeline Trigger ────────────────────────────────────────────────────────

let pipelineRunner: PipelineRunner | null = null;
let lastPipelineResult: PipelineRunResult | null = null;
let pipelineRunning = false;

async function createPipelineRunner(): Promise<PipelineRunner> {
  const token = getStoredToken();
  if (!token) {
    throw new Error("Gmail not connected");
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new Error("ANTHROPIC_API_KEY not set in .env.local");
  }

  // Create Gmail connector and authenticate
  const gmailConnector = new GmailConnector();
  await gmailConnector.authenticate({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_REDIRECT_URI!,
    refreshToken: token.refreshToken,
  });

  // Create Claude classifier
  const classifier = createClaudeClassifier({
    apiKey: anthropicKey,
    model: "claude-haiku-4-5-20251001",
  });

  // Create pipeline runner
  return new PipelineRunner({
    gmailConnector,
    classifier,
    store,
    maxRunTimeMs: 300000, // 5 minutes to account for rate limit delays
    classificationBatchSize: 2, // 2 messages at a time to stay under 50k tokens/min
    generateDigest: true,
    digestChannel: "dashboard",
  });
}

app.post("/api/pipeline/run", async (_req, res) => {
  const token = getStoredToken();
  if (!token) {
    return res.status(401).json({ error: "Gmail not connected. Please authenticate first." });
  }

  if (pipelineRunning) {
    return res.status(409).json({ error: "Pipeline is already running. Please wait." });
  }

  try {
    pipelineRunning = true;
    console.log("🔄 Pipeline starting...");

    // Create or reuse pipeline runner
    if (!pipelineRunner) {
      pipelineRunner = await createPipelineRunner();
    }

    // Run the full pipeline
    const result = await pipelineRunner.runFullPipeline();
    lastPipelineResult = result;

    if (result.success) {
      console.log(`✓ Pipeline completed in ${result.durationMs}ms — ${result.messagesFetched} messages fetched, ${result.messagesClassified} classified, ${result.entitiesPersisted} entities persisted`);
    } else {
      console.error(`✗ Pipeline failed: ${result.error}`);
      // Invalidate runner on auth/token errors so it gets recreated next time
      if (result.error && (result.error.includes("401") || result.error.includes("token") || result.error.includes("auth"))) {
        pipelineRunner = null;
      }
    }

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pipeline failed";
    console.error("✗ Pipeline error:", message);
    // Invalidate runner on auth errors
    if (message.includes("401") || message.includes("token") || message.includes("auth") || message.includes("Token refresh failed")) {
      pipelineRunner = null;
    }
    res.status(500).json({ error: message });
  } finally {
    pipelineRunning = false;
  }
});

app.get("/api/pipeline/status", (_req, res) => {
  res.json({
    running: pipelineRunning,
    lastResult: lastPipelineResult ? {
      success: lastPipelineResult.success,
      durationMs: lastPipelineResult.durationMs,
      messagesFetched: lastPipelineResult.messagesFetched,
      messagesClassified: lastPipelineResult.messagesClassified,
      entitiesPersisted: lastPipelineResult.entitiesPersisted,
      warnings: lastPipelineResult.warnings,
      error: lastPipelineResult.error,
    } : null,
  });
});

// ─── Start Server ────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀 Inbox Intelligence API running at http://localhost:${PORT}`);
  console.log(`   Dashboard: http://localhost:5173`);
  console.log(`   Health:    http://localhost:${PORT}/api/health`);
  console.log(`   Auth:      http://localhost:${PORT}/auth/google\n`);
});

export { app, store };
