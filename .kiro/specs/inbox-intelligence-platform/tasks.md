# Implementation Plan: Inbox Intelligence Platform

## Overview

This implementation plan builds the Inbox Intelligence platform incrementally — starting with the data layer and core interfaces, then the ingestion pipeline, followed by the unified analysis engine, the thirteen intelligence features, the action engine, and finally the React dashboard. Each task builds on previous work, ensuring no orphaned code. TypeScript is used throughout with React + Tailwind for the frontend, SQLite for development storage, and Claude for AI classification.

## Tasks

- [x] 1. Set up project structure, core interfaces, and data layer
  - [x] 1.1 Initialize project and define core TypeScript interfaces
    - Create project directory structure: `src/types/`, `src/ingestion/`, `src/classifier/`, `src/store/`, `src/intelligence/`, `src/actions/`, `src/api/`, `src/dashboard/`
    - Install dependencies: typescript, sqlite3/better-sqlite3, react, tailwind, fast-check (testing), vitest
    - Define all shared TypeScript types and interfaces in `src/types/`: `FinancialSignalType`, `BillingFrequency`, `SubscriptionCategory`, `SubscriptionStatus`, `CommitmentStatus`, `ContractType`, `RiskFlag`, `FeatureArea`
    - Define data model interfaces: `SubscriptionRecord`, `TrialRecord`, `RefundRecord`, `FinancialCommitment`, `FinancialObligation`, `PaymentRecord`, `PriceChange`, `ObligationDeadline`, `PenaltyClause`
    - Define signal interfaces: `AnalyzedMessage`, `SubscriptionSignal`, `RefundSignal`, `TrialSignal`, `CommitmentSignal`, `ContractSignal`, `UsageIndicator`
    - Define output types: `PrioritizedItem`, `SmartDigest`, `DigestAlert`, `DigestAction`, `CreepAlert`, `RecurringSpendSnapshot`, `BillingOptimization`, `NegotiationOpportunity`, `CalendarEntry`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 1.2 Implement the Unified Entity Store with SQLite
    - Create `src/store/entity-store.ts` implementing the `UnifiedEntityStore` interface
    - Implement SQLite schema with tables: `messages`, `subscriptions`, `trials`, `refunds`, `commitments`, `obligations`, `payments`, `spend_snapshots`
    - Implement subscription ledger methods: `upsertSubscription`, `getSubscriptions`, `getActiveSubscriptions`, `getZombieSubscriptions`, `getSubscriptionHistory`
    - Implement trial registry methods: `insertTrial`, `getActiveTrials`, `getExpiringTrials`
    - Implement refund tracker methods: `insertRefund`, `getPendingRefunds`, `getOverdueRefunds`, `markRefundReceived`
    - Implement commitment ledger methods: `insertCommitment`, `updateCommitmentStatus`, `getOpenCommitments`, `getOverdueCommitments`, `getPaymentPromises`
    - Implement obligation ledger methods: `upsertObligation`, `getObligations`, `getUpcomingDeadlines`
    - Implement payment history methods: `insertPayment`, `getPaymentHistory`, `getMonthlySpendSummary`, `getSpendByCategory`, `getTotalRecurringSpend`
    - Implement cross-cutting queries: `getFinancialCalendar`, `searchByVendor`, `getDigestData`
    - Implement deduplication logic for subscription upserts by vendor domain
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ]* 1.3 Write unit tests for Entity Store
    - Test subscription upsert deduplication by vendor domain
    - Test refund status transitions (promised → processing → received, promised → overdue)
    - Test commitment status updates and overdue detection
    - Test financial calendar query aggregation
    - Test monthly spend summary calculations
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 2. Implement Gmail ingestion pipeline
  - [x] 2.1 Implement Gmail MCP Connector
    - Create `src/ingestion/gmail-connector.ts` implementing the `GmailMCPConnector` interface
    - Implement OAuth2 authentication with token refresh logic
    - Implement `fetchMessages` with pagination via `pageToken`
    - Implement `incrementalSync` using `historyId` for fetching only new messages
    - Implement rate limiting to respect Gmail API quota of 250 units/second
    - Implement `fetchAttachment` for downloading receipts, invoices, and contracts
    - Implement error handling with automatic token refresh on auth errors
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 2.2 Implement Batch Fetcher and Attachment Parser
    - Create `src/ingestion/batch-fetcher.ts` for orchestrating batch message retrieval
    - Create `src/ingestion/attachment-parser.ts` for parsing PDF receipts, invoices, and contract attachments
    - Implement message normalization from raw Gmail format to `ParsedMessage` interface
    - Wire batch fetcher to use Gmail connector with incremental sync
    - _Requirements: 1.2, 1.4, 1.5_

  - [ ]* 2.3 Write unit tests for Gmail ingestion
    - Test incremental sync with historyId tracking
    - Test pagination handling across multiple pages
    - Test rate limiting behavior
    - Test token refresh on authentication errors
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_

- [x] 3. Implement Claude Unified Classifier
  - [x] 3.1 Implement the Claude Unified Classifier
    - Create `src/classifier/claude-classifier.ts` implementing the `ClaudeUnifiedClassifier` interface
    - Implement `analyzeMessage` that processes a single message and returns a structured `AnalyzedMessage`
    - Implement `analyzeBatch` for processing multiple messages efficiently
    - Build the Claude prompt chain that extracts all financial signal types in a single pass: subscription signals, commitment signals, contract signals, refund signals, trial signals, usage indicators
    - Implement urgency score assignment (0-10) based on financial impact and time sensitivity
    - Implement confidence scoring for commitment detection (0-1)
    - Handle all `FinancialSignalType` classifications including noise filtering
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 3.2 Implement Usage Signal Collector
    - Create `src/classifier/usage-signal-collector.ts` implementing the `UsageSignalCollector` interface
    - Implement `collectSignals` to gather engagement signals per vendor from analyzed messages
    - Implement `computeUsageScore` with weighted signal scoring: login_alert (3), usage_report (2.5), support_interaction (3), feature_update (1), newsletter_engagement (0.5)
    - Implement recency decay factor that reduces score linearly to zero over 90 days
    - Implement `detectZombieSubscriptions` for subscriptions with score 0 and no engagement for 60+ days
    - Compute total monthly and annual dollar waste across zombie subscriptions
    - Track engagement decay rate per subscription
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 3.3 Write unit tests for Classifier and Usage Scoring
    - Test usage score computation with various signal combinations
    - Test recency decay factor at 0, 45, 90, and 120 days
    - Test zombie subscription detection threshold (60 days, score 0)
    - Test urgency score assignment for different financial signal types
    - Test batch analysis returns results for all messages
    - _Requirements: 2.1, 2.7, 5.1, 5.2, 5.3, 5.4_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Intelligence Engine - Core Features
  - [x] 5.1 Implement Subscription and Spend Scanner
    - Create `src/intelligence/intelligence-engine.ts` as the main orchestrator
    - Implement `scanSubscriptions` that queries the entity store and produces a complete subscription scan result
    - Implement subscription status classification: active-used, active-unused, zombie, price-increased, renewing-soon, trial-active, cancelled, unknown
    - Implement price change detection between invoice cycles with percentage change calculation
    - Implement category classification for all subscription categories
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 5.2 Implement Smart Savings and Negotiation Engine
    - Implement `generateSavingsRecommendations` with redundancy detection by functional category
    - Implement `generateNegotiationOpportunities` triggered by price increases, competitor pricing, long tenure, and low usage
    - Implement total potential savings calculation (monthly and annual)
    - Rank savings recommendations by annual savings amount descending
    - Factor in user tenure for negotiation leverage scoring
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 5.3 Implement Free Trial Expiry Tracker
    - Implement `trackTrialExpiries` that queries active trials and computes days remaining
    - Implement urgency scoring: auto-convert >$20/mo → urgency 9, expiring within 48 hours → urgency 10
    - Store and surface cancellation URLs from original trial emails
    - Track trial status transitions: active → expiring_soon → expired → cancelled
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6_

  - [x] 5.4 Implement Annual vs Monthly Optimizer
    - Implement `findBillingOptimizations` that identifies monthly subscriptions with annual plan alternatives
    - Calculate break-even point in months for switching
    - Recommend with high confidence only for subscriptions held 6+ months with stable usage
    - Recommend waiting for subscriptions held fewer than 6 months
    - Compute total annual savings across all eligible optimizations
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ]* 5.5 Write unit tests for Core Intelligence Features
    - Test subscription status classification logic
    - Test redundancy detection with overlapping categories
    - Test negotiation opportunity generation on price increase
    - Test trial urgency scoring thresholds
    - Test billing optimization break-even calculation
    - Test savings ranking by annual amount
    - _Requirements: 4.1, 4.2, 4.5, 6.1, 6.2, 6.6, 7.3, 7.4, 8.1, 8.2, 8.3_

- [x] 6. Implement Intelligence Engine - Tracking and Analysis Features
  - [x] 6.1 Implement Subscription Creep Detection
    - Implement `detectSubscriptionCreep` with monthly spend snapshots
    - Trigger creep alert when spend grows ≥15% over 90 days or ≥3 new subscriptions in 30 days
    - Include breakdown of contributing new subscriptions and price hikes
    - Generate natural language insight describing the increase
    - Support alert acknowledgment to suppress repeated alerts
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 6.2 Implement Refund and Credit Tracker
    - Implement `trackRefundsAndCredits` that queries pending and overdue refunds
    - Set expected-by date to 14 days from promise date when no specific date given
    - Mark refunds as overdue when not confirmed within 14 days of expected date
    - Track total pending and overdue refund amounts
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 10.6_

  - [x] 6.3 Implement Payment Promise Tracker
    - Implement `trackPaymentPromises` that queries inbound payment commitments
    - Mark promises as overdue when due date passes without payment receipt
    - Rank overdue promises by financial amount and days overdue
    - Detect fulfillment by matching payment receipt emails to prior promises
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6_

  - [x] 6.4 Implement Renewal and Deadline Reminders
    - Implement `computeUpcomingRenewals` with configurable lead-time alerts (30, 7, 3, 1 days)
    - Flag auto-renewal clauses the user did not explicitly opt into
    - Generate unified financial calendar with all upcoming charges, renewals, deadlines, trial expiries, and refund dates
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 6.5 Implement Spend Pattern Analysis
    - Implement `analyzeSpendingPatterns` with monthly totals and category breakdowns
    - Compute month-over-month and quarter-over-quarter comparisons
    - Detect spending anomalies (sudden increases, new recurring charges)
    - Generate natural language insights describing trends
    - Predict future monthly spend based on historical patterns
    - Identify top spending category with percentage of total
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

  - [x] 6.6 Implement Financial Commitment Tracker and Contract Watch
    - Implement `trackFinancialCommitments` for both inbound and outbound commitments
    - Mark commitments as overdue after 14+ days past due date with no activity
    - Rank open commitments by financial value
    - Implement `watchObligations` for contract monitoring with risk flag detection
    - Flag contracts with: auto_renewal, price_escalation, penalty_clause, missed_notice_window, unfavorable_terms, silent_renewal, expiring_soon, high_financial_exposure
    - Compute total financial exposure across all active obligations
    - Feed relevant commitments into Refund Tracker and Payment Promise Tracker
    - _Requirements: 14.1, 14.2, 14.4, 14.5, 14.6, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

  - [x]* 6.7 Write unit tests for Tracking and Analysis Features
    - Test creep detection threshold (15% over 90 days, 3+ subscriptions in 30 days)
    - Test refund overdue detection at 14-day boundary
    - Test payment promise fulfillment matching
    - Test financial calendar aggregation across all event types
    - Test spend pattern anomaly detection
    - Test contract risk flag assignment logic
    - Test commitment overdue marking at 14-day threshold
    - _Requirements: 9.2, 9.3, 10.2, 10.3, 11.3, 11.6, 12.1, 12.3, 13.3, 14.2, 15.2, 15.3, 15.4, 15.5_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement Action Engine and Priority Ranking
  - [x] 8.1 Implement Priority Ranker
    - Create `src/actions/priority-ranker.ts` implementing urgency scoring (0-10) based on financial impact and time sensitivity
    - Assign urgency 10 for trials expiring within 48 hours that auto-convert
    - Assign urgency 9 for trials auto-converting to plans >$20/month
    - Rank all items by urgency score descending; break ties by financial impact
    - Implement `getPriorityFeed` that aggregates insights from all 13 feature areas
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5_

  - [x] 8.2 Implement Draft Generator
    - Create `src/actions/draft-generator.ts` implementing all draft generation methods
    - Implement `generateCancellationDraft` addressed to subscription vendor
    - Implement `generateNegotiationDraft` incorporating reason, current amount, tenure, and requested outcome
    - Implement `generateRefundFollowUpDraft` referencing original promise date and amount
    - Implement `generateTrialCancellationDraft` including cancellation URL when available
    - Implement `generateFollowUpDraft` for payment promises referencing original promise and due date
    - All drafts require user approval before sending
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

  - [x] 8.3 Implement Calendar and Notification Engine
    - Create `src/actions/calendar-scheduler.ts` for scheduling reminders via Google Calendar MCP
    - Implement `scheduleReminder` and `scheduleBatchReminders` for renewal alerts
    - Implement `scheduleTrialExpiryReminder` with configurable lead days (7, 3, 1)
    - Create calendar reminders within 5 minutes of detection
    - Create `src/actions/notification-engine.ts` for dispatching notifications and creep alerts
    - _Requirements: 7.5, 12.4, 15.7, 20.4_

  - [x] 8.4 Implement Smart Digest Composer
    - Create `src/actions/digest-composer.ts` implementing the `Digest_Composer`
    - Implement `composeDigest` that generates daily/weekly digest with: total recurring spend, spend change, potential savings, top 5 priority items, renewals, expiring trials, overdue refunds, broken promises, savings opportunities, spending insight, creep warning
    - Attach one-click actions to each digest item (cancel, negotiate, follow_up, set_reminder, review, acknowledge)
    - Implement `deliverDigest` for dashboard and optional email delivery
    - Deliver daily digest by 7:00 AM user's local time
    - Implement priority adaptation: reduce priority of repeatedly dismissed item types
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_

  - [ ]* 8.5 Write unit tests for Action Engine
    - Test priority ranking with urgency score ordering and tie-breaking
    - Test trial urgency score assignment (48h → 10, >$20 auto-convert → 9)
    - Test draft generation includes required fields (vendor, amount, tenure, reason)
    - Test digest composition includes all required sections
    - Test digest priority adaptation on repeated dismissals
    - _Requirements: 17.1, 17.2, 18.1, 18.2, 18.3, 18.5, 16.1, 16.2, 16.7_

- [x] 9. Implement Main Processing Pipeline
  - [x] 9.1 Wire the full pipeline together
    - Create `src/pipeline/pipeline-runner.ts` implementing the `runFullPipeline` function
    - Wire Gmail connector → batch fetcher → classifier → entity store → intelligence engine → action engine → digest
    - Implement incremental sync flow: fetch new messages, classify, persist to all ledgers, run all 13 intelligence features, generate priority feed, execute automated actions, generate digest
    - Ensure pipeline completes in <30 seconds for 100 messages
    - Store and update lastHistoryId after each successful run
    - _Requirements: 1.2, 2.1, 2.8, 3.1, 3.7, 20.1, 20.5_

  - [ ]* 9.2 Write integration tests for the pipeline
    - Test end-to-end flow from raw message to entity store persistence
    - Test that subscription signals create subscription records
    - Test that trial signals create trial records
    - Test that refund signals create refund records
    - Test that commitment signals create commitment records
    - Test that contract signals create obligation records
    - Test pipeline performance with 100 mock messages
    - _Requirements: 1.2, 2.1, 3.1, 3.2, 3.3, 3.4, 3.5, 20.1_

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement Dashboard API
  - [x] 11.1 Implement Dashboard API endpoints
    - Create `src/api/dashboard-api.ts` implementing the `DashboardAPI` interface
    - Implement global endpoints: `getPriorityFeed`, `getFinancialCalendar`, `getSmartDigest`, `dismissItem`
    - Implement Subscriptions tab endpoints: `getSubscriptionOverview`, `getUsageScores`, `getActiveTrials`, `getZombieSubscriptions`
    - Implement Savings tab endpoints: `getSavingsRecommendations`, `getBillingOptimizations`, `getNegotiationOpportunities`, `getTotalPotentialSavings`
    - Implement Reminders tab endpoints: `getUpcomingRenewals`, `getExpiringTrials`, `configureLeadTime`
    - Implement Patterns tab endpoints: `getSpendPatterns`, `getMonthOverMonthComparison`, `getSubscriptionCreepData`, `getRecurringSpendTimeline`
    - Implement Commitments tab endpoints: `getFinancialCommitments`, `getPaymentPromises`, `getPendingRefunds`
    - Implement Obligations tab endpoint: `getObligationWatch`
    - Implement action endpoints: `approveDraft`, `requestDraft`, `markRefundReceived`, `acknowledgeCreepAlert`
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 19.9_

  - [ ]* 11.2 Write unit tests for Dashboard API
    - Test priority feed returns items sorted by urgency score
    - Test dismiss item removes from active feed
    - Test configureLeadTime persists custom lead days per vendor
    - Test action endpoints invoke correct Action Engine methods
    - _Requirements: 19.1, 19.8, 19.9, 12.5_

- [x] 12. Implement React Dashboard Frontend
  - [x] 12.1 Set up React + Tailwind dashboard shell
    - Create `src/dashboard/App.tsx` with tab navigation layout
    - Set up Tailwind CSS configuration
    - Create shared UI components: `TabBar`, `PriorityCard`, `ActionButton`, `AlertBadge`, `FinancialCalendarWidget`
    - Implement responsive layout with sidebar navigation for tabs
    - _Requirements: 19.1_

  - [x] 12.2 Implement Overview tab
    - Create `src/dashboard/tabs/OverviewTab.tsx`
    - Display priority feed as the primary view with urgency-ranked cards
    - Display smart digest summary with one-click actions
    - Implement dismiss functionality that records dismissal for priority adjustment
    - _Requirements: 19.1, 18.6, 19.9_

  - [x] 12.3 Implement Subscriptions tab
    - Create `src/dashboard/tabs/SubscriptionsTab.tsx`
    - Display subscription scanner results with status badges (active, zombie, price-increased, etc.)
    - Display usage scores per subscription with visual indicators
    - Display active trials with countdown timers
    - Highlight zombie subscriptions with waste amount
    - _Requirements: 19.2_

  - [x] 12.4 Implement Savings tab
    - Create `src/dashboard/tabs/SavingsTab.tsx`
    - Display savings recommendations ranked by annual savings
    - Display billing optimization opportunities with break-even info
    - Display negotiation opportunities with context
    - Show total potential savings summary at top
    - Include one-click action buttons for cancel, negotiate, switch-annual
    - _Requirements: 19.3, 6.5_

  - [x] 12.5 Implement Reminders tab
    - Create `src/dashboard/tabs/RemindersTab.tsx`
    - Display upcoming renewals with lead-time countdown
    - Display expiring trials with auto-conversion warnings
    - Display deadline alerts from obligations
    - Allow user to configure custom lead-time days per vendor
    - _Requirements: 19.4, 12.5_

  - [x] 12.6 Implement Patterns tab
    - Create `src/dashboard/tabs/PatternsTab.tsx`
    - Display spend trend charts (monthly totals over time)
    - Display month-over-month comparison with percentage change
    - Display category breakdown with percentages
    - Display creep alerts with breakdown and acknowledge action
    - Display recurring spend timeline
    - _Requirements: 19.5_

  - [x] 12.7 Implement Commitments tab
    - Create `src/dashboard/tabs/CommitmentsTab.tsx`
    - Display payment promises with status (open, overdue, fulfilled)
    - Display pending refunds with expected dates and overdue flags
    - Display financial commitment status with follow-up actions
    - _Requirements: 19.6_

  - [x] 12.8 Implement Obligations tab
    - Create `src/dashboard/tabs/ObligationsTab.tsx`
    - Display contracts with risk flag badges
    - Display financial exposure summary
    - Display upcoming obligation deadlines
    - Highlight contracts with penalty clauses and missed notice windows
    - _Requirements: 19.7_

  - [x] 12.9 Wire one-click actions across all tabs
    - Implement action handler that invokes Dashboard API action endpoints
    - Wire cancel, negotiate, follow-up, set-reminder, review, acknowledge actions
    - Show draft preview before sending (user approval required)
    - Update UI state after action completion
    - _Requirements: 19.8, 17.6_

  - [ ]* 12.10 Write integration tests for Dashboard
    - Test tab navigation renders correct content
    - Test one-click action invokes correct API endpoint
    - Test dismiss updates priority feed
    - Test lead-time configuration persists
    - _Requirements: 19.1, 19.8, 19.9, 12.5_

- [~] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The design uses TypeScript throughout — all implementations follow the interfaces defined in the design document
- SQLite is used for development; the schema supports migration to PostgreSQL for production
- Claude is used for the unified classifier — all 13 feature areas share the same classification output
- The pipeline is designed for incremental sync — only new messages are processed on each run
- Unit tests validate specific examples and edge cases
- Integration tests validate end-to-end flows through the pipeline

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "2.1"] },
    { "id": 3, "tasks": ["2.2", "3.1"] },
    { "id": 4, "tasks": ["2.3", "3.2"] },
    { "id": 5, "tasks": ["3.3", "5.1"] },
    { "id": 6, "tasks": ["5.2", "5.3", "5.4"] },
    { "id": 7, "tasks": ["5.5", "6.1", "6.2", "6.3", "6.4", "6.5"] },
    { "id": 8, "tasks": ["6.6"] },
    { "id": 9, "tasks": ["6.7", "8.1"] },
    { "id": 10, "tasks": ["8.2", "8.3", "8.4"] },
    { "id": 11, "tasks": ["8.5", "9.1"] },
    { "id": 12, "tasks": ["9.2", "11.1"] },
    { "id": 13, "tasks": ["11.2", "12.1"] },
    { "id": 14, "tasks": ["12.2", "12.3", "12.4", "12.5", "12.6", "12.7", "12.8"] },
    { "id": 15, "tasks": ["12.9"] },
    { "id": 16, "tasks": ["12.10"] }
  ]
}
```
