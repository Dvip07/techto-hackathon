/**
 * Gmail MCP Connector
 *
 * Authenticates with Gmail API via OAuth2, fetches messages with pagination,
 * performs incremental sync via historyId, respects rate limits, downloads
 * attachments, and handles errors with automatic token refresh.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */

import type {
  Attachment,
  AuthToken,
  FetchOptions,
  GmailHistoryResponse,
  GmailMCPConnector,
  GmailMessageListResponse,
  GmailTokenResponse,
  OAuthCredentials,
  RateLimiterConfig,
  RawMessage,
  RawThread,
} from "./types.js";

// ─── Token Bucket Rate Limiter ───────────────────────────────────────────────

/**
 * Token bucket rate limiter to respect Gmail API quota of 250 units/second.
 * Each API request consumes a configurable number of tokens.
 */
export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefillTime: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private readonly tokensPerRequest: number;

  constructor(config: RateLimiterConfig) {
    this.maxTokens = config.maxTokens;
    this.refillRate = config.refillRate;
    this.tokensPerRequest = config.tokensPerRequest;
    this.tokens = config.maxTokens;
    this.lastRefillTime = Date.now();
  }

  /**
   * Refills tokens based on elapsed time since last refill.
   */
  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillTime;
    const tokensToAdd = (elapsedMs / 1000) * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefillTime = now;
  }

  /**
   * Waits until enough tokens are available, then consumes them.
   * Returns a promise that resolves when the request can proceed.
   */
  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= this.tokensPerRequest) {
      this.tokens -= this.tokensPerRequest;
      return;
    }

    // Calculate wait time until enough tokens are available
    const deficit = this.tokensPerRequest - this.tokens;
    const waitMs = (deficit / this.refillRate) * 1000;

    await new Promise((resolve) => setTimeout(resolve, waitMs));

    this.refill();
    this.tokens -= this.tokensPerRequest;
  }

  /**
   * Returns the current number of available tokens (for testing/monitoring).
   */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }
}

// ─── Gmail API Error ─────────────────────────────────────────────────────────

export class GmailApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

// ─── Gmail MCP Connector Implementation ─────────────────────────────────────

const GMAIL_API_BASE = "https://www.googleapis.com/gmail/v1/users/me";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

const DEFAULT_RATE_LIMIT_CONFIG: RateLimiterConfig = {
  maxTokens: 50,
  refillRate: 10, // Conservative: 10 tokens per second to avoid 429s
  tokensPerRequest: 1,
};

export class GmailConnector implements GmailMCPConnector {
  private authToken: AuthToken | null = null;
  private credentials: OAuthCredentials | null = null;
  private rateLimiter: TokenBucketRateLimiter;
  private lastKnownHistoryId: string | null = null;

  constructor(rateLimitConfig?: RateLimiterConfig) {
    this.rateLimiter = new TokenBucketRateLimiter(
      rateLimitConfig ?? DEFAULT_RATE_LIMIT_CONFIG
    );
  }

  // ─── Authentication ──────────────────────────────────────────────────────

  /**
   * Authenticates with Gmail using OAuth2 credentials.
   * Stores the refresh token for subsequent access.
   *
   * Requirement 1.1: Establish OAuth2 session and store refresh token.
   */
  async authenticate(credentials: OAuthCredentials): Promise<AuthToken> {
    this.credentials = credentials;

    if (credentials.refreshToken) {
      return this.refreshAccessToken(credentials.refreshToken);
    }

    throw new GmailApiError(
      "No refresh token provided. Initial OAuth2 authorization flow must be completed externally.",
      401,
      false
    );
  }

  /**
   * Refreshes the access token using the stored refresh token.
   *
   * Requirement 1.6: Attempt token refresh on auth errors.
   */
  private async refreshAccessToken(refreshToken: string): Promise<AuthToken> {
    if (!this.credentials) {
      throw new GmailApiError(
        "No credentials available for token refresh",
        401,
        false
      );
    }

    const body = new URLSearchParams({
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });

    const response = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new GmailApiError(
        `Token refresh failed: ${response.statusText}`,
        response.status,
        response.status >= 500
      );
    }

    const data = (await response.json()) as GmailTokenResponse;

    this.authToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      tokenType: data.token_type,
      scope: data.scope,
    };

    return this.authToken;
  }

  // ─── Core API Request ────────────────────────────────────────────────────

  /**
   * Makes an authenticated request to the Gmail API with rate limiting,
   * automatic token refresh on 401 errors, and retry with backoff on 429.
   *
   * Requirement 1.3: Respect Gmail API rate limits.
   * Requirement 1.6: Automatic token refresh on auth errors.
   */
  private async apiRequest<T>(
    path: string,
    options: RequestInit = {},
    retryOnAuth = true,
    retryCount = 0
  ): Promise<T> {
    await this.rateLimiter.acquire();

    if (!this.authToken) {
      throw new GmailApiError("Not authenticated. Call authenticate() first.", 401, false);
    }

    // Check if token is expired and refresh proactively
    if (this.authToken.expiresAt <= new Date()) {
      await this.refreshAccessToken(this.authToken.refreshToken);
    }

    const url = `${GMAIL_API_BASE}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.authToken.accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (response.status === 401 && retryOnAuth) {
      // Attempt token refresh and retry once
      await this.refreshAccessToken(this.authToken.refreshToken);
      return this.apiRequest<T>(path, options, false, retryCount);
    }

    // Retry on 429 with exponential backoff (up to 3 retries)
    if (response.status === 429 && retryCount < 3) {
      const backoffMs = Math.pow(2, retryCount + 1) * 1000; // 2s, 4s, 8s
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return this.apiRequest<T>(path, options, retryOnAuth, retryCount + 1);
    }

    if (!response.ok) {
      const isRetryable = response.status === 429 || response.status >= 500;
      throw new GmailApiError(
        `Gmail API error: ${response.status} ${response.statusText}`,
        response.status,
        isRetryable
      );
    }

    return (await response.json()) as T;
  }

  // ─── Message Fetching ────────────────────────────────────────────────────

  /**
   * Fetches messages matching the given options with pagination support.
   * Retrieves all pages when pageToken is not specified, or a single page
   * when pageToken is provided.
   *
   * Requirement 1.5: Use pageToken to retrieve all available messages.
   */
  async fetchMessages(options: FetchOptions): Promise<RawMessage[]> {
    const messages: RawMessage[] = [];
    let pageToken = options.pageToken;

    do {
      const params = new URLSearchParams();
      params.set("maxResults", String(options.maxResults));

      // Build query string
      const queryParts: string[] = [];
      if (options.query) {
        queryParts.push(options.query);
      }
      if (options.since) {
        const afterEpoch = Math.floor(options.since.getTime() / 1000);
        queryParts.push(`after:${afterEpoch}`);
      }
      if (queryParts.length > 0) {
        params.set("q", queryParts.join(" "));
      }

      if (options.labelIds && options.labelIds.length > 0) {
        for (const labelId of options.labelIds) {
          params.append("labelIds", labelId);
        }
      }

      if (pageToken) {
        params.set("pageToken", pageToken);
      }

      const listResponse = await this.apiRequest<GmailMessageListResponse>(
        `/messages?${params.toString()}`
      );

      if (listResponse.messages) {
        // Fetch full message details for each message in the list
        const fullMessages = await Promise.all(
          listResponse.messages.map((msg) =>
            this.apiRequest<RawMessage>(`/messages/${msg.id}?format=full`)
          )
        );
        messages.push(...fullMessages);
      }

      pageToken = listResponse.nextPageToken;

      // If caller provided a specific pageToken, only fetch that one page
      if (options.pageToken) {
        break;
      }
    } while (pageToken);

    return messages;
  }

  // ─── Thread Fetching ─────────────────────────────────────────────────────

  /**
   * Fetches a complete thread by ID including all messages.
   */
  async fetchThread(threadId: string): Promise<RawThread> {
    return this.apiRequest<RawThread>(`/threads/${threadId}?format=full`);
  }

  // ─── Attachment Fetching ─────────────────────────────────────────────────

  /**
   * Downloads an attachment by message ID and attachment ID.
   * Used for receipts, invoices, and contracts.
   *
   * Requirement 1.4: Download attachments for classifier parsing.
   */
  async fetchAttachment(
    messageId: string,
    attachmentId: string
  ): Promise<Attachment> {
    const response = await this.apiRequest<{
      size: number;
      data: string;
    }>(`/messages/${messageId}/attachments/${attachmentId}`);

    // Fetch the message to get attachment metadata
    const message = await this.apiRequest<RawMessage>(
      `/messages/${messageId}?format=metadata&metadataHeaders=Content-Type`
    );

    const attachmentMeta = this.findAttachmentPart(message.payload, attachmentId);

    return {
      messageId,
      attachmentId,
      filename: attachmentMeta?.filename ?? "unknown",
      mimeType: attachmentMeta?.mimeType ?? "application/octet-stream",
      size: response.size,
      data: response.data,
    };
  }

  /**
   * Recursively searches message parts for an attachment by ID.
   */
  private findAttachmentPart(
    part: RawMessage["payload"],
    attachmentId: string
  ): { filename: string; mimeType: string } | null {
    if (part.body?.attachmentId === attachmentId) {
      return { filename: part.filename, mimeType: part.mimeType };
    }

    if (part.parts) {
      for (const subPart of part.parts) {
        const found = this.findAttachmentPart(subPart, attachmentId);
        if (found) return found;
      }
    }

    return null;
  }

  // ─── History / Incremental Sync ──────────────────────────────────────────

  /**
   * Returns the current historyId from the user's profile.
   * Used to establish a baseline for incremental sync.
   */
  async getHistoryId(): Promise<string> {
    const profile = await this.apiRequest<{ historyId: string }>("/profile");
    this.lastKnownHistoryId = profile.historyId;
    return profile.historyId;
  }

  /**
   * Performs incremental sync using historyId to fetch only new messages
   * since the last sync point.
   *
   * Requirement 1.2: Incremental sync using last known historyId.
   */
  async incrementalSync(lastHistoryId: string): Promise<RawMessage[]> {
    const messages: RawMessage[] = [];
    let pageToken: string | undefined;
    const seenMessageIds = new Set<string>();

    do {
      const params = new URLSearchParams();
      params.set("startHistoryId", lastHistoryId);
      params.set("historyTypes", "messageAdded");

      if (pageToken) {
        params.set("pageToken", pageToken);
      }

      const historyResponse = await this.apiRequest<GmailHistoryResponse>(
        `/history?${params.toString()}`
      );

      if (historyResponse.history) {
        for (const record of historyResponse.history) {
          const addedMessages = record.messagesAdded ?? [];
          for (const added of addedMessages) {
            const msgId = added.message.id;
            if (!seenMessageIds.has(msgId)) {
              seenMessageIds.add(msgId);
              const fullMessage = await this.apiRequest<RawMessage>(
                `/messages/${msgId}?format=full`
              );
              messages.push(fullMessage);
            }
          }
        }
      }

      // Update the last known history ID
      this.lastKnownHistoryId = historyResponse.historyId;
      pageToken = historyResponse.nextPageToken;
    } while (pageToken);

    return messages;
  }
}
