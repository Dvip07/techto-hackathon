/**
 * Batch Fetcher
 *
 * Orchestrates batch message retrieval from Gmail, normalizes raw messages
 * into the ParsedMessage format, and optionally fetches/parses attachments.
 *
 * Requirements: 1.2, 1.4, 1.5
 */

import type { GmailConnector } from "./gmail-connector.js";
import { AttachmentParser } from "./attachment-parser.js";
import type {
  BatchFetchOptions,
  BatchFetchResult,
  ParsedAttachment,
  ParsedMessage,
  RawMessage,
  RawMessagePart,
} from "./types.js";

// ─── Batch Fetcher ───────────────────────────────────────────────────────────

export class BatchFetcher {
  private connector: GmailConnector;
  private attachmentParser: AttachmentParser;

  constructor(connector: GmailConnector) {
    this.connector = connector;
    this.attachmentParser = new AttachmentParser();
  }

  /**
   * Fetches messages in batch using either full fetch or incremental sync,
   * normalizes them to ParsedMessage format, and optionally parses attachments.
   *
   * Requirement 1.2: Incremental sync using last known historyId.
   * Requirement 1.5: Use pageToken to retrieve all available messages.
   */
  async fetch(options: BatchFetchOptions): Promise<BatchFetchResult> {
    let rawMessages: RawMessage[];

    if (options.mode === "incremental") {
      if (!options.lastHistoryId) {
        throw new Error("lastHistoryId is required for incremental sync mode");
      }
      rawMessages = await this.connector.incrementalSync(options.lastHistoryId);
    } else {
      if (!options.fetchOptions) {
        throw new Error("fetchOptions is required for full fetch mode");
      }
      rawMessages = await this.connector.fetchMessages(options.fetchOptions);
    }

    const parseAttachments = options.parseAttachments ?? true;

    // Normalize all raw messages to ParsedMessage format
    const messages: ParsedMessage[] = [];
    for (const raw of rawMessages) {
      const parsed = await this.normalizeMessage(raw, parseAttachments);
      messages.push(parsed);
    }

    // Get the new history ID if available
    let newHistoryId: string | null = null;
    try {
      newHistoryId = await this.connector.getHistoryId();
    } catch {
      // If we can't get the history ID, that's okay — caller can retry
    }

    return {
      messages,
      newHistoryId,
      fetchedCount: messages.length,
    };
  }

  /**
   * Normalizes a single raw Gmail message into the ParsedMessage format.
   * Extracts headers, body text/html, and optionally parses attachments.
   */
  async normalizeMessage(
    raw: RawMessage,
    parseAttachments: boolean
  ): Promise<ParsedMessage> {
    const headers = this.extractHeaders(raw.payload);
    const sender = headers.from ?? "";
    const senderDomain = this.extractDomain(sender);
    const subject = headers.subject ?? "";
    const timestamp = new Date(parseInt(raw.internalDate, 10));

    // Extract body content
    const { text, html } = this.extractBody(raw.payload);

    // Extract and parse attachments if requested
    let attachments: ParsedAttachment[] = [];
    if (parseAttachments) {
      attachments = await this.extractAttachments(raw);
    }

    return {
      messageId: raw.id,
      threadId: raw.threadId,
      timestamp,
      sender,
      senderDomain,
      subject,
      bodyText: text,
      bodyHtml: html,
      attachments,
      labels: raw.labelIds ?? [],
      snippet: raw.snippet,
    };
  }

  /**
   * Extracts common headers (From, Subject, Date) from the message payload.
   */
  private extractHeaders(payload: RawMessagePart): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const header of payload.headers ?? []) {
      const key = header.name.toLowerCase();
      headers[key] = header.value;
    }
    return headers;
  }

  /**
   * Extracts the sender's domain from the From header.
   * Handles formats like "Name <email@domain.com>" and "email@domain.com".
   */
  private extractDomain(from: string): string {
    // Try to extract email from angle brackets
    const angleMatch = from.match(/<([^>]+)>/);
    const email = angleMatch ? angleMatch[1] : from;

    // Extract domain from email
    const atIndex = email.lastIndexOf("@");
    if (atIndex === -1) {
      return "";
    }
    return email.substring(atIndex + 1).toLowerCase().trim();
  }

  /**
   * Extracts text and HTML body content from the message payload.
   * Handles multipart/alternative, multipart/mixed, and single-part messages.
   */
  private extractBody(payload: RawMessagePart): { text: string; html: string | null } {
    let text = "";
    let html: string | null = null;

    // Single-part message (no sub-parts)
    if (!payload.parts || payload.parts.length === 0) {
      const data = payload.body?.data;
      if (data) {
        const decoded = this.decodeBase64Url(data);
        if (payload.mimeType === "text/plain") {
          text = decoded;
        } else if (payload.mimeType === "text/html") {
          html = decoded;
          // Also extract plain text from HTML as fallback
          text = this.stripHtml(decoded);
        }
      }
      return { text, html };
    }

    // Multi-part message — recursively search for text/plain and text/html
    this.extractBodyFromParts(payload.parts, { text: "", html: null }, (result) => {
      text = result.text;
      html = result.html;
    });

    return { text, html };
  }

  /**
   * Recursively extracts text/plain and text/html from message parts.
   */
  private extractBodyFromParts(
    parts: RawMessagePart[],
    result: { text: string; html: string | null },
    callback: (result: { text: string; html: string | null }) => void
  ): void {
    for (const part of parts) {
      if (part.mimeType === "text/plain" && part.body?.data && !result.text) {
        result.text = this.decodeBase64Url(part.body.data);
      } else if (part.mimeType === "text/html" && part.body?.data && !result.html) {
        result.html = this.decodeBase64Url(part.body.data);
        // Use HTML-derived text as fallback if no text/plain part
        if (!result.text) {
          result.text = this.stripHtml(result.html);
        }
      } else if (part.parts) {
        // Recurse into nested parts (e.g., multipart/alternative inside multipart/mixed)
        this.extractBodyFromParts(part.parts, result, callback);
      }
    }
    callback(result);
  }

  /**
   * Fetches and parses all attachments from a raw message.
   *
   * Requirement 1.4: Download attachments for classifier parsing.
   */
  private async extractAttachments(raw: RawMessage): Promise<ParsedAttachment[]> {
    const attachmentParts = this.findAttachmentParts(raw.payload);
    const parsed: ParsedAttachment[] = [];

    for (const part of attachmentParts) {
      if (!part.body.attachmentId) {
        // Inline attachment with data already present
        if (part.body.data && this.attachmentParser.isSupported(part.mimeType)) {
          const result = this.attachmentParser.parse(
            part.body.data,
            part.filename,
            part.mimeType,
            part.body.size
          );
          if (result) {
            parsed.push(result);
          }
        }
        continue;
      }

      // Fetch attachment data from Gmail API
      if (!this.attachmentParser.isSupported(part.mimeType)) {
        continue;
      }

      try {
        const attachment = await this.connector.fetchAttachment(
          raw.id,
          part.body.attachmentId
        );
        const result = this.attachmentParser.parse(
          attachment.data,
          attachment.filename,
          attachment.mimeType,
          attachment.size
        );
        if (result) {
          parsed.push(result);
        }
      } catch {
        // Skip attachments that fail to download — don't block the pipeline
      }
    }

    return parsed;
  }

  /**
   * Recursively finds all attachment parts in the message payload.
   * An attachment is a part with a non-empty filename.
   */
  private findAttachmentParts(payload: RawMessagePart): RawMessagePart[] {
    const attachments: RawMessagePart[] = [];

    if (payload.filename && payload.filename.length > 0) {
      attachments.push(payload);
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        attachments.push(...this.findAttachmentParts(part));
      }
    }

    return attachments;
  }

  /**
   * Decodes base64url-encoded string to UTF-8 text.
   */
  private decodeBase64Url(data: string): string {
    const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const buffer = Buffer.from(padded, "base64");
    return buffer.toString("utf-8");
  }

  /**
   * Strips HTML tags and returns plain text.
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }
}
