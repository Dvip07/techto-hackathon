/**
 * Types for the Gmail MCP Connector and ingestion layer.
 */

// ─── OAuth & Authentication ──────────────────────────────────────────────────

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken?: string;
}

export interface AuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  tokenType: string;
  scope: string;
}

// ─── Fetch Options ───────────────────────────────────────────────────────────

export interface FetchOptions {
  since: Date;
  maxResults: number;
  labelIds?: string[];
  query?: string;
  pageToken?: string;
}

// ─── Raw Message Types ───────────────────────────────────────────────────────

export interface RawMessageHeader {
  name: string;
  value: string;
}

export interface RawMessagePart {
  partId: string;
  mimeType: string;
  filename: string;
  headers: RawMessageHeader[];
  body: {
    attachmentId?: string;
    size: number;
    data?: string;
  };
  parts?: RawMessagePart[];
}

export interface RawMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId: string;
  internalDate: string;
  payload: RawMessagePart;
  sizeEstimate: number;
}

export interface RawThread {
  id: string;
  historyId: string;
  messages: RawMessage[];
}

// ─── Attachment ──────────────────────────────────────────────────────────────

export interface Attachment {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  data: string; // base64url-encoded content
}

// ─── Gmail API Response Types ────────────────────────────────────────────────

export interface GmailMessageListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailHistoryResponse {
  history?: GmailHistoryRecord[];
  nextPageToken?: string;
  historyId: string;
}

export interface GmailHistoryRecord {
  id: string;
  messages?: Array<{ id: string; threadId: string }>;
  messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds: string[] } }>;
  messagesDeleted?: Array<{ message: { id: string; threadId: string } }>;
  labelsAdded?: Array<{ message: { id: string; threadId: string }; labelIds: string[] }>;
  labelsRemoved?: Array<{ message: { id: string; threadId: string }; labelIds: string[] }>;
}

export interface GmailTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────

export interface RateLimiterConfig {
  maxTokens: number;       // Maximum tokens in the bucket
  refillRate: number;      // Tokens added per second
  tokensPerRequest: number; // Tokens consumed per request
}

// ─── Parsed Message Types ─────────────────────────────────────────────────────

export interface ParsedAttachment {
  filename: string;
  mimeType: string;
  size: number;
  content: string; // extracted text content from PDF/document parsing
}

export interface ParsedMessage {
  messageId: string;
  threadId: string;
  timestamp: Date;
  sender: string;
  senderDomain: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  attachments: ParsedAttachment[];
  labels: string[];
  snippet: string;
}

// ─── Batch Fetcher Options ───────────────────────────────────────────────────

export interface BatchFetchOptions {
  mode: "full" | "incremental";
  /** Required for full mode */
  fetchOptions?: FetchOptions;
  /** Required for incremental mode */
  lastHistoryId?: string;
  /** Whether to fetch and parse attachments (default: true) */
  parseAttachments?: boolean;
}

export interface BatchFetchResult {
  messages: ParsedMessage[];
  newHistoryId: string | null;
  fetchedCount: number;
}

// ─── Connector Interface ─────────────────────────────────────────────────────

export interface GmailMCPConnector {
  authenticate(credentials: OAuthCredentials): Promise<AuthToken>;
  fetchMessages(options: FetchOptions): Promise<RawMessage[]>;
  fetchThread(threadId: string): Promise<RawThread>;
  fetchAttachment(messageId: string, attachmentId: string): Promise<Attachment>;
  getHistoryId(): Promise<string>;
  incrementalSync(lastHistoryId: string): Promise<RawMessage[]>;
}
