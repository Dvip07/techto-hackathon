/**
 * Unit tests for Usage Signal Collector
 *
 * Tests usage score computation, recency decay, and zombie detection.
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

import { describe, it, expect } from "vitest";
import { UsageSignalCollector } from "./usage-signal-collector";
import type { UsageProfile } from "./usage-signal-collector";
import type { AnalyzedMessage } from "../types/signals";
import type { SubscriptionRecord } from "../types/models";

function createMockMessage(
  overrides: Partial<AnalyzedMessage> = {}
): AnalyzedMessage {
  return {
    messageId: `msg-${Math.random().toString(36).slice(2)}`,
    threadId: "thread-1",
    timestamp: new Date("2024-01-15"),
    sender: "noreply@spotify.com",
    senderDomain: "spotify.com",
    classifications: [],
    subscriptionSignal: null,
    commitmentSignals: [],
    contractSignal: null,
    refundSignal: null,
    trialSignal: null,
    financialEntities: [],
    usageIndicators: [],
    urgencyScore: 0,
    summary: "",
    ...overrides,
  };
}

function createMockSubscription(
  overrides: Partial<SubscriptionRecord> = {}
): SubscriptionRecord {
  return {
    id: `sub-${Math.random().toString(36).slice(2)}`,
    vendor: "Spotify",
    vendorDomain: "spotify.com",
    amount: 9.99,
    currency: "USD",
    billingFrequency: "monthly",
    category: "music-streaming",
    status: "active-used",
    usageScore: 5,
    wasteScore: 0,
    firstSeenDate: new Date("2023-01-01"),
    lastPaymentDate: new Date("2024-01-01"),
    nextRenewalDate: new Date("2024-02-01"),
    autoRenews: true,
    trialEndsDate: null,
    annualPlanAvailable: false,
    annualPlanAmount: null,
    annualSavingsIfSwitched: null,
    priceChangeHistory: [],
    sourceMessageIds: [],
    createdAt: new Date("2023-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

describe("UsageSignalCollector", () => {
  const collector = new UsageSignalCollector();

  describe("collectSignals", () => {
    it("should collect signals from vendor messages", () => {
      const messages: AnalyzedMessage[] = [
        createMockMessage({
          sender: "noreply@spotify.com",
          senderDomain: "spotify.com",
          usageIndicators: ["login_alert", "usage_report"],
          timestamp: new Date("2024-01-10"),
        }),
        createMockMessage({
          sender: "noreply@spotify.com",
          senderDomain: "spotify.com",
          usageIndicators: ["feature_update"],
          timestamp: new Date("2024-01-15"),
        }),
      ];

      const profile = collector.collectSignals("spotify.com", messages);

      expect(profile.vendor).toBe("spotify.com");
      expect(profile.totalEmailsFromVendor).toBe(2);
      expect(profile.loginAlerts).toBe(1);
      expect(profile.usageReports).toBe(1);
      expect(profile.featureAnnouncements).toBe(1);
      expect(profile.supportInteractions).toBe(0);
      expect(profile.newsletterEngagements).toBe(0);
    });

    it("should track the most recent interaction date", () => {
      const messages: AnalyzedMessage[] = [
        createMockMessage({
          senderDomain: "spotify.com",
          usageIndicators: ["login_alert"],
          timestamp: new Date("2024-01-05"),
        }),
        createMockMessage({
          senderDomain: "spotify.com",
          usageIndicators: ["usage_report"],
          timestamp: new Date("2024-01-20"),
        }),
      ];

      const profile = collector.collectSignals("spotify.com", messages);
      expect(profile.lastInteractionDate).toEqual(new Date("2024-01-20"));
    });

    it("should filter messages by vendor domain", () => {
      const messages: AnalyzedMessage[] = [
        createMockMessage({
          sender: "noreply@spotify.com",
          senderDomain: "spotify.com",
          usageIndicators: ["login_alert"],
        }),
        createMockMessage({
          sender: "noreply@netflix.com",
          senderDomain: "netflix.com",
          usageIndicators: ["usage_report"],
        }),
      ];

      const profile = collector.collectSignals("spotify.com", messages);
      expect(profile.totalEmailsFromVendor).toBe(1);
      expect(profile.loginAlerts).toBe(1);
      expect(profile.usageReports).toBe(0);
    });

    it("should return empty profile for vendor with no messages", () => {
      const messages: AnalyzedMessage[] = [
        createMockMessage({
          sender: "noreply@netflix.com",
          senderDomain: "netflix.com",
          usageIndicators: ["login_alert"],
        }),
      ];

      const profile = collector.collectSignals("spotify.com", messages);
      expect(profile.totalEmailsFromVendor).toBe(0);
      expect(profile.loginAlerts).toBe(0);
      expect(profile.lastInteractionDate).toEqual(new Date(0));
    });
  });

  describe("computeUsageScore", () => {
    it("should compute weighted score based on signal types (Req 5.2)", () => {
      const referenceDate = new Date("2024-01-15");
      const profile: UsageProfile = {
        vendor: "spotify.com",
        totalEmailsFromVendor: 5,
        emailsOpened: 3,
        lastInteractionDate: new Date("2024-01-15"), // same day = no decay
        interactionTypes: ["login_alert"],
        loginAlerts: 1, // 3 points
        usageReports: 1, // 2.5 points
        featureAnnouncements: 0,
        supportInteractions: 0,
        newsletterEngagements: 0,
        engagementDecayRate: 0,
      };

      const score = collector.computeUsageScore(profile, referenceDate);
      // Raw: 3 + 2.5 = 5.5, no decay → 5.5
      expect(score).toBe(5.5);
    });

    it("should compute weighted score with all signal types combined (Req 5.2)", () => {
      const referenceDate = new Date("2024-01-15");
      const profile: UsageProfile = {
        vendor: "spotify.com",
        totalEmailsFromVendor: 10,
        emailsOpened: 8,
        lastInteractionDate: new Date("2024-01-15"), // same day = no decay
        interactionTypes: [],
        loginAlerts: 1, // 3 points
        usageReports: 1, // 2.5 points
        featureAnnouncements: 1, // 1 point
        supportInteractions: 1, // 3 points
        newsletterEngagements: 1, // 0.5 points
        engagementDecayRate: 0,
      };

      const score = collector.computeUsageScore(profile, referenceDate);
      // Raw: 3 + 2.5 + 1 + 3 + 0.5 = 10, capped at 10, no decay → 10
      expect(score).toBe(10);
    });

    it("should compute score with only newsletter engagement (lowest weight) (Req 5.2)", () => {
      const referenceDate = new Date("2024-01-15");
      const profile: UsageProfile = {
        vendor: "spotify.com",
        totalEmailsFromVendor: 2,
        emailsOpened: 1,
        lastInteractionDate: new Date("2024-01-15"),
        interactionTypes: [],
        loginAlerts: 0,
        usageReports: 0,
        featureAnnouncements: 0,
        supportInteractions: 0,
        newsletterEngagements: 2, // 0.5 * 2 = 1 point
        engagementDecayRate: 0,
      };

      const score = collector.computeUsageScore(profile, referenceDate);
      // Raw: 1, no decay → 1
      expect(score).toBe(1);
    });

    it("should compute score with only feature updates (Req 5.2)", () => {
      const referenceDate = new Date("2024-01-15");
      const profile: UsageProfile = {
        vendor: "notion.so",
        totalEmailsFromVendor: 3,
        emailsOpened: 2,
        lastInteractionDate: new Date("2024-01-15"),
        interactionTypes: [],
        loginAlerts: 0,
        usageReports: 0,
        featureAnnouncements: 3, // 1 * 3 = 3 points
        supportInteractions: 0,
        newsletterEngagements: 0,
        engagementDecayRate: 0,
      };

      const score = collector.computeUsageScore(profile, referenceDate);
      // Raw: 3, no decay → 3
      expect(score).toBe(3);
    });

    it("should cap score at 10", () => {
      const referenceDate = new Date("2024-01-15");
      const profile: UsageProfile = {
        vendor: "spotify.com",
        totalEmailsFromVendor: 20,
        emailsOpened: 15,
        lastInteractionDate: new Date("2024-01-15"),
        interactionTypes: [],
        loginAlerts: 5, // 15 points
        usageReports: 3, // 7.5 points
        featureAnnouncements: 2, // 2 points
        supportInteractions: 1, // 3 points
        newsletterEngagements: 2, // 1 point
        engagementDecayRate: 0,
      };

      const score = collector.computeUsageScore(profile, referenceDate);
      expect(score).toBe(10);
    });

    it("should return 0 for no signals", () => {
      const profile: UsageProfile = {
        vendor: "spotify.com",
        totalEmailsFromVendor: 0,
        emailsOpened: 0,
        lastInteractionDate: new Date(0),
        interactionTypes: [],
        loginAlerts: 0,
        usageReports: 0,
        featureAnnouncements: 0,
        supportInteractions: 0,
        newsletterEngagements: 0,
        engagementDecayRate: 0,
      };

      const score = collector.computeUsageScore(profile);
      expect(score).toBe(0);
    });

    it("should apply recency decay at 45 days (50% decay) (Req 5.3)", () => {
      const referenceDate = new Date("2024-03-01");
      const profile: UsageProfile = {
        vendor: "spotify.com",
        totalEmailsFromVendor: 5,
        emailsOpened: 3,
        lastInteractionDate: new Date("2024-01-16"), // 45 days before reference
        interactionTypes: ["login_alert"],
        loginAlerts: 2, // 6 points
        usageReports: 0,
        featureAnnouncements: 0,
        supportInteractions: 0,
        newsletterEngagements: 0,
        engagementDecayRate: 0,
      };

      const score = collector.computeUsageScore(profile, referenceDate);
      // Raw: 6, decay factor at 45 days = 1 - 45/90 = 0.5
      // Final: 6 * 0.5 = 3.0
      expect(score).toBe(3);
    });

    it("should return 0 at 90 days (full decay) (Req 5.3)", () => {
      const referenceDate = new Date("2024-04-14");
      const profile: UsageProfile = {
        vendor: "spotify.com",
        totalEmailsFromVendor: 5,
        emailsOpened: 3,
        lastInteractionDate: new Date("2024-01-15"), // 90 days before reference
        interactionTypes: ["login_alert"],
        loginAlerts: 3, // 9 points
        usageReports: 1, // 2.5 points
        featureAnnouncements: 0,
        supportInteractions: 0,
        newsletterEngagements: 0,
        engagementDecayRate: 0,
      };

      const score = collector.computeUsageScore(profile, referenceDate);
      expect(score).toBe(0);
    });

    it("should return 0 beyond 90 days (Req 5.3)", () => {
      const referenceDate = new Date("2024-05-15");
      const profile: UsageProfile = {
        vendor: "spotify.com",
        totalEmailsFromVendor: 5,
        emailsOpened: 3,
        lastInteractionDate: new Date("2024-01-15"), // 121 days before reference
        interactionTypes: ["login_alert"],
        loginAlerts: 3,
        usageReports: 1,
        featureAnnouncements: 0,
        supportInteractions: 0,
        newsletterEngagements: 0,
        engagementDecayRate: 0,
      };

      const score = collector.computeUsageScore(profile, referenceDate);
      expect(score).toBe(0);
    });

    it("should return 0 at exactly 120 days (well beyond decay window) (Req 5.3)", () => {
      // 120 days is 30 days past the 90-day full decay window
      const lastInteraction = new Date("2024-01-15");
      const referenceDate = new Date(lastInteraction.getTime() + 120 * 24 * 60 * 60 * 1000);
      const profile: UsageProfile = {
        vendor: "spotify.com",
        totalEmailsFromVendor: 5,
        emailsOpened: 3,
        lastInteractionDate: lastInteraction,
        interactionTypes: ["login_alert"],
        loginAlerts: 2, // 6 points
        usageReports: 1, // 2.5 points
        featureAnnouncements: 1, // 1 point
        supportInteractions: 0,
        newsletterEngagements: 0,
        engagementDecayRate: 0,
      };

      const score = collector.computeUsageScore(profile, referenceDate);
      // At 120 days, decay factor = 0 (>= 90 days), so score = 0
      expect(score).toBe(0);
    });

    it("should apply no decay for same-day interaction (Req 5.3)", () => {
      const referenceDate = new Date("2024-01-15");
      const profile: UsageProfile = {
        vendor: "spotify.com",
        totalEmailsFromVendor: 3,
        emailsOpened: 2,
        lastInteractionDate: new Date("2024-01-15"),
        interactionTypes: ["support_ticket"],
        loginAlerts: 0,
        usageReports: 0,
        featureAnnouncements: 0,
        supportInteractions: 1, // 3 points
        newsletterEngagements: 0,
        engagementDecayRate: 0,
      };

      const score = collector.computeUsageScore(profile, referenceDate);
      // Raw: 3, decay factor = 1.0 (same day)
      expect(score).toBe(3);
    });
  });

  describe("detectZombieSubscriptions", () => {
    it("should detect zombie subscriptions with score 0 and 60+ days no engagement (Req 5.4)", () => {
      const referenceDate = new Date("2024-04-01");
      const sub = createMockSubscription({
        vendor: "Spotify",
        vendorDomain: "spotify.com",
        amount: 9.99,
        billingFrequency: "monthly",
      });

      // Profile with no recent engagement (last interaction 90 days ago)
      const profiles = new Map<string, UsageProfile>();
      profiles.set("Spotify", {
        vendor: "Spotify",
        totalEmailsFromVendor: 2,
        emailsOpened: 0,
        lastInteractionDate: new Date("2024-01-01"), // 91 days before reference
        interactionTypes: [],
        loginAlerts: 0,
        usageReports: 0,
        featureAnnouncements: 0,
        supportInteractions: 0,
        newsletterEngagements: 0,
        engagementDecayRate: 0,
      });

      const zombies = collector.detectZombieSubscriptions(
        [sub],
        profiles,
        referenceDate
      );

      expect(zombies).toHaveLength(1);
      expect(zombies[0].subscription.vendor).toBe("Spotify");
      expect(zombies[0].usageScore).toBe(0);
      expect(zombies[0].daysSinceLastEngagement).toBeGreaterThanOrEqual(60);
    });

    it("should NOT flag subscriptions with recent engagement", () => {
      const referenceDate = new Date("2024-01-20");
      const sub = createMockSubscription({
        vendor: "Spotify",
        vendorDomain: "spotify.com",
      });

      const profiles = new Map<string, UsageProfile>();
      profiles.set("Spotify", {
        vendor: "Spotify",
        totalEmailsFromVendor: 5,
        emailsOpened: 3,
        lastInteractionDate: new Date("2024-01-15"), // 5 days ago
        interactionTypes: ["login_alert"],
        loginAlerts: 2,
        usageReports: 1,
        featureAnnouncements: 0,
        supportInteractions: 0,
        newsletterEngagements: 0,
        engagementDecayRate: 0,
      });

      const zombies = collector.detectZombieSubscriptions(
        [sub],
        profiles,
        referenceDate
      );

      expect(zombies).toHaveLength(0);
    });

    it("should NOT flag subscriptions with score > 0 even if 60+ days", () => {
      const referenceDate = new Date("2024-04-01");
      const sub = createMockSubscription({
        vendor: "Spotify",
        vendorDomain: "spotify.com",
      });

      // Profile with some engagement but old (70 days ago)
      // The score won't be 0 because there are signals, but decay will reduce it
      const profiles = new Map<string, UsageProfile>();
      profiles.set("Spotify", {
        vendor: "Spotify",
        totalEmailsFromVendor: 5,
        emailsOpened: 3,
        lastInteractionDate: new Date("2024-02-20"), // ~40 days before reference
        interactionTypes: ["login_alert"],
        loginAlerts: 5, // 15 points raw, capped at 10
        usageReports: 0,
        featureAnnouncements: 0,
        supportInteractions: 0,
        newsletterEngagements: 0,
        engagementDecayRate: 0,
      });

      const zombies = collector.detectZombieSubscriptions(
        [sub],
        profiles,
        referenceDate
      );

      expect(zombies).toHaveLength(0);
    });

    it("should compute monthly and annual waste for zombie subscriptions (Req 5.5)", () => {
      const referenceDate = new Date("2024-04-01");
      const sub = createMockSubscription({
        vendor: "Spotify",
        vendorDomain: "spotify.com",
        amount: 14.99,
        billingFrequency: "monthly",
      });

      const profiles = new Map<string, UsageProfile>();
      profiles.set("Spotify", {
        vendor: "Spotify",
        totalEmailsFromVendor: 0,
        emailsOpened: 0,
        lastInteractionDate: new Date("2024-01-01"),
        interactionTypes: [],
        loginAlerts: 0,
        usageReports: 0,
        featureAnnouncements: 0,
        supportInteractions: 0,
        newsletterEngagements: 0,
        engagementDecayRate: 0,
      });

      const zombies = collector.detectZombieSubscriptions(
        [sub],
        profiles,
        referenceDate
      );

      expect(zombies).toHaveLength(1);
      expect(zombies[0].monthlyWaste).toBe(14.99);
      expect(zombies[0].annualWaste).toBeCloseTo(14.99 * 12, 2);
    });

    it("should handle annual billing frequency for waste calculation", () => {
      const referenceDate = new Date("2024-04-01");
      const sub = createMockSubscription({
        vendor: "Adobe",
        vendorDomain: "adobe.com",
        amount: 239.88,
        billingFrequency: "annual",
      });

      const profiles = new Map<string, UsageProfile>();
      profiles.set("Adobe", {
        vendor: "Adobe",
        totalEmailsFromVendor: 0,
        emailsOpened: 0,
        lastInteractionDate: new Date("2024-01-01"),
        interactionTypes: [],
        loginAlerts: 0,
        usageReports: 0,
        featureAnnouncements: 0,
        supportInteractions: 0,
        newsletterEngagements: 0,
        engagementDecayRate: 0,
      });

      const zombies = collector.detectZombieSubscriptions(
        [sub],
        profiles,
        referenceDate
      );

      expect(zombies).toHaveLength(1);
      // Annual amount / 12 = monthly waste
      expect(zombies[0].monthlyWaste).toBeCloseTo(239.88 / 12, 2);
      expect(zombies[0].annualWaste).toBeCloseTo(239.88, 2);
    });

    it("should handle subscriptions without profiles (no engagement data)", () => {
      const referenceDate = new Date("2024-04-01");
      const sub = createMockSubscription({
        vendor: "Unknown Service",
        vendorDomain: "unknown.com",
        lastPaymentDate: new Date("2024-01-01"),
      });

      const zombies = collector.detectZombieSubscriptions(
        [sub],
        new Map(),
        referenceDate
      );

      expect(zombies).toHaveLength(1);
      expect(zombies[0].usageScore).toBe(0);
    });

    it("should NOT flag as zombie at exactly 59 days (boundary test) (Req 5.4)", () => {
      const lastInteraction = new Date("2024-01-15");
      // 59 days later
      const referenceDate = new Date(lastInteraction.getTime() + 59 * 24 * 60 * 60 * 1000);
      const sub = createMockSubscription({
        vendor: "Spotify",
        vendorDomain: "spotify.com",
        lastPaymentDate: lastInteraction,
      });

      // Profile with no signals but last interaction only 59 days ago
      const profiles = new Map<string, UsageProfile>();
      profiles.set("Spotify", {
        vendor: "Spotify",
        totalEmailsFromVendor: 1,
        emailsOpened: 0,
        lastInteractionDate: lastInteraction,
        interactionTypes: [],
        loginAlerts: 0,
        usageReports: 0,
        featureAnnouncements: 0,
        supportInteractions: 0,
        newsletterEngagements: 0,
        engagementDecayRate: 0,
      });

      const zombies = collector.detectZombieSubscriptions(
        [sub],
        profiles,
        referenceDate
      );

      // Score is 0 (no signals) but only 59 days — should NOT be zombie
      expect(zombies).toHaveLength(0);
    });

    it("should flag as zombie at exactly 60 days with score 0 (boundary test) (Req 5.4)", () => {
      const lastInteraction = new Date("2024-01-15");
      // Exactly 60 days later
      const referenceDate = new Date(lastInteraction.getTime() + 60 * 24 * 60 * 60 * 1000);
      const sub = createMockSubscription({
        vendor: "Spotify",
        vendorDomain: "spotify.com",
        amount: 9.99,
        lastPaymentDate: lastInteraction,
      });

      // Profile with no signals
      const profiles = new Map<string, UsageProfile>();
      profiles.set("Spotify", {
        vendor: "Spotify",
        totalEmailsFromVendor: 1,
        emailsOpened: 0,
        lastInteractionDate: lastInteraction,
        interactionTypes: [],
        loginAlerts: 0,
        usageReports: 0,
        featureAnnouncements: 0,
        supportInteractions: 0,
        newsletterEngagements: 0,
        engagementDecayRate: 0,
      });

      const zombies = collector.detectZombieSubscriptions(
        [sub],
        profiles,
        referenceDate
      );

      // Score is 0 and exactly 60 days — should be zombie
      expect(zombies).toHaveLength(1);
      expect(zombies[0].usageScore).toBe(0);
      expect(zombies[0].daysSinceLastEngagement).toBe(60);
      expect(zombies[0].monthlyWaste).toBe(9.99);
    });
  });

  describe("computeTotalWaste", () => {
    it("should compute total monthly and annual waste across zombies (Req 5.5)", () => {
      const zombies = [
        {
          subscription: createMockSubscription({ amount: 9.99 }),
          usageScore: 0,
          lastEngagementDate: new Date("2024-01-01"),
          daysSinceLastEngagement: 90,
          monthlyWaste: 9.99,
          annualWaste: 119.88,
          recommendation: "Cancel",
        },
        {
          subscription: createMockSubscription({ amount: 14.99 }),
          usageScore: 0,
          lastEngagementDate: new Date("2024-01-01"),
          daysSinceLastEngagement: 90,
          monthlyWaste: 14.99,
          annualWaste: 179.88,
          recommendation: "Cancel",
        },
      ];

      const totals = collector.computeTotalWaste(zombies);
      expect(totals.monthlyWaste).toBeCloseTo(24.98, 2);
      expect(totals.annualWaste).toBeCloseTo(299.76, 2);
    });

    it("should return 0 for empty zombie list", () => {
      const totals = collector.computeTotalWaste([]);
      expect(totals.monthlyWaste).toBe(0);
      expect(totals.annualWaste).toBe(0);
    });
  });
});
