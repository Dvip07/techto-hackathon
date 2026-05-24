/**
 * Ingestion layer — Gmail MCP Connector and related utilities.
 */

export { GmailConnector, TokenBucketRateLimiter, GmailApiError } from "./gmail-connector.js";
export { BatchFetcher } from "./batch-fetcher.js";
export { AttachmentParser } from "./attachment-parser.js";
export type {
  OAuthCredentials,
  AuthToken,
  FetchOptions,
  RawMessage,
  RawThread,
  Attachment,
  GmailMCPConnector,
  RateLimiterConfig,
  ParsedMessage,
  ParsedAttachment,
  BatchFetchOptions,
  BatchFetchResult,
} from "./types.js";
