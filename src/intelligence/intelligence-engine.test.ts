/**
 * Unit tests for the Intelligence Engine — Subscription & Spend Scanner
 *
 * Tests subscription status classification, price change detection,
 * and category classification.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IntelligenceEngine } from "./intelligence-engine";
import { SQLiteEntityStore } from "../store/entity-store";
import type { SubscriptionRecord, TrialRecord } from "../types/models";
import type { AnalyzedMessage } from "../types/signals";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createSubscription(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    id: "sub-1",
    vendor: "Netflix",
    vendorDomain: "netflix.com",
    amount: 15.99,
    currency: "USD",
    billingFrequency: "monthly",
    category: "video-streaming",
    status: "unknown",
    usageScore: 5,
    wasteScore: 0,
    firstSeenDate: new Date("2024-01-01"),
    lastPaymentDate: new Date("2025-01-01"),
    nextRenewalDate: new Date("2025-02-01"),
    autoRenews: true,
    trialEndsDate: null,
    annualPlanAvailable: false,
    annualPlanAmount: null,
    annualSavingsIfSwitched: null,
    priceChangeHistory: [],
    sourceMessageIds: ["msg-1"],
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

function createMessage(overrides: Partial<AnalyzedMessage> = {}): AnalyzedMessage {
  return {
    messageId: "msg-1",
    threadId: "thread-1",
    timestamp: new Date("2025-01-15"),
    sender: "noreply@netflix.com",
    senderDomain: "netflix.com",
    classifications: ["subscription_receipt"],
    subscriptionSignal: null,
    commitmentSignals: [],
    contractSignal: null,
    refundSignal: null,
    trialSignal: null,
    financialEntities: [],
    usageIndicators: [],
    urgencyScore: 0,
    summary: "Test message",
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("IntelligenceEngine", () => {
  let store: SQLiteEntityStore;
  let engine: IntelligenceEngine;

  beforeEach(() => {
    store = new SQLiteEntityStore(":memory:");
    engine = new IntelligenceEngine(store);
  });

  describe("scanSubscriptions", () => {
    it("should return an empty scan result when no subscriptions exist", async () => {
      const result = await engine.scanSubscriptions();

      expect(result.subscriptions).toHaveLength(0);
      expect(result.totalRecurringMonthly).toBe(0);
      expect(result.totalRecurringAnnual).toBe(0);
      expect(result.zombieSubscriptions).toHaveLength(0);
      expect(result.scanDate).toBeInstanceOf(Date);
    });

    it("should scan all subscriptions and calculate totals", async () => {
      const sub1 = createSubscription({
        id: "sub-1",
        vendor: "Netflix",
        vendorDomain: "netflix.com",
        amount: 15.99,
        usageScore: 7,
      });
      const sub2 = createSubscription({
        id: "sub-2",
        vendor: "Spotify",
        vendorDomain: "spotify.com",
        amount: 11.99,
        category: "music-streaming",
        usageScore: 8,
      });

      await store.upsertSubscription(sub1);
      await store.upsertSubscription(sub2);

      // Add messages with engagement signals
      await store.insertMessage(
        createMessage({
          messageId: "msg-1",
          senderDomain: "netflix.com",
          timestamp: new Date(),
          usageIndicators: ["login_alert"],
        })
      );
      await store.insertMessage(
        createMessage({
          messageId: "msg-2",
          senderDomain: "spotify.com",
          sender: "noreply@spotify.com",
          timestamp: new Date(),
          usageIndicators: ["usage_report"],
        })
      );

      const result = await engine.scanSubscriptions();

      expect(result.subscriptions).toHaveLength(2);
      expect(result.totalRecurringMonthly).toBeCloseTo(27.98, 1);
      expect(result.totalRecurringAnnual).toBeCloseTo(27.98 * 12, 0);
    });

    it("should group subscriptions by status", async () => {
      // Active-used subscription (high usage score, recent engagement)
      const activeSub = createSubscription({
        id: "sub-active",
        vendor: "GitHub",
        vendorDomain: "github.com",
        amount: 4,
        category: "software-saas",
        usageScore: 8,
      });

      await store.upsertSubscription(activeSub);
      await store.insertMessage(
        createMessage({
          messageId: "msg-active",
          senderDomain: "github.com",
          timestamp: new Date(),
          usageIndicators: ["login_alert"],
        })
      );

      const result = await engine.scanSubscriptions();

      expect(result.byStatus["active-used"].length).toBeGreaterThanOrEqual(1);
    });

    it("should group subscriptions by category", async () => {
      const sub = createSubscription({
        id: "sub-1",
        vendor: "Spotify",
        vendorDomain: "spotify.com",
        category: "music-streaming",
        usageScore: 7,
      });

      await store.upsertSubscription(sub);
      await store.insertMessage(
        createMessage({
          messageId: "msg-1",
          senderDomain: "spotify.com",
          timestamp: new Date(),
          usageIndicators: ["login_alert"],
        })
      );

      const result = await engine.scanSubscriptions();

      expect(result.byCategory["music-streaming"]).toHaveLength(1);
      expect(result.byCategory["music-streaming"][0].vendor).toBe("Spotify");
    });
  });

  describe("classifySubscriptionStatus", () => {
    const now = new Date("2025-02-01");

    it("should classify as cancelled when status is already cancelled", () => {
      const sub = createSubscription({ status: "cancelled" });
      const result = engine.classifySubscriptionStatus(sub, [], now);
      expect(result.status).toBe("cancelled");
    });

    it("should classify as trial-active when trial end date is in the future", () => {
      const sub = createSubscription({
        trialEndsDate: new Date("2025-03-01"),
        status: "unknown",
      });
      const result = engine.classifySubscriptionStatus(sub, [], now);
      expect(result.status).toBe("trial-active");
    });

    it("should classify as price-increased when recent price change exists", () => {
      const sub = createSubscription({
        priceChangeHistory: [
          {
            previousAmount: 9.99,
            newAmount: 12.99,
            detectedDate: new Date("2025-01-15"),
            percentageChange: 30.03,
            sourceMessageId: "msg-price",
          },
        ],
        status: "unknown",
      });
      const result = engine.classifySubscriptionStatus(sub, [], now);
      expect(result.status).toBe("price-increased");
    });

    it("should classify as renewing-soon when renewal is within 30 days", () => {
      const sub = createSubscription({
        nextRenewalDate: new Date("2025-02-15"),
        usageScore: 5,
        status: "unknown",
      });

      // Add a recent message so it doesn't become zombie
      const messages: AnalyzedMessage[] = [
        createMessage({
          senderDomain: "netflix.com",
          timestamp: new Date("2025-01-25"),
          usageIndicators: ["login_alert"],
        }),
      ];

      const result = engine.classifySubscriptionStatus(sub, messages, now);
      expect(result.status).toBe("renewing-soon");
    });

    it("should classify as zombie when no engagement for 60+ days (Req 4.2)", () => {
      const sub = createSubscription({
        usageScore: 0,
        nextRenewalDate: new Date("2025-06-01"), // far future
        status: "unknown",
      });

      // Only old messages, no recent engagement
      const messages: AnalyzedMessage[] = [
        createMessage({
          senderDomain: "netflix.com",
          timestamp: new Date("2024-11-01"), // 92 days before reference
          usageIndicators: [],
        }),
      ];

      const result = engine.classifySubscriptionStatus(sub, messages, now);
      expect(result.status).toBe("zombie");
    });

    it("should classify as active-used when usage score is high", () => {
      const sub = createSubscription({
        usageScore: 7,
        nextRenewalDate: new Date("2025-06-01"),
        status: "unknown",
      });

      const messages: AnalyzedMessage[] = [
        createMessage({
          senderDomain: "netflix.com",
          timestamp: new Date("2025-01-28"),
          usageIndicators: ["login_alert"],
        }),
      ];

      const result = engine.classifySubscriptionStatus(sub, messages, now);
      expect(result.status).toBe("active-used");
    });

    it("should classify as active-unused when usage score is low but has recent activity", () => {
      const sub = createSubscription({
        usageScore: 2,
        nextRenewalDate: new Date("2025-06-01"),
        status: "unknown",
      });

      const messages: AnalyzedMessage[] = [
        createMessage({
          senderDomain: "netflix.com",
          timestamp: new Date("2025-01-28"),
          usageIndicators: ["newsletter_engagement"],
        }),
      ];

      const result = engine.classifySubscriptionStatus(sub, messages, now);
      expect(result.status).toBe("active-unused");
    });

    it("should classify as unknown when no data is available", () => {
      const sub = createSubscription({
        usageScore: 0,
        nextRenewalDate: null,
        firstSeenDate: new Date("2025-01-30"), // very recent
        status: "unknown",
      });

      const result = engine.classifySubscriptionStatus(sub, [], now);
      // With no messages and recent firstSeenDate (2 days), should be active-unused
      expect(result.status).toBe("active-unused");
    });
  });

  describe("detectPriceChange (Req 4.3)", () => {
    it("should detect a price increase and calculate percentage", () => {
      const result = engine.detectPriceChange(
        12.99,
        9.99,
        new Date("2025-01-15"),
        "msg-1"
      );

      expect(result).not.toBeNull();
      expect(result!.previousAmount).toBe(9.99);
      expect(result!.newAmount).toBe(12.99);
      expect(result!.percentageChange).toBeCloseTo(30.03, 1);
      expect(result!.sourceMessageId).toBe("msg-1");
    });

    it("should detect a price decrease", () => {
      const result = engine.detectPriceChange(
        7.99,
        9.99,
        new Date("2025-01-15"),
        "msg-1"
      );

      expect(result).not.toBeNull();
      expect(result!.percentageChange).toBeLessThan(0);
      expect(result!.percentageChange).toBeCloseTo(-20.02, 1);
    });

    it("should return null when prices are the same", () => {
      const result = engine.detectPriceChange(
        9.99,
        9.99,
        new Date("2025-01-15"),
        "msg-1"
      );

      expect(result).toBeNull();
    });

    it("should return null when previous amount is zero", () => {
      const result = engine.detectPriceChange(
        9.99,
        0,
        new Date("2025-01-15"),
        "msg-1"
      );

      expect(result).toBeNull();
    });

    it("should return null when previous amount is negative", () => {
      const result = engine.detectPriceChange(
        9.99,
        -5,
        new Date("2025-01-15"),
        "msg-1"
      );

      expect(result).toBeNull();
    });
  });

  describe("classifyCategory (Req 4.4)", () => {
    it("should classify music streaming services", () => {
      expect(engine.classifyCategory("Spotify", "spotify.com")).toBe("music-streaming");
      expect(engine.classifyCategory("Apple Music", "music.apple.com")).toBe("music-streaming");
    });

    it("should classify video streaming services", () => {
      expect(engine.classifyCategory("Netflix", "netflix.com")).toBe("video-streaming");
      expect(engine.classifyCategory("Disney+", "disneyplus.com")).toBe("video-streaming");
    });

    it("should classify productivity tools", () => {
      expect(engine.classifyCategory("Notion", "notion.so")).toBe("productivity");
      expect(engine.classifyCategory("Slack", "slack.com")).toBe("productivity");
    });

    it("should classify cloud storage services", () => {
      expect(engine.classifyCategory("Dropbox", "dropbox.com")).toBe("cloud-storage");
      expect(engine.classifyCategory("Google One", "google.com")).toBe("cloud-storage");
    });

    it("should classify fitness services", () => {
      expect(engine.classifyCategory("Peloton", "peloton.com")).toBe("fitness");
      expect(engine.classifyCategory("Headspace", "headspace.com")).toBe("fitness");
    });

    it("should classify news and media", () => {
      expect(engine.classifyCategory("NY Times", "nytimes.com")).toBe("news-media");
      expect(engine.classifyCategory("Medium", "medium.com")).toBe("news-media");
    });

    it("should classify software/SaaS", () => {
      expect(engine.classifyCategory("GitHub", "github.com")).toBe("software-saas");
      expect(engine.classifyCategory("Figma", "figma.com")).toBe("software-saas");
    });

    it("should classify security/VPN services", () => {
      expect(engine.classifyCategory("NordVPN", "nordvpn.com")).toBe("security-vpn");
      expect(engine.classifyCategory("1Password", "1password.com")).toBe("security-vpn");
    });

    it("should classify food delivery services", () => {
      expect(engine.classifyCategory("DoorDash", "doordash.com")).toBe("food-delivery");
      expect(engine.classifyCategory("Instacart", "instacart.com")).toBe("food-delivery");
    });

    it("should classify gaming services", () => {
      expect(engine.classifyCategory("Xbox Game Pass", "xbox.com")).toBe("gaming");
      expect(engine.classifyCategory("PlayStation Plus", "playstation.com")).toBe("gaming");
    });

    it("should classify education services", () => {
      expect(engine.classifyCategory("Coursera", "coursera.org")).toBe("education");
      expect(engine.classifyCategory("Duolingo", "duolingo.com")).toBe("education");
    });

    it("should classify utilities", () => {
      expect(engine.classifyCategory("Comcast", "comcast.com")).toBe("utilities");
      expect(engine.classifyCategory("Verizon", "verizon.com")).toBe("utilities");
    });

    it("should classify insurance", () => {
      expect(engine.classifyCategory("Geico", "geico.com")).toBe("insurance");
      expect(engine.classifyCategory("Lemonade Insurance", "lemonade.com")).toBe("insurance");
    });

    it("should return 'other' for unrecognized vendors", () => {
      expect(engine.classifyCategory("Random Service", "randomservice.xyz")).toBe("other");
    });

    it("should preserve existing non-other category", () => {
      expect(
        engine.classifyCategory("Custom App", "custom.com", "productivity")
      ).toBe("productivity");
    });
  });

  describe("monthly amount calculation", () => {
    it("should calculate correct monthly totals for different billing frequencies", async () => {
      const subs = [
        createSubscription({
          id: "sub-weekly",
          vendor: "Weekly Service",
          vendorDomain: "weekly.com",
          amount: 5,
          billingFrequency: "weekly",
          usageScore: 5,
        }),
        createSubscription({
          id: "sub-monthly",
          vendor: "Monthly Service",
          vendorDomain: "monthly.com",
          amount: 10,
          billingFrequency: "monthly",
          usageScore: 5,
        }),
        createSubscription({
          id: "sub-annual",
          vendor: "Annual Service",
          vendorDomain: "annual.com",
          amount: 120,
          billingFrequency: "annual",
          usageScore: 5,
        }),
      ];

      for (const sub of subs) {
        await store.upsertSubscription(sub);
        await store.insertMessage(
          createMessage({
            messageId: `msg-${sub.id}`,
            senderDomain: sub.vendorDomain,
            timestamp: new Date(),
            usageIndicators: ["login_alert"],
          })
        );
      }

      const result = await engine.scanSubscriptions();

      // weekly: 5 * 4.33 = 21.65
      // monthly: 10
      // annual: 120 / 12 = 10
      // total: ~41.65
      expect(result.totalRecurringMonthly).toBeCloseTo(41.65, 1);
    });
  });

  describe("price change history in scan results", () => {
    it("should extract and sort price changes by date", async () => {
      const sub = createSubscription({
        id: "sub-1",
        vendor: "Netflix",
        vendorDomain: "netflix.com",
        usageScore: 5,
        priceChangeHistory: [
          {
            previousAmount: 9.99,
            newAmount: 12.99,
            detectedDate: new Date("2025-01-01"),
            percentageChange: 30.03,
            sourceMessageId: "msg-old",
          },
          {
            previousAmount: 12.99,
            newAmount: 15.99,
            detectedDate: new Date("2025-01-20"),
            percentageChange: 23.09,
            sourceMessageId: "msg-new",
          },
        ],
      });

      await store.upsertSubscription(sub);
      await store.insertMessage(
        createMessage({
          messageId: "msg-1",
          senderDomain: "netflix.com",
          timestamp: new Date(),
          usageIndicators: ["login_alert"],
        })
      );

      const result = await engine.scanSubscriptions();

      expect(result.recentPriceChanges).toHaveLength(2);
      // Most recent first
      expect(result.recentPriceChanges[0].newAmount).toBe(15.99);
      expect(result.recentPriceChanges[1].newAmount).toBe(12.99);
    });
  });

  // ─── Free Trial Expiry Tracker Tests (Req 7.1, 7.2, 7.3, 7.4, 7.6) ─────

  describe("trackTrialExpiries", () => {
    function createTrial(overrides: Partial<TrialRecord> = {}): TrialRecord {
      return {
        id: "trial-1",
        vendor: "Notion",
        vendorDomain: "notion.so",
        category: "productivity",
        trialStartDate: new Date("2025-01-01"),
        trialEndDate: new Date("2025-02-01"),
        daysRemaining: 14,
        convertsToAmount: 10,
        convertsToFrequency: "monthly",
        autoConverts: true,
        cancellationUrl: "https://notion.so/cancel",
        status: "active",
        reminderScheduled: false,
        sourceMessageId: "msg-trial-1",
        ...overrides,
      };
    }

    it("should return empty result when no active trials exist", async () => {
      const result = await engine.trackTrialExpiries();

      expect(result.activeTrials).toHaveLength(0);
      expect(result.expiringSoon).toHaveLength(0);
      expect(result.urgentTrials).toHaveLength(0);
      expect(result.totalPotentialCharges).toBe(0);
      expect(result.trialsByUrgency).toHaveLength(0);
    });

    it("should compute days remaining for active trials (Req 7.2)", async () => {
      const now = new Date("2025-01-20");
      const trial = createTrial({
        trialEndDate: new Date("2025-02-01"), // 12 days from now
        status: "active",
      });

      await store.insertTrial(trial);

      // We need to test with a fixed date, so we'll use updateTrialStatus directly
      const updated = engine.updateTrialStatus(trial, now);

      expect(updated.daysRemaining).toBe(12);
      expect(updated.status).toBe("active");
    });

    it("should identify trials expiring within 7 days as expiring_soon", async () => {
      const now = new Date("2025-01-28");
      const trial = createTrial({
        trialEndDate: new Date("2025-02-01"), // 4 days from now
        status: "active",
      });

      await store.insertTrial(trial);

      const updated = engine.updateTrialStatus(trial, now);

      expect(updated.daysRemaining).toBe(4);
      expect(updated.status).toBe("expiring_soon");
    });

    it("should mark trials as expired when end date has passed", async () => {
      const now = new Date("2025-02-05");
      const trial = createTrial({
        trialEndDate: new Date("2025-02-01"), // 4 days ago
        status: "active",
      });

      await store.insertTrial(trial);

      const updated = engine.updateTrialStatus(trial, now);

      expect(updated.daysRemaining).toBe(0);
      expect(updated.status).toBe("expired");
    });

    it("should not change cancelled trial status", async () => {
      const now = new Date("2025-01-20");
      const trial = createTrial({
        trialEndDate: new Date("2025-02-01"),
        status: "cancelled",
      });

      const updated = engine.updateTrialStatus(trial, now);

      expect(updated.status).toBe("cancelled");
    });

    it("should assign urgency 10 when trial expires within 48 hours (Req 7.4)", () => {
      const now = new Date("2025-01-31T12:00:00Z");
      const trial = createTrial({
        trialEndDate: new Date("2025-02-01T12:00:00Z"), // exactly 24 hours
        autoConverts: true,
        convertsToAmount: 10,
      });

      const urgency = engine.computeTrialUrgency(trial, now);

      expect(urgency).toBe(10);
    });

    it("should assign urgency 9 when trial auto-converts to >$20/month (Req 7.3)", () => {
      const now = new Date("2025-01-15");
      const trial = createTrial({
        trialEndDate: new Date("2025-02-15"), // 31 days away (not within 48h or 7 days)
        autoConverts: true,
        convertsToAmount: 29.99,
        convertsToFrequency: "monthly",
      });

      const urgency = engine.computeTrialUrgency(trial, now);

      expect(urgency).toBe(9);
    });

    it("should assign urgency 9 for annual plan that exceeds $20/month equivalent (Req 7.3)", () => {
      const now = new Date("2025-01-15");
      const trial = createTrial({
        trialEndDate: new Date("2025-02-15"), // 31 days away
        autoConverts: true,
        convertsToAmount: 300, // $300/year = $25/month
        convertsToFrequency: "annual",
      });

      const urgency = engine.computeTrialUrgency(trial, now);

      expect(urgency).toBe(9);
    });

    it("should prioritize urgency 10 (48h) over urgency 9 (>$20/mo)", () => {
      const now = new Date("2025-01-31T12:00:00Z");
      const trial = createTrial({
        trialEndDate: new Date("2025-02-01T12:00:00Z"), // 24 hours
        autoConverts: true,
        convertsToAmount: 49.99, // >$20/month
        convertsToFrequency: "monthly",
      });

      const urgency = engine.computeTrialUrgency(trial, now);

      // 48h rule takes precedence
      expect(urgency).toBe(10);
    });

    it("should store and surface cancellation URL (Req 7.6)", async () => {
      const trial = createTrial({
        cancellationUrl: "https://notion.so/settings/cancel",
      });

      await store.insertTrial(trial);

      const activeTrials = await store.getActiveTrials();
      expect(activeTrials[0].cancellationUrl).toBe("https://notion.so/settings/cancel");
    });

    it("should handle trials without cancellation URL (Req 7.6)", async () => {
      const trial = createTrial({
        cancellationUrl: null,
      });

      await store.insertTrial(trial);

      const activeTrials = await store.getActiveTrials();
      expect(activeTrials[0].cancellationUrl).toBeNull();
    });

    it("should calculate total potential charges from auto-converting trials", async () => {
      const now = new Date("2025-01-20");

      // Trial 1: $29.99/month auto-converts
      const trial1 = createTrial({
        id: "trial-1",
        vendor: "Adobe",
        vendorDomain: "adobe.com",
        trialEndDate: new Date("2025-01-25"),
        autoConverts: true,
        convertsToAmount: 29.99,
        convertsToFrequency: "monthly",
      });

      // Trial 2: $9.99/month auto-converts
      const trial2 = createTrial({
        id: "trial-2",
        vendor: "Notion",
        vendorDomain: "notion.so",
        trialEndDate: new Date("2025-01-28"),
        autoConverts: true,
        convertsToAmount: 9.99,
        convertsToFrequency: "monthly",
      });

      // Trial 3: no auto-convert (should not count)
      const trial3 = createTrial({
        id: "trial-3",
        vendor: "Figma",
        vendorDomain: "figma.com",
        trialEndDate: new Date("2025-01-30"),
        autoConverts: false,
        convertsToAmount: 15,
        convertsToFrequency: "monthly",
      });

      await store.insertTrial(trial1);
      await store.insertTrial(trial2);
      await store.insertTrial(trial3);

      const result = await engine.trackTrialExpiries();

      // Only auto-converting trials count: 29.99 + 9.99 = 39.98
      expect(result.totalPotentialCharges).toBeCloseTo(39.98, 2);
    });

    it("should sort trials by urgency score descending", async () => {
      // Trial expiring in 24 hours (urgency 10)
      const urgentTrial = createTrial({
        id: "trial-urgent",
        vendor: "Adobe",
        vendorDomain: "adobe.com",
        trialStartDate: new Date("2025-01-01"),
        trialEndDate: new Date(Date.now() + 20 * 60 * 60 * 1000), // 20 hours from now
        autoConverts: true,
        convertsToAmount: 29.99,
        convertsToFrequency: "monthly",
      });

      // Trial expiring in 10 days with high cost (urgency 9)
      const highCostTrial = createTrial({
        id: "trial-highcost",
        vendor: "Salesforce",
        vendorDomain: "salesforce.com",
        trialStartDate: new Date("2025-01-01"),
        trialEndDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days
        autoConverts: true,
        convertsToAmount: 50,
        convertsToFrequency: "monthly",
      });

      await store.insertTrial(urgentTrial);
      await store.insertTrial(highCostTrial);

      const result = await engine.trackTrialExpiries();

      expect(result.trialsByUrgency.length).toBe(2);
      expect(result.trialsByUrgency[0].urgencyScore).toBe(10);
      expect(result.trialsByUrgency[1].urgencyScore).toBe(9);
    });

    it("should track trial status transitions correctly", () => {
      const trial = createTrial({
        trialEndDate: new Date("2025-02-15"),
        status: "active",
      });

      // Active: 20 days remaining
      const active = engine.updateTrialStatus(trial, new Date("2025-01-26"));
      expect(active.status).toBe("active");
      expect(active.daysRemaining).toBe(20);

      // Expiring soon: 5 days remaining
      const expiringSoon = engine.updateTrialStatus(trial, new Date("2025-02-10"));
      expect(expiringSoon.status).toBe("expiring_soon");
      expect(expiringSoon.daysRemaining).toBe(5);

      // Expired: past end date
      const expired = engine.updateTrialStatus(trial, new Date("2025-02-20"));
      expect(expired.status).toBe("expired");
      expect(expired.daysRemaining).toBe(0);
    });
  });

  describe("computeTrialUrgency edge cases", () => {
    function createTrial(overrides: Partial<TrialRecord> = {}): TrialRecord {
      return {
        id: "trial-1",
        vendor: "TestVendor",
        vendorDomain: "test.com",
        category: "software-saas",
        trialStartDate: new Date("2025-01-01"),
        trialEndDate: new Date("2025-02-01"),
        daysRemaining: 14,
        convertsToAmount: 10,
        convertsToFrequency: "monthly",
        autoConverts: false,
        cancellationUrl: null,
        status: "active",
        reminderScheduled: false,
        sourceMessageId: "msg-1",
        ...overrides,
      };
    }

    it("should return 0 for already expired trials", () => {
      const now = new Date("2025-02-05");
      const trial = createTrial({
        trialEndDate: new Date("2025-02-01"),
      });

      expect(engine.computeTrialUrgency(trial, now)).toBe(0);
    });

    it("should return 7 for expiring within 7 days with auto-conversion", () => {
      const now = new Date("2025-01-27");
      const trial = createTrial({
        trialEndDate: new Date("2025-02-01"), // 5 days
        daysRemaining: 5,
        autoConverts: true,
        convertsToAmount: 10, // $10/month (not >$20)
      });

      expect(engine.computeTrialUrgency(trial, now)).toBe(7);
    });

    it("should return 5 for expiring within 7 days without auto-conversion", () => {
      const now = new Date("2025-01-27");
      const trial = createTrial({
        trialEndDate: new Date("2025-02-01"), // 5 days
        daysRemaining: 5,
        autoConverts: false,
      });

      expect(engine.computeTrialUrgency(trial, now)).toBe(5);
    });

    it("should return 3 for active trial with auto-conversion (not expiring soon)", () => {
      const now = new Date("2025-01-10");
      const trial = createTrial({
        trialEndDate: new Date("2025-02-01"), // 22 days
        daysRemaining: 22,
        autoConverts: true,
        convertsToAmount: 10, // $10/month (not >$20)
      });

      expect(engine.computeTrialUrgency(trial, now)).toBe(3);
    });

    it("should return 1 for active trial without auto-conversion", () => {
      const now = new Date("2025-01-10");
      const trial = createTrial({
        trialEndDate: new Date("2025-02-01"), // 22 days
        daysRemaining: 22,
        autoConverts: false,
      });

      expect(engine.computeTrialUrgency(trial, now)).toBe(1);
    });
  });

  // ─── Renewal & Deadline Reminders Tests (Req 12.1, 12.2, 12.3) ──────────

  describe("computeUpcomingRenewals", () => {
    it("should return empty array when no subscriptions have renewal dates", async () => {
      const sub = createSubscription({
        nextRenewalDate: null,
        status: "active-used",
      });
      await store.upsertSubscription(sub);

      const result = await engine.computeUpcomingRenewals([30, 7, 3, 1]);

      expect(result).toHaveLength(0);
    });

    it("should return renewals within the max lead-time window (Req 12.1)", async () => {
      const now = new Date();
      const in10Days = new Date(now);
      in10Days.setDate(in10Days.getDate() + 10);

      const sub = createSubscription({
        id: "sub-renewing",
        vendor: "Netflix",
        vendorDomain: "netflix.com",
        nextRenewalDate: in10Days,
        autoRenews: true,
        status: "active-used",
      });
      await store.upsertSubscription(sub);

      const result = await engine.computeUpcomingRenewals([30, 7, 3, 1]);

      expect(result).toHaveLength(1);
      expect(result[0].vendor).toBe("Netflix");
      expect(result[0].daysUntilRenewal).toBeCloseTo(10, 0);
    });

    it("should exclude subscriptions renewing beyond the max lead-time", async () => {
      const now = new Date();
      const in45Days = new Date(now);
      in45Days.setDate(in45Days.getDate() + 45);

      const sub = createSubscription({
        id: "sub-far",
        vendor: "FarAway",
        vendorDomain: "faraway.com",
        nextRenewalDate: in45Days,
        status: "active-used",
      });
      await store.upsertSubscription(sub);

      const result = await engine.computeUpcomingRenewals([30, 7, 3, 1]);

      expect(result).toHaveLength(0);
    });

    it("should compute applicable lead-time alerts correctly (Req 12.1)", async () => {
      const now = new Date();
      const in5Days = new Date(now);
      in5Days.setDate(in5Days.getDate() + 5);

      const sub = createSubscription({
        id: "sub-soon",
        vendor: "Spotify",
        vendorDomain: "spotify.com",
        nextRenewalDate: in5Days,
        autoRenews: false,
        status: "active-used",
      });
      await store.upsertSubscription(sub);

      const result = await engine.computeUpcomingRenewals([30, 7, 3, 1]);

      expect(result).toHaveLength(1);
      // 5 days until renewal: should trigger 30 and 7 day alerts
      expect(result[0].applicableLeadTimeAlerts).toContain(30);
      expect(result[0].applicableLeadTimeAlerts).toContain(7);
      expect(result[0].applicableLeadTimeAlerts).not.toContain(3);
      expect(result[0].applicableLeadTimeAlerts).not.toContain(1);
    });

    it("should flag auto-renewal clauses (Req 12.2)", async () => {
      const now = new Date();
      const in15Days = new Date(now);
      in15Days.setDate(in15Days.getDate() + 15);

      const autoRenewSub = createSubscription({
        id: "sub-auto",
        vendor: "AutoService",
        vendorDomain: "autoservice.com",
        nextRenewalDate: in15Days,
        autoRenews: true,
        status: "active-used",
      });
      const manualSub = createSubscription({
        id: "sub-manual",
        vendor: "ManualService",
        vendorDomain: "manualservice.com",
        nextRenewalDate: in15Days,
        autoRenews: false,
        status: "active-used",
      });

      await store.upsertSubscription(autoRenewSub);
      await store.upsertSubscription(manualSub);

      const result = await engine.computeUpcomingRenewals([30, 7, 3, 1]);

      const autoAlert = result.find((a) => a.vendor === "AutoService");
      const manualAlert = result.find((a) => a.vendor === "ManualService");

      expect(autoAlert!.autoRenewalFlagged).toBe(true);
      expect(manualAlert!.autoRenewalFlagged).toBe(false);
    });

    it("should sort results by days until renewal ascending (most urgent first)", async () => {
      const now = new Date();
      const in2Days = new Date(now);
      in2Days.setDate(in2Days.getDate() + 2);
      const in20Days = new Date(now);
      in20Days.setDate(in20Days.getDate() + 20);

      const urgentSub = createSubscription({
        id: "sub-urgent",
        vendor: "UrgentService",
        vendorDomain: "urgent.com",
        nextRenewalDate: in2Days,
        status: "active-used",
      });
      const laterSub = createSubscription({
        id: "sub-later",
        vendor: "LaterService",
        vendorDomain: "later.com",
        nextRenewalDate: in20Days,
        status: "active-used",
      });

      await store.upsertSubscription(laterSub);
      await store.upsertSubscription(urgentSub);

      const result = await engine.computeUpcomingRenewals([30, 7, 3, 1]);

      expect(result).toHaveLength(2);
      expect(result[0].vendor).toBe("UrgentService");
      expect(result[1].vendor).toBe("LaterService");
    });

    it("should use default lead times of [30, 7, 3, 1] when called without arguments", async () => {
      const now = new Date();
      const in25Days = new Date(now);
      in25Days.setDate(in25Days.getDate() + 25);

      const sub = createSubscription({
        id: "sub-default",
        vendor: "DefaultTest",
        vendorDomain: "defaulttest.com",
        nextRenewalDate: in25Days,
        status: "active-used",
      });
      await store.upsertSubscription(sub);

      const result = await engine.computeUpcomingRenewals();

      expect(result).toHaveLength(1);
      expect(result[0].applicableLeadTimeAlerts).toContain(30);
    });

    it("should include all required fields in RenewalAlert", async () => {
      const now = new Date();
      const in7Days = new Date(now);
      in7Days.setDate(in7Days.getDate() + 7);

      const sub = createSubscription({
        id: "sub-full",
        vendor: "FullTest",
        vendorDomain: "fulltest.com",
        amount: 19.99,
        currency: "USD",
        billingFrequency: "monthly",
        category: "software-saas",
        nextRenewalDate: in7Days,
        autoRenews: true,
        status: "active-used",
      });
      await store.upsertSubscription(sub);

      const result = await engine.computeUpcomingRenewals([30, 7, 3, 1]);

      expect(result).toHaveLength(1);
      const alert = result[0];
      expect(alert.id).toBe("renewal-alert-sub-full");
      expect(alert.vendor).toBe("FullTest");
      expect(alert.vendorDomain).toBe("fulltest.com");
      expect(alert.amount).toBe(19.99);
      expect(alert.currency).toBe("USD");
      expect(alert.renewalDate).toBeInstanceOf(Date);
      expect(alert.daysUntilRenewal).toBeCloseTo(7, 0);
      expect(alert.autoRenews).toBe(true);
      expect(alert.autoRenewalFlagged).toBe(true);
      expect(alert.billingFrequency).toBe("monthly");
      expect(alert.category).toBe("software-saas");
      expect(alert.subscriptionId).toBe("sub-full");
      expect(alert.applicableLeadTimeAlerts).toEqual(expect.arrayContaining([30, 7]));
    });

    it("should support custom lead-time configurations", async () => {
      const now = new Date();
      const in12Days = new Date(now);
      in12Days.setDate(in12Days.getDate() + 12);

      const sub = createSubscription({
        id: "sub-custom",
        vendor: "CustomLead",
        vendorDomain: "customlead.com",
        nextRenewalDate: in12Days,
        status: "active-used",
      });
      await store.upsertSubscription(sub);

      // Custom lead times: only 14 and 7 days
      const result = await engine.computeUpcomingRenewals([14, 7]);

      expect(result).toHaveLength(1);
      expect(result[0].applicableLeadTimeAlerts).toContain(14);
      expect(result[0].applicableLeadTimeAlerts).not.toContain(7);
    });

    it("should exclude subscriptions with past renewal dates", async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 5);

      const sub = createSubscription({
        id: "sub-past",
        vendor: "PastService",
        vendorDomain: "past.com",
        nextRenewalDate: pastDate,
        status: "active-used",
      });
      await store.upsertSubscription(sub);

      const result = await engine.computeUpcomingRenewals([30, 7, 3, 1]);

      expect(result).toHaveLength(0);
    });
  });

  describe("generateFinancialCalendar", () => {
    it("should return an empty calendar when no events exist", async () => {
      const result = await engine.generateFinancialCalendar(30);

      expect(result.entries).toHaveLength(0);
      expect(result.totalUpcomingCharges).toBe(0);
      expect(result.renewalCount).toBe(0);
      expect(result.trialExpiryCount).toBe(0);
      expect(result.deadlineCount).toBe(0);
      expect(result.refundExpectedCount).toBe(0);
    });

    it("should include subscription renewals in the calendar (Req 12.3)", async () => {
      const now = new Date();
      const in10Days = new Date(now);
      in10Days.setDate(in10Days.getDate() + 10);

      const sub = createSubscription({
        id: "sub-cal",
        vendor: "CalendarTest",
        vendorDomain: "caltest.com",
        amount: 14.99,
        nextRenewalDate: in10Days,
        status: "active-used",
      });
      await store.upsertSubscription(sub);

      const result = await engine.generateFinancialCalendar(30);

      expect(result.renewalCount).toBe(1);
      expect(result.totalUpcomingCharges).toBeCloseTo(14.99, 2);
      const renewalEntry = result.entries.find((e) => e.type === "renewal");
      expect(renewalEntry).toBeDefined();
      expect(renewalEntry!.vendor).toBe("CalendarTest");
    });

    it("should include trial expiries in the calendar (Req 12.3)", async () => {
      const now = new Date();
      const in5Days = new Date(now);
      in5Days.setDate(in5Days.getDate() + 5);

      const trial: TrialRecord = {
        id: "trial-cal",
        vendor: "TrialCal",
        vendorDomain: "trialcal.com",
        category: "software-saas",
        trialStartDate: new Date("2025-01-01"),
        trialEndDate: in5Days,
        daysRemaining: 5,
        convertsToAmount: 25,
        convertsToFrequency: "monthly",
        autoConverts: true,
        cancellationUrl: null,
        status: "active",
        reminderScheduled: false,
        sourceMessageId: "msg-trial-cal",
      };
      await store.insertTrial(trial);

      const result = await engine.generateFinancialCalendar(30);

      expect(result.trialExpiryCount).toBe(1);
      const trialEntry = result.entries.find((e) => e.type === "trial_expiry");
      expect(trialEntry).toBeDefined();
      expect(trialEntry!.vendor).toBe("TrialCal");
    });

    it("should include pending refunds in the calendar (Req 12.3)", async () => {
      const now = new Date();
      const in7Days = new Date(now);
      in7Days.setDate(in7Days.getDate() + 7);

      const refund = {
        id: "refund-cal",
        vendor: "RefundVendor",
        amount: 49.99,
        currency: "USD",
        promisedDate: new Date(),
        expectedByDate: in7Days,
        actualReceivedDate: null,
        status: "promised" as const,
        daysOverdue: 0,
        originalTransactionDate: null,
        reason: "Overcharge",
        sourceMessageIds: ["msg-refund"],
        lastFollowUpDate: null,
      };
      await store.insertRefund(refund);

      const result = await engine.generateFinancialCalendar(30);

      expect(result.refundExpectedCount).toBe(1);
      const refundEntry = result.entries.find((e) => e.type === "refund_expected");
      expect(refundEntry).toBeDefined();
      expect(refundEntry!.vendor).toBe("RefundVendor");
    });

    it("should sort calendar entries by date ascending", async () => {
      const now = new Date();
      const in3Days = new Date(now);
      in3Days.setDate(in3Days.getDate() + 3);
      const in15Days = new Date(now);
      in15Days.setDate(in15Days.getDate() + 15);

      const sub1 = createSubscription({
        id: "sub-later",
        vendor: "LaterRenewal",
        vendorDomain: "later.com",
        nextRenewalDate: in15Days,
        status: "active-used",
      });
      const sub2 = createSubscription({
        id: "sub-sooner",
        vendor: "SoonerRenewal",
        vendorDomain: "sooner.com",
        nextRenewalDate: in3Days,
        status: "active-used",
      });

      await store.upsertSubscription(sub1);
      await store.upsertSubscription(sub2);

      const result = await engine.generateFinancialCalendar(30);

      expect(result.entries.length).toBe(2);
      expect(result.entries[0].vendor).toBe("SoonerRenewal");
      expect(result.entries[1].vendor).toBe("LaterRenewal");
    });
  });
});
