/**
 * Attachment Parser
 *
 * Parses email attachments (PDFs, text files, CSVs) and extracts
 * text content for downstream classification by the Claude Classifier.
 *
 * Requirements: 1.4
 */

import type { ParsedAttachment } from "./types.js";

// ─── Supported MIME Types ────────────────────────────────────────────────────

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/html",
]);

// ─── Attachment Parser ───────────────────────────────────────────────────────

export class AttachmentParser {
  /**
   * Parses a base64url-encoded attachment and extracts text content.
   *
   * @param data - base64url-encoded attachment content
   * @param filename - original filename of the attachment
   * @param mimeType - MIME type of the attachment
   * @param size - size in bytes
   * @returns ParsedAttachment with extracted text content, or null if unsupported
   */
  parse(
    data: string,
    filename: string,
    mimeType: string,
    size: number
  ): ParsedAttachment | null {
    if (!this.isSupported(mimeType)) {
      return null;
    }

    const content = this.extractContent(data, mimeType);

    return {
      filename,
      mimeType,
      size,
      content,
    };
  }

  /**
   * Checks whether the given MIME type is supported for parsing.
   */
  isSupported(mimeType: string): boolean {
    return SUPPORTED_MIME_TYPES.has(mimeType);
  }

  /**
   * Extracts text content from base64url-encoded data based on MIME type.
   */
  private extractContent(data: string, mimeType: string): string {
    switch (mimeType) {
      case "application/pdf":
        return this.extractPdfText(data);
      case "text/plain":
        return this.decodeBase64Url(data);
      case "text/csv":
        return this.decodeBase64Url(data);
      case "text/html":
        return this.extractHtmlText(data);
      default:
        return "";
    }
  }

  /**
   * Extracts text from a PDF attachment.
   *
   * Uses a simple heuristic text extraction approach. For production use,
   * a proper PDF parsing library (e.g., pdf-parse) should be integrated.
   * This implementation decodes the base64url data and extracts readable
   * text strings from the PDF binary content.
   */
  private extractPdfText(data: string): string {
    const decoded = this.decodeBase64Url(data);

    // Simple PDF text extraction: find text between BT/ET markers
    // and extract parenthesized strings (PDF text objects)
    const textSegments: string[] = [];

    // Extract text from PDF stream objects between BT (begin text) and ET (end text)
    const btEtRegex = /BT\s*([\s\S]*?)\s*ET/g;
    let match: RegExpExecArray | null;

    while ((match = btEtRegex.exec(decoded)) !== null) {
      const textBlock = match[1];
      // Extract parenthesized text strings (Tj and TJ operators)
      const textRegex = /\(([^)]*)\)/g;
      let textMatch: RegExpExecArray | null;
      while ((textMatch = textRegex.exec(textBlock)) !== null) {
        const text = textMatch[1].trim();
        if (text.length > 0) {
          textSegments.push(text);
        }
      }
    }

    // If BT/ET extraction found content, return it
    if (textSegments.length > 0) {
      return textSegments.join(" ").trim();
    }

    // Fallback: extract any readable ASCII text sequences from the decoded content
    const readableRegex = /[\x20-\x7E]{4,}/g;
    const readableMatches = decoded.match(readableRegex) ?? [];

    // Filter out PDF structural keywords
    const pdfKeywords = new Set([
      "obj", "endobj", "stream", "endstream", "xref", "trailer",
      "startxref", "%%EOF", "/Type", "/Page", "/Font", "/Length",
    ]);

    const filteredText = readableMatches
      .filter((s) => !pdfKeywords.has(s.trim()) && !s.startsWith("/") && !s.startsWith("<<"))
      .join(" ")
      .trim();

    return filteredText;
  }

  /**
   * Strips HTML tags and extracts plain text content.
   */
  private extractHtmlText(data: string): string {
    const decoded = this.decodeBase64Url(data);
    // Remove HTML tags and decode common entities
    return decoded
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

  /**
   * Decodes base64url-encoded string to UTF-8 text.
   * Gmail API uses base64url encoding (RFC 4648 §5) with - and _ instead of + and /.
   */
  private decodeBase64Url(data: string): string {
    // Convert base64url to standard base64
    const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
    // Pad if necessary
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    // Decode
    const buffer = Buffer.from(padded, "base64");
    return buffer.toString("utf-8");
  }
}
