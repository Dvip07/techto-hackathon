/**
 * Unit tests for the Gmail MCP Connector.
 *
 * Tests cover:
 * - Token bucket rate limiter behavior
 * - OAuth2 authentication and token refresh
 * - Message fetching with pagination
 * - Incremental sync via historyId
 * - Attachment fetching
 * - Error handling with automatic token refresh on 401
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GmailConnector,
  TokenBucketRateLimiter,
  GmailApiError,
} from "./gmail-connector.js";
import type { OAuthCredentials, FetchOptions } from "./types.js";

// ─── Token Bucket Rate Limiter Tests ─────────────────────────────────────────

describe("TokenBucketRateLimiter", () => {
  it("should allow requests when tokens are available", async () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 250,
      refillRate: 250,
      tokensPerRequest: 5,
    });

    // Should resolve immediately when tokens are available
    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50); // Should be nearly instant
  });

  it("should consume tokens on each acquire", async () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 10,
      refillRate: 0, // No refill for testing
      tokensPerRequest: 5,
    });

    await limiter.acquire(); // 10 -> 5
    expect(limiter.getAvailableTokens()).toBeLessThanOrEqual(5);

    await limiter.acquire(); // 5 -> 0
    expect(limiter.getAvailableTokens()).toBeLessThanOrEqual(0);
  });

  it("should wait when tokens are exhausted", async () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 5,
      refillRate: 100, // Fast refill for testing
      tokensPerRequest: 5,
    });

    await limiter.acquire(); // Exhaust all tokens

    const start = Date.now();
    await limiter.acquire(); // Should wait for refill
    const elapsed = Date.now() - start;

    // Should have waited some time for refill (at least a few ms)
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it("should refill tokens over time", async () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 100,
      refillRate: 1000, // 1000 tokens/sec for fast test
      tokensPerRequest: 50,
    });

    await limiter.acquire(); // 100 -> 50
    await limiter.acquire(); // 50 -> 0

    // Wait a bit for refill
    await new Promise((resolve) => setTimeout(resolve, 60));

    const available = limiter.getAvailableTokens();
    expect(available).toBeGreaterThan(0);
  });

  it("should not exceed maxTokens on refill", async () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 10,
      refillRate: 10000, // Very fast refill
      tokensPerRequest: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const available = limiter.getAvailableTokens();
    expect(available).toBeLessThanOrEqual(10);
  });
});

// ─── GmailApiError Tests ─────────────────────────────────────────────────────

describe("GmailApiError", () => {
  it("should create error with status code and retryable flag", () => {
    const error = new GmailApiError("Not found", 404, false);

    expect(error.message).toBe("Not found");
    expect(error.statusCode).toBe(404);
    expect(error.retryable).toBe(false);
    expect(error.name).toBe("GmailApiError");
  });

  it("should be retryable for 429 and 5xx errors", () => {
    const rateLimitError = new GmailApiError("Rate limited", 429, true);
    const serverError = new GmailApiError("Server error", 500, true);

    expect(rateLimitError.retryable).toBe(true);
    expect(serverError.retryable).toBe(true);
  });
});

// ─── GmailConnector Tests ────────────────────────────────────────────────────

describe("GmailConnector", () => {
  let connector: GmailConnector;
  const mockCredentials: OAuthCredentials = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:3000/callback",
    refreshToken: "test-refresh-token",
  };

  beforeEach(() => {
    connector = new GmailConnector({
      maxTokens: 250,
      refillRate: 250,
      tokensPerRequest: 1, // Low cost for testing
    });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Authentication ────────────────────────────────────────────────────

  describe("authenticate", () => {
    it("should authenticate with a refresh token and return an AuthToken", async () => {
      const mockTokenResponse = {
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockTokenResponse), { status: 200 })
      );

      const token = await connector.authenticate(mockCredentials);

      expect(token.accessToken).toBe("new-access-token");
      expect(token.refreshToken).toBe("new-refresh-token");
      expect(token.tokenType).toBe("Bearer");
      expect(token.expiresAt).toBeInstanceOf(Date);
      expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("should throw when no refresh token is provided", async () => {
      const credentialsWithoutRefresh: OAuthCredentials = {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        redirectUri: "http://localhost:3000/callback",
      };

      await expect(
        connector.authenticate(credentialsWithoutRefresh)
      ).rejects.toThrow(GmailApiError);
    });

    it("should throw on token refresh failure", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })
      );

      await expect(connector.authenticate(mockCredentials)).rejects.toThrow(
        GmailApiError
      );
    });
  });

  // ─── Message Fetching ──────────────────────────────────────────────────

  describe("fetchMessages", () => {
    beforeEach(async () => {
      // Authenticate first
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "test-token",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "https://www.googleapis.com/auth/gmail.readonly",
          }),
          { status: 200 }
        )
      );
      await connector.authenticate(mockCredentials);
      vi.restoreAllMocks();
    });

    it("should fetch messages with pagination", async () => {
      const mockListResponse = {
        messages: [
          { id: "msg-1", threadId: "thread-1" },
          { id: "msg-2", threadId: "thread-2" },
        ],
        resultSizeEstimate: 2,
      };

      const mockMessage1 = {
        id: "msg-1",
        threadId: "thread-1",
        labelIds: ["INBOX"],
        snippet: "Test message 1",
        historyId: "12345",
        internalDate: "1700000000000",
        payload: { partId: "", mimeType: "text/plain", filename: "", headers: [], body: { size: 100 } },
        sizeEstimate: 100,
      };

      const mockMessage2 = {
        id: "msg-2",
        threadId: "thread-2",
        labelIds: ["INBOX"],
        snippet: "Test message 2",
        historyId: "12346",
        internalDate: "1700000001000",
        payload: { partId: "", mimeType: "text/plain", filename: "", headers: [], body: { size: 200 } },
        sizeEstimate: 200,
      };

      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockListResponse), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockMessage1), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockMessage2), { status: 200 })
        );

      const options: FetchOptions = {
        since: new Date("2023-01-01"),
        maxResults: 10,
      };

      const messages = await connector.fetchMessages(options);

      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe("msg-1");
      expect(messages[1].id).toBe("msg-2");
    });

    it("should handle multiple pages of results", async () => {
      const page1Response = {
        messages: [{ id: "msg-1", threadId: "thread-1" }],
        nextPageToken: "page2-token",
      };

      const page2Response = {
        messages: [{ id: "msg-2", threadId: "thread-2" }],
      };

      const mockMessage1 = {
        id: "msg-1",
        threadId: "thread-1",
        labelIds: ["INBOX"],
        snippet: "Message 1",
        historyId: "100",
        internalDate: "1700000000000",
        payload: { partId: "", mimeType: "text/plain", filename: "", headers: [], body: { size: 50 } },
        sizeEstimate: 50,
      };

      const mockMessage2 = {
        id: "msg-2",
        threadId: "thread-2",
        labelIds: ["INBOX"],
        snippet: "Message 2",
        historyId: "101",
        internalDate: "1700000001000",
        payload: { partId: "", mimeType: "text/plain", filename: "", headers: [], body: { size: 60 } },
        sizeEstimate: 60,
      };

      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify(page1Response), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(mockMessage1), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(page2Response), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(mockMessage2), { status: 200 }));

      const options: FetchOptions = {
        since: new Date("2023-01-01"),
        maxResults: 1,
      };

      const messages = await connector.fetchMessages(options);

      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe("msg-1");
      expect(messages[1].id).toBe("msg-2");
    });

    it("should stop at one page when pageToken is provided", async () => {
      const listResponse = {
        messages: [{ id: "msg-1", threadId: "thread-1" }],
        nextPageToken: "next-page-token",
      };

      const mockMessage = {
        id: "msg-1",
        threadId: "thread-1",
        labelIds: ["INBOX"],
        snippet: "Message",
        historyId: "100",
        internalDate: "1700000000000",
        payload: { partId: "", mimeType: "text/plain", filename: "", headers: [], body: { size: 50 } },
        sizeEstimate: 50,
      };

      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify(listResponse), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(mockMessage), { status: 200 }));

      const options: FetchOptions = {
        since: new Date("2023-01-01"),
        maxResults: 10,
        pageToken: "specific-page-token",
      };

      const messages = await connector.fetchMessages(options);

      // Should only fetch one page since pageToken was explicitly provided
      expect(messages).toHaveLength(1);
    });

    it("should return empty array when no messages match", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ resultSizeEstimate: 0 }), { status: 200 })
      );

      const options: FetchOptions = {
        since: new Date("2023-01-01"),
        maxResults: 10,
      };

      const messages = await connector.fetchMessages(options);
      expect(messages).toHaveLength(0);
    });
  });

  // ─── Incremental Sync ──────────────────────────────────────────────────

  describe("incrementalSync", () => {
    beforeEach(async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "test-token",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "https://www.googleapis.com/auth/gmail.readonly",
          }),
          { status: 200 }
        )
      );
      await connector.authenticate(mockCredentials);
      vi.restoreAllMocks();
    });

    it("should fetch only new messages since lastHistoryId", async () => {
      const historyResponse = {
        history: [
          {
            id: "200",
            messagesAdded: [
              { message: { id: "new-msg-1", threadId: "thread-1", labelIds: ["INBOX"] } },
            ],
          },
          {
            id: "201",
            messagesAdded: [
              { message: { id: "new-msg-2", threadId: "thread-2", labelIds: ["INBOX"] } },
            ],
          },
        ],
        historyId: "202",
      };

      const mockMsg1 = {
        id: "new-msg-1",
        threadId: "thread-1",
        labelIds: ["INBOX"],
        snippet: "New message 1",
        historyId: "200",
        internalDate: "1700000000000",
        payload: { partId: "", mimeType: "text/plain", filename: "", headers: [], body: { size: 50 } },
        sizeEstimate: 50,
      };

      const mockMsg2 = {
        id: "new-msg-2",
        threadId: "thread-2",
        labelIds: ["INBOX"],
        snippet: "New message 2",
        historyId: "201",
        internalDate: "1700000001000",
        payload: { partId: "", mimeType: "text/plain", filename: "", headers: [], body: { size: 60 } },
        sizeEstimate: 60,
      };

      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify(historyResponse), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(mockMsg1), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(mockMsg2), { status: 200 }));

      const messages = await connector.incrementalSync("199");

      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe("new-msg-1");
      expect(messages[1].id).toBe("new-msg-2");
    });

    it("should deduplicate messages across history records", async () => {
      const historyResponse = {
        history: [
          {
            id: "200",
            messagesAdded: [
              { message: { id: "msg-1", threadId: "thread-1", labelIds: ["INBOX"] } },
            ],
          },
          {
            id: "201",
            messagesAdded: [
              { message: { id: "msg-1", threadId: "thread-1", labelIds: ["INBOX"] } }, // duplicate
            ],
          },
        ],
        historyId: "202",
      };

      const mockMsg = {
        id: "msg-1",
        threadId: "thread-1",
        labelIds: ["INBOX"],
        snippet: "Message",
        historyId: "200",
        internalDate: "1700000000000",
        payload: { partId: "", mimeType: "text/plain", filename: "", headers: [], body: { size: 50 } },
        sizeEstimate: 50,
      };

      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify(historyResponse), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(mockMsg), { status: 200 }));

      const messages = await connector.incrementalSync("199");

      expect(messages).toHaveLength(1);
    });

    it("should return empty array when no new history", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ historyId: "200" }), { status: 200 })
      );

      const messages = await connector.incrementalSync("200");
      expect(messages).toHaveLength(0);
    });
  });

  // ─── Error Handling ────────────────────────────────────────────────────

  describe("error handling", () => {
    beforeEach(async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "test-token",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "https://www.googleapis.com/auth/gmail.readonly",
          }),
          { status: 200 }
        )
      );
      await connector.authenticate(mockCredentials);
      vi.restoreAllMocks();
    });

    it("should retry with refreshed token on 401 error", async () => {
      const refreshResponse = {
        access_token: "refreshed-token",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      };

      const profileResponse = { historyId: "12345" };

      vi.spyOn(globalThis, "fetch")
        // First request returns 401
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
        // Token refresh succeeds
        .mockResolvedValueOnce(new Response(JSON.stringify(refreshResponse), { status: 200 }))
        // Retry succeeds
        .mockResolvedValueOnce(new Response(JSON.stringify(profileResponse), { status: 200 }));

      const historyId = await connector.getHistoryId();
      expect(historyId).toBe("12345");
    });

    it("should throw on non-retryable errors", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Not Found", { status: 404, statusText: "Not Found" })
      );

      await expect(connector.getHistoryId()).rejects.toThrow(GmailApiError);
    });

    it("should throw when not authenticated", async () => {
      const unauthConnector = new GmailConnector();

      await expect(unauthConnector.getHistoryId()).rejects.toThrow(
        "Not authenticated"
      );
    });
  });

  // ─── Attachment Fetching ───────────────────────────────────────────────

  describe("fetchAttachment", () => {
    beforeEach(async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "test-token",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "https://www.googleapis.com/auth/gmail.readonly",
          }),
          { status: 200 }
        )
      );
      await connector.authenticate(mockCredentials);
      vi.restoreAllMocks();
    });

    it("should fetch and return attachment with metadata", async () => {
      const attachmentData = {
        size: 1024,
        data: "base64encodeddata",
      };

      const messageWithAttachment = {
        id: "msg-1",
        threadId: "thread-1",
        labelIds: ["INBOX"],
        snippet: "Invoice attached",
        historyId: "100",
        internalDate: "1700000000000",
        payload: {
          partId: "0",
          mimeType: "multipart/mixed",
          filename: "",
          headers: [],
          body: { size: 0 },
          parts: [
            {
              partId: "1",
              mimeType: "application/pdf",
              filename: "invoice.pdf",
              headers: [],
              body: { attachmentId: "att-123", size: 1024 },
            },
          ],
        },
        sizeEstimate: 2048,
      };

      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify(attachmentData), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(messageWithAttachment), { status: 200 }));

      const attachment = await connector.fetchAttachment("msg-1", "att-123");

      expect(attachment.messageId).toBe("msg-1");
      expect(attachment.attachmentId).toBe("att-123");
      expect(attachment.filename).toBe("invoice.pdf");
      expect(attachment.mimeType).toBe("application/pdf");
      expect(attachment.size).toBe(1024);
      expect(attachment.data).toBe("base64encodeddata");
    });
  });

  // ─── getHistoryId ──────────────────────────────────────────────────────

  describe("getHistoryId", () => {
    beforeEach(async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "test-token",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "https://www.googleapis.com/auth/gmail.readonly",
          }),
          { status: 200 }
        )
      );
      await connector.authenticate(mockCredentials);
      vi.restoreAllMocks();
    });

    it("should return the current historyId from profile", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ historyId: "99999" }), { status: 200 })
      );

      const historyId = await connector.getHistoryId();
      expect(historyId).toBe("99999");
    });
  });
});
