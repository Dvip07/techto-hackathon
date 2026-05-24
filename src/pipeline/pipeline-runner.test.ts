/**
 * Unit tests for the Pipeline Runner.
 *
 * Tests the full pipeline orchestration: fetch → classify → persist → analyze → act → digest.
 *
 * Requirements: 1.2, 2.1, 2.8, 3.1, 3.7, 20.1, 20.5
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PipelineRunner, type PipelineConfig } from "./pipeline-runner";
import { SQLiteEntityStore } from "../store/entity-store";
import type { GmailConnector } from "../ingestion/gmail-connector";
import type { ClaudeUnifiedClassifier } from "../classifier/claude-classifier";
import type { ParsedMessage } from "../ingestion/types";
import type { AnalyzedMessage } from "../types/signals";

// ─── Mock Factories ──────────────────────────────────────────────────────────

function createMockParsedMessage(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    threadId: "thread-1",
    timestamp: new Date(),
    sender: "billing@spotify.com",
    senderDomain: "spotify.com",
    subject: "Your monthly receipt",
    bodyText: "Your subscription payment of $9.99 has been processed.",
    bodyHtml: null,
    attachments: [],
    labels: ["INBOX"],
    snippet: "Your subscription payment...",
    ...overrides,
  };
}

function createMockAnalyzedMessage(
  parsedMsg: ParsedMessage,
  overrides: Partial<AnalyzedMessage> = {}
): AnalyzedMessage {
  return {
    messageId: parsedMsg.messageId,
    threadId: parsedMsg.threadId,
    timestamp: parsedMsg.timestamp,
    sender: parsedMsg.sender,
    senderDomain: parsedMsg.senderDomain,
    classifications: ["subscription_receipt"],
    subscriptionSignal: {
      vendor: "Spotify",
      vendorDomain: "spotify.com",
      amount: 9.99,
      currency: "USD",
      billingFrequency: "monthly",
      category: "music-streaming",
      renewalDate: null,
      isActive: true,
      isPriceChange: false,
      autoRenews: true,
    },
    commitmentSignals: [],
    contractSignal: null,
    refundSignal: null,
    trialSignal: null,
    financialEntities: [],
    usageIndicators: [],
    urgencyScore: 3,
    summary: "Monthly Spotify subscription receipt for $9.99",
    ...overrides,
  };
}

function createMockGmailConnector(): GmailConnector {
  return {
    authenticate: vi.fn().mockResolvedValue({
      accessToken: "test-token",
      refreshToken: "test-refresh",
      expiresAt: new Date(Date.now() + 3600000),
      tokenType: "Bearer",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    }),
    fetchMessages: vi.fn().mockResolvedValue([]),
    fetchThread: vi.fn().mockResolvedValue({ id: "thread-1", historyId: "123", messages: [] }),
    fetchAttachment: vi.fn().mockResolvedValue({ messageId: "", attachmentId: "", filename: "", mimeType: "", size: 0, data: "" }),
    getHistoryId: vi.fn().mockResolvedValue("history-456"),
    incrementalSync: vi.fn().mockResolvedValue([]),
  } as unknown as GmailConnector;
}

function createMockClassifier(
  analyzedMessages: AnalyzedMessage[] = []
): ClaudeUnifiedClassifier {
  return {
    analyzeMessage: vi.fn().mockImplementation(async (msg: ParsedMessage) => {
      const found = analyzedMessages.find((a) => a.messageId === msg.messageId);
      return found ?? createMockAnalyzedMessage(msg);
    }),
    analyzeBatch: vi.fn().mockImplementation(async (msgs: ParsedMessage[]) => {
      return msgs.map((msg) => {
        const found = analyzedMessages.find((a) => a.messageId === msg.messageId);
        return found ?? createMockAnalyzedMessage(msg);
      });
    }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PipelineRunner", () => {
  let store: SQLiteEntityStore;
  let mockConnector: GmailConnector;
  let mockClassifier: ClaudeUnifiedClassifier;
  let runner: PipelineRunner;

  beforeEach(() => {
    store = new SQLiteEntityStore(":memory:");
    mockConnector = createMockGmailConnector();
    mockClassifier = createMockClassifier();

    const config: PipelineConfig = {
      gmailConnector: mockConnector,
      classifier: mockClassifier,
      store,
      maxRunTimeMs: 30000,
      generateDigest: false, // Disable digest for most tests to simplify
    };

    runner = new PipelineRunner(config);
  });

  describe("runFullPipeline", () => {
    it("should complete successfully with no new messages", async () => {
      const result = await runner.runFullPipeline();

      expect(result.success).toBe(true);
      expect(result.messagesFetched).toBe(0);
      expect(result.messagesClassified).toBe(0);
      expect(result.entitiesPersisted).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.warnings).toEqual([]);
    });

    it("should use full fetch on first run (no lastHistoryId)", async () => {
      const result = await runner.runFullPipeline();

      expect(result.success).toBe(true);
      // On first run with no messages, fetchMessages should be called
      expect(mockConnector.fetchMessages).toHaveBeenCalled();
    });

    it("should use incremental sync when lastHistoryId is set", async () => {
      runner.setLastHistoryId("history-123");

      const result = await runner.runFullPipeline();

      expect(result.success).toBe(true);
      expect(mockConnector.incrementalSync).toHaveBeenCalledWith("history-123");
    });

    it("should classify and persist subscription messages", async () => {
      const parsedMsg = createMockParsedMessage();
      const analyzedMsg = createMockAnalyzedMessage(parsedMsg);

      // Mock the connector to return a raw message that the batch fetcher will normalize
      // Since BatchFetcher calls connector.fetchMessages, we mock at that level
      (mockConnector.fetchMessages as any).mockResolvedValue([
        {
          id: parsedMsg.messageId,
          threadId: parsedMsg.threadId,
          labelIds: ["INBOX"],
          snippet: parsedMsg.snippet,
          historyId: "100",
          internalDate: String(parsedMsg.timestamp.getTime()),
          payload: {
            partId: "0",
            mimeType: "text/plain",
            filename: "",
            headers: [
              { name: "From", value: parsedMsg.sender },
              { name: "Subject", value: parsedMsg.subject },
            ],
            body: {
              size: parsedMsg.bodyText.length,
              data: Buffer.from(parsedMsg.bodyText).toString("base64url"),
            },
          },
          sizeEstimate: 1000,
        },
      ]);

      (mockConnector.getHistoryId as any).mockResolvedValue("history-200");
      mockClassifier = createMockClassifier([analyzedMsg]);

      const config: PipelineConfig = {
        gmailConnector: mockConnector,
        classifier: mockClassifier,
        store,
        maxRunTimeMs: 30000,
        generateDigest: false,
      };

      runner = new PipelineRunner(config);

      const result = await runner.runFullPipeline();

      expect(result.success).toBe(true);
      expect(result.messagesFetched).toBe(1);
      expect(result.messagesClassified).toBe(1);
      expect(result.entitiesPersisted).toBeGreaterThan(0);
    });

    it("should update lastHistoryId after successful run", async () => {
      (mockConnector.getHistoryId as any).mockResolvedValue("history-new-789");

      await runner.runFullPipeline();

      const state = runner.getState();
      expect(state.lastHistoryId).toBe("history-new-789");
      expect(state.lastRunAt).toBeInstanceOf(Date);
      expect(state.totalRunCount).toBe(1);
    });

    it("should increment totalRunCount on each run", async () => {
      await runner.runFullPipeline();
      await runner.runFullPipeline();
      await runner.runFullPipeline();

      const state = runner.getState();
      expect(state.totalRunCount).toBe(3);
    });

    it("should return error result on fatal failure", async () => {
      (mockConnector.fetchMessages as any).mockRejectedValue(
        new Error("Gmail API unavailable")
      );

      const result = await runner.runFullPipeline();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Gmail API unavailable");
    });

    it("should persist trial records from trial signals", async () => {
      const parsedMsg = createMockParsedMessage({
        sender: "noreply@figma.com",
        senderDomain: "figma.com",
        subject: "Your free trial has started",
      });

      const trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + 14);

      const analyzedMsg = createMockAnalyzedMessage(parsedMsg, {
        classifications: ["trial_started"],
        subscriptionSignal: null,
        trialSignal: {
          vendor: "Figma",
          trialStartDate: new Date(),
          trialEndDate,
          convertsToAmount: 15,
          convertsToFrequency: "monthly",
          autoConverts: true,
          cancellationUrl: "https://figma.com/cancel",
        },
      });

      (mockConnector.fetchMessages as any).mockResolvedValue([
        {
          id: parsedMsg.messageId,
          threadId: parsedMsg.threadId,
          labelIds: ["INBOX"],
          snippet: "Your free trial",
          historyId: "100",
          internalDate: String(parsedMsg.timestamp.getTime()),
          payload: {
            partId: "0",
            mimeType: "text/plain",
            filename: "",
            headers: [
              { name: "From", value: parsedMsg.sender },
              { name: "Subject", value: parsedMsg.subject },
            ],
            body: {
              size: 100,
              data: Buffer.from("Your free trial has started").toString("base64url"),
            },
          },
          sizeEstimate: 500,
        },
      ]);

      (mockConnector.getHistoryId as any).mockResolvedValue("history-300");
      mockClassifier = createMockClassifier([analyzedMsg]);

      runner = new PipelineRunner({
        gmailConnector: mockConnector,
        classifier: mockClassifier,
        store,
        maxRunTimeMs: 30000,
        generateDigest: false,
      });

      const result = await runner.runFullPipeline();

      expect(result.success).toBe(true);

      // Verify trial was persisted
      const trials = await store.getActiveTrials();
      expect(trials.length).toBe(1);
      expect(trials[0].vendor).toBe("Figma");
      expect(trials[0].autoConverts).toBe(true);
      expect(trials[0].cancellationUrl).toBe("https://figma.com/cancel");
    });

    it("should persist refund records from refund signals", async () => {
      const parsedMsg = createMockParsedMessage({
        sender: "support@adobe.com",
        senderDomain: "adobe.com",
        subject: "Your refund has been initiated",
      });

      const analyzedMsg = createMockAnalyzedMessage(parsedMsg, {
        classifications: ["refund_promise"],
        subscriptionSignal: null,
        refundSignal: {
          vendor: "Adobe",
          amount: 54.99,
          currency: "USD",
          status: "promised",
          expectedDate: null,
          originalTransactionDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          reason: "Cancellation refund",
        },
      });

      (mockConnector.fetchMessages as any).mockResolvedValue([
        {
          id: parsedMsg.messageId,
          threadId: parsedMsg.threadId,
          labelIds: ["INBOX"],
          snippet: "Your refund",
          historyId: "100",
          internalDate: String(parsedMsg.timestamp.getTime()),
          payload: {
            partId: "0",
            mimeType: "text/plain",
            filename: "",
            headers: [
              { name: "From", value: parsedMsg.sender },
              { name: "Subject", value: parsedMsg.subject },
            ],
            body: {
              size: 100,
              data: Buffer.from("Your refund has been initiated").toString("base64url"),
            },
          },
          sizeEstimate: 500,
        },
      ]);

      (mockConnector.getHistoryId as any).mockResolvedValue("history-400");
      mockClassifier = createMockClassifier([analyzedMsg]);

      runner = new PipelineRunner({
        gmailConnector: mockConnector,
        classifier: mockClassifier,
        store,
        maxRunTimeMs: 30000,
        generateDigest: false,
      });

      const result = await runner.runFullPipeline();

      expect(result.success).toBe(true);

      // Verify refund was persisted with 14-day expected date
      const refunds = await store.getPendingRefunds();
      expect(refunds.length).toBe(1);
      expect(refunds[0].vendor).toBe("Adobe");
      expect(refunds[0].amount).toBe(54.99);
      expect(refunds[0].status).toBe("promised");
      // Expected date should be 14 days from now (since no specific date was given)
      const expectedDate = refunds[0].expectedByDate;
      const daysDiff = Math.round(
        (expectedDate.getTime() - parsedMsg.timestamp.getTime()) / (1000 * 60 * 60 * 24)
      );
      expect(daysDiff).toBe(14);
    });
  });

  describe("state management", () => {
    it("should allow setting lastHistoryId externally", () => {
      runner.setLastHistoryId("external-history-id");
      const state = runner.getState();
      expect(state.lastHistoryId).toBe("external-history-id");
    });

    it("should expose intelligence engine and ranker", () => {
      expect(runner.getIntelligenceEngine()).toBeDefined();
      expect(runner.getPriorityRanker()).toBeDefined();
      expect(runner.getDigestComposer()).toBeDefined();
    });
  });

  describe("performance", () => {
    it("should complete pipeline run in under 30 seconds for empty inbox", async () => {
      const result = await runner.runFullPipeline();

      expect(result.success).toBe(true);
      expect(result.durationMs).toBeLessThan(30000);
    });
  });
});
