/**
 * Unit tests for the Batch Fetcher and Attachment Parser.
 *
 * Tests cover:
 * - Message normalization from raw Gmail format to ParsedMessage
 * - Body extraction from single-part and multipart messages
 * - Header extraction (From, Subject)
 * - Sender domain extraction
 * - Attachment parsing for supported MIME types
 * - Batch fetch in full and incremental modes
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BatchFetcher } from "./batch-fetcher.js";
import { AttachmentParser } from "./attachment-parser.js";
import { GmailConnector } from "./gmail-connector.js";
import type { RawMessage } from "./types.js";

// ─── Helper: encode string to base64url ──────────────────────────────────────

function toBase64Url(str: string): string {
  return Buffer.from(str, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ─── Helper: create a raw message ───────────────────────────────────────────

function createRawMessage(overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    id: "msg-1",
    threadId: "thread-1",
    labelIds: ["INBOX"],
    snippet: "Test snippet",
    historyId: "100",
    internalDate: "1700000000000",
    sizeEstimate: 500,
    payload: {
      partId: "0",
      mimeType: "text/plain",
      filename: "",
      headers: [
        { name: "From", value: "John Doe <john@example.com>" },
        { name: "Subject", value: "Test Subject" },
        { name: "Date", value: "Tue, 14 Nov 2023 12:00:00 +0000" },
      ],
      body: {
        size: 100,
        data: toBase64Url("Hello, this is a test message."),
      },
    },
    ...overrides,
  };
}

// ─── Attachment Parser Tests ─────────────────────────────────────────────────

describe("AttachmentParser", () => {
  let parser: AttachmentParser;

  beforeEach(() => {
    parser = new AttachmentParser();
  });

  it("should parse text/plain attachments", () => {
    const content = "Invoice #12345\nAmount: $49.99\nDue: 2024-01-15";
    const data = toBase64Url(content);

    const result = parser.parse(data, "invoice.txt", "text/plain", content.length);

    expect(result).not.toBeNull();
    expect(result!.filename).toBe("invoice.txt");
    expect(result!.mimeType).toBe("text/plain");
    expect(result!.content).toBe(content);
  });

  it("should parse text/csv attachments", () => {
    const content = "vendor,amount,date\nNetflix,15.99,2024-01-01\nSpotify,9.99,2024-01-01";
    const data = toBase64Url(content);

    const result = parser.parse(data, "transactions.csv", "text/csv", content.length);

    expect(result).not.toBeNull();
    expect(result!.filename).toBe("transactions.csv");
    expect(result!.content).toContain("Netflix");
    expect(result!.content).toContain("Spotify");
  });

  it("should parse text/html attachments and strip tags", () => {
    const html = "<html><body><h1>Receipt</h1><p>Amount: $29.99</p></body></html>";
    const data = toBase64Url(html);

    const result = parser.parse(data, "receipt.html", "text/html", html.length);

    expect(result).not.toBeNull();
    expect(result!.content).toContain("Receipt");
    expect(result!.content).toContain("Amount: $29.99");
    expect(result!.content).not.toContain("<h1>");
  });

  it("should return null for unsupported MIME types", () => {
    const data = toBase64Url("binary data");

    const result = parser.parse(data, "image.png", "image/png", 1024);

    expect(result).toBeNull();
  });

  it("should correctly identify supported MIME types", () => {
    expect(parser.isSupported("application/pdf")).toBe(true);
    expect(parser.isSupported("text/plain")).toBe(true);
    expect(parser.isSupported("text/csv")).toBe(true);
    expect(parser.isSupported("text/html")).toBe(true);
    expect(parser.isSupported("image/png")).toBe(false);
    expect(parser.isSupported("application/zip")).toBe(false);
  });

  it("should handle empty attachment data", () => {
    const data = toBase64Url("");

    const result = parser.parse(data, "empty.txt", "text/plain", 0);

    expect(result).not.toBeNull();
    expect(result!.content).toBe("");
  });
});

// ─── Batch Fetcher Tests ─────────────────────────────────────────────────────

describe("BatchFetcher", () => {
  let fetcher: BatchFetcher;
  let mockConnector: GmailConnector;

  beforeEach(() => {
    mockConnector = {
      fetchMessages: vi.fn(),
      incrementalSync: vi.fn(),
      fetchAttachment: vi.fn(),
      getHistoryId: vi.fn().mockResolvedValue("200"),
    } as unknown as GmailConnector;

    fetcher = new BatchFetcher(mockConnector);
  });

  describe("normalizeMessage", () => {
    it("should extract sender and domain from From header", async () => {
      const raw = createRawMessage();

      const parsed = await fetcher.normalizeMessage(raw, false);

      expect(parsed.sender).toBe("John Doe <john@example.com>");
      expect(parsed.senderDomain).toBe("example.com");
    });

    it("should extract domain from plain email address", async () => {
      const raw = createRawMessage({
        payload: {
          ...createRawMessage().payload,
          headers: [
            { name: "From", value: "billing@netflix.com" },
            { name: "Subject", value: "Your receipt" },
          ],
        },
      });

      const parsed = await fetcher.normalizeMessage(raw, false);

      expect(parsed.sender).toBe("billing@netflix.com");
      expect(parsed.senderDomain).toBe("netflix.com");
    });

    it("should extract subject from headers", async () => {
      const raw = createRawMessage();

      const parsed = await fetcher.normalizeMessage(raw, false);

      expect(parsed.subject).toBe("Test Subject");
    });

    it("should parse timestamp from internalDate", async () => {
      const raw = createRawMessage({ internalDate: "1700000000000" });

      const parsed = await fetcher.normalizeMessage(raw, false);

      expect(parsed.timestamp).toEqual(new Date(1700000000000));
    });

    it("should extract text body from single-part text/plain message", async () => {
      const raw = createRawMessage();

      const parsed = await fetcher.normalizeMessage(raw, false);

      expect(parsed.bodyText).toBe("Hello, this is a test message.");
      expect(parsed.bodyHtml).toBeNull();
    });

    it("should extract text body from single-part text/html message", async () => {
      const htmlContent = "<html><body><p>Hello World</p></body></html>";
      const raw = createRawMessage({
        payload: {
          partId: "0",
          mimeType: "text/html",
          filename: "",
          headers: [
            { name: "From", value: "test@example.com" },
            { name: "Subject", value: "HTML Message" },
          ],
          body: {
            size: htmlContent.length,
            data: toBase64Url(htmlContent),
          },
        },
      });

      const parsed = await fetcher.normalizeMessage(raw, false);

      expect(parsed.bodyHtml).toBe(htmlContent);
      expect(parsed.bodyText).toContain("Hello World");
    });

    it("should extract both text and html from multipart/alternative", async () => {
      const textContent = "Plain text version";
      const htmlContent = "<html><body><p>HTML version</p></body></html>";

      const raw = createRawMessage({
        payload: {
          partId: "0",
          mimeType: "multipart/alternative",
          filename: "",
          headers: [
            { name: "From", value: "test@example.com" },
            { name: "Subject", value: "Multipart Message" },
          ],
          body: { size: 0 },
          parts: [
            {
              partId: "0.0",
              mimeType: "text/plain",
              filename: "",
              headers: [],
              body: { size: textContent.length, data: toBase64Url(textContent) },
            },
            {
              partId: "0.1",
              mimeType: "text/html",
              filename: "",
              headers: [],
              body: { size: htmlContent.length, data: toBase64Url(htmlContent) },
            },
          ],
        },
      });

      const parsed = await fetcher.normalizeMessage(raw, false);

      expect(parsed.bodyText).toBe("Plain text version");
      expect(parsed.bodyHtml).toBe(htmlContent);
    });

    it("should preserve labels and snippet", async () => {
      const raw = createRawMessage({
        labelIds: ["INBOX", "IMPORTANT"],
        snippet: "Important message snippet",
      });

      const parsed = await fetcher.normalizeMessage(raw, false);

      expect(parsed.labels).toEqual(["INBOX", "IMPORTANT"]);
      expect(parsed.snippet).toBe("Important message snippet");
    });

    it("should preserve messageId and threadId", async () => {
      const raw = createRawMessage({
        id: "msg-abc",
        threadId: "thread-xyz",
      });

      const parsed = await fetcher.normalizeMessage(raw, false);

      expect(parsed.messageId).toBe("msg-abc");
      expect(parsed.threadId).toBe("thread-xyz");
    });
  });

  describe("fetch - full mode", () => {
    it("should fetch messages using fetchMessages in full mode", async () => {
      const rawMessages = [createRawMessage({ id: "msg-1" }), createRawMessage({ id: "msg-2" })];
      vi.mocked(mockConnector.fetchMessages).mockResolvedValue(rawMessages);

      const result = await fetcher.fetch({
        mode: "full",
        fetchOptions: { since: new Date("2023-01-01"), maxResults: 100 },
        parseAttachments: false,
      });

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].messageId).toBe("msg-1");
      expect(result.messages[1].messageId).toBe("msg-2");
      expect(result.fetchedCount).toBe(2);
      expect(mockConnector.fetchMessages).toHaveBeenCalled();
    });

    it("should throw when fetchOptions is missing in full mode", async () => {
      await expect(
        fetcher.fetch({ mode: "full", parseAttachments: false })
      ).rejects.toThrow("fetchOptions is required for full fetch mode");
    });
  });

  describe("fetch - incremental mode", () => {
    it("should fetch messages using incrementalSync in incremental mode", async () => {
      const rawMessages = [createRawMessage({ id: "msg-new" })];
      vi.mocked(mockConnector.incrementalSync).mockResolvedValue(rawMessages);

      const result = await fetcher.fetch({
        mode: "incremental",
        lastHistoryId: "100",
        parseAttachments: false,
      });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].messageId).toBe("msg-new");
      expect(result.fetchedCount).toBe(1);
      expect(mockConnector.incrementalSync).toHaveBeenCalledWith("100");
    });

    it("should throw when lastHistoryId is missing in incremental mode", async () => {
      await expect(
        fetcher.fetch({ mode: "incremental", parseAttachments: false })
      ).rejects.toThrow("lastHistoryId is required for incremental sync mode");
    });
  });

  describe("fetch - with attachments", () => {
    it("should fetch and parse attachments when parseAttachments is true", async () => {
      const textContent = "Invoice content here";
      const rawMessage: RawMessage = {
        id: "msg-with-att",
        threadId: "thread-1",
        labelIds: ["INBOX"],
        snippet: "Invoice attached",
        historyId: "100",
        internalDate: "1700000000000",
        sizeEstimate: 2000,
        payload: {
          partId: "0",
          mimeType: "multipart/mixed",
          filename: "",
          headers: [
            { name: "From", value: "billing@vendor.com" },
            { name: "Subject", value: "Your Invoice" },
          ],
          body: { size: 0 },
          parts: [
            {
              partId: "0.0",
              mimeType: "text/plain",
              filename: "",
              headers: [],
              body: { size: 20, data: toBase64Url("Message body") },
            },
            {
              partId: "0.1",
              mimeType: "text/plain",
              filename: "invoice.txt",
              headers: [],
              body: {
                attachmentId: "att-1",
                size: textContent.length,
              },
            },
          ],
        },
      };

      vi.mocked(mockConnector.fetchMessages).mockResolvedValue([rawMessage]);
      vi.mocked(mockConnector.fetchAttachment).mockResolvedValue({
        messageId: "msg-with-att",
        attachmentId: "att-1",
        filename: "invoice.txt",
        mimeType: "text/plain",
        size: textContent.length,
        data: toBase64Url(textContent),
      });

      const result = await fetcher.fetch({
        mode: "full",
        fetchOptions: { since: new Date("2023-01-01"), maxResults: 100 },
        parseAttachments: true,
      });

      expect(result.messages[0].attachments).toHaveLength(1);
      expect(result.messages[0].attachments[0].filename).toBe("invoice.txt");
      expect(result.messages[0].attachments[0].content).toBe(textContent);
    });

    it("should skip unsupported attachment types", async () => {
      const rawMessage: RawMessage = {
        id: "msg-img",
        threadId: "thread-1",
        labelIds: ["INBOX"],
        snippet: "Photo attached",
        historyId: "100",
        internalDate: "1700000000000",
        sizeEstimate: 5000,
        payload: {
          partId: "0",
          mimeType: "multipart/mixed",
          filename: "",
          headers: [
            { name: "From", value: "friend@example.com" },
            { name: "Subject", value: "Photos" },
          ],
          body: { size: 0 },
          parts: [
            {
              partId: "0.0",
              mimeType: "text/plain",
              filename: "",
              headers: [],
              body: { size: 10, data: toBase64Url("Check these out") },
            },
            {
              partId: "0.1",
              mimeType: "image/jpeg",
              filename: "photo.jpg",
              headers: [],
              body: { attachmentId: "att-img", size: 4000 },
            },
          ],
        },
      };

      vi.mocked(mockConnector.fetchMessages).mockResolvedValue([rawMessage]);

      const result = await fetcher.fetch({
        mode: "full",
        fetchOptions: { since: new Date("2023-01-01"), maxResults: 100 },
        parseAttachments: true,
      });

      // image/jpeg is not supported, so no attachments should be parsed
      expect(result.messages[0].attachments).toHaveLength(0);
      expect(mockConnector.fetchAttachment).not.toHaveBeenCalled();
    });
  });

  describe("fetch - newHistoryId", () => {
    it("should return newHistoryId from connector", async () => {
      vi.mocked(mockConnector.fetchMessages).mockResolvedValue([]);
      vi.mocked(mockConnector.getHistoryId).mockResolvedValue("999");

      const result = await fetcher.fetch({
        mode: "full",
        fetchOptions: { since: new Date("2023-01-01"), maxResults: 100 },
        parseAttachments: false,
      });

      expect(result.newHistoryId).toBe("999");
    });

    it("should return null newHistoryId if getHistoryId fails", async () => {
      vi.mocked(mockConnector.fetchMessages).mockResolvedValue([]);
      vi.mocked(mockConnector.getHistoryId).mockRejectedValue(new Error("Network error"));

      const result = await fetcher.fetch({
        mode: "full",
        fetchOptions: { since: new Date("2023-01-01"), maxResults: 100 },
        parseAttachments: false,
      });

      expect(result.newHistoryId).toBeNull();
    });
  });
});
