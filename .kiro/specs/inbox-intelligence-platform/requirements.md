# Requirements Document

## Introduction

Inbox Intelligence is a Gmail-native AI financial assistant that transforms unstructured email into actionable financial intelligence. It operates as a single unified tool with thirteen analytical capabilities applied to the same underlying data through one ingestion pipeline, one analysis engine, and one unified dashboard. The system scans the user's inbox to detect subscriptions, score usage, surface savings opportunities, track financial commitments, monitor contracts, predict spending patterns, and deliver a daily smart digest.

## Glossary

- **Gmail_MCP_Connector**: The component responsible for authenticating with Gmail API and fetching message batches with pagination, rate limiting, and incremental sync
- **Usage_Signal_Collector**: The component that collects engagement signals from vendor emails to determine subscription usage levels
- **Claude_Classifier**: The unified AI classifier that processes every message to extract financial entities, detect commitments, identify subscription signals, flag contract terms, and classify financial signal types in a single pass
- **Entity_Store**: The single persistent store (SQLite/PostgreSQL) for all financial intelligence data including subscription ledger, commitment ledger, obligation ledger, payment history, free trial registry, and refund tracker
- **Intelligence_Engine**: The orchestrator that runs all thirteen feature area analyses against the shared entity store
- **Action_Engine**: The component that executes actions across all feature areas including draft generation, calendar scheduling, notifications, and digest delivery
- **Dashboard**: The unified React + Tailwind frontend that surfaces prioritized insights with one-click actions across all feature tabs
- **Priority_Ranker**: The sub-component of the Action Engine that ranks all insights by urgency score and financial impact
- **Digest_Composer**: The sub-component that compiles daily or weekly smart digest summaries
- **Subscription_Ledger**: The data store tracking all detected subscriptions with status, amounts, and payment history
- **Commitment_Ledger**: The data store tracking financial promises made to and by the user
- **Obligation_Ledger**: The data store tracking contracts, leases, and financial agreements
- **Usage_Score**: A numeric value from 0 to 10 representing how actively a user engages with a subscription based on email signals
- **Zombie_Subscription**: A subscription the user is paying for but has zero engagement with for 60 or more days
- **Creep_Alert**: A notification triggered when total recurring spend grows beyond configurable thresholds over a rolling period
- **Financial_Calendar**: A unified view of all upcoming financial events including renewals, payments, deadlines, and trial expiries

---

## Requirements

### Requirement 1: Gmail Ingestion and Message Fetching

**User Story:** As a user, I want the system to automatically fetch and process my Gmail messages, so that my financial data is always up to date without manual effort.

#### Acceptance Criteria

1. WHEN the user authenticates with Gmail, THE Gmail_MCP_Connector SHALL establish an OAuth2 session and store a refresh token for subsequent access
2. WHEN a pipeline run is triggered, THE Gmail_MCP_Connector SHALL perform incremental sync using the last known historyId to fetch only new messages since the previous run
3. WHILE fetching messages, THE Gmail_MCP_Connector SHALL respect Gmail API rate limits of 250 quota units per second by throttling requests
4. WHEN a message contains attachments such as receipts, invoices, or contracts, THE Gmail_MCP_Connector SHALL download and pass the attachment content to the classifier for parsing
5. WHEN pagination is required for large result sets, THE Gmail_MCP_Connector SHALL use pageToken to retrieve all available messages across multiple pages
6. IF the Gmail API returns an authentication error, THEN THE Gmail_MCP_Connector SHALL attempt token refresh and retry the request before reporting failure

---

### Requirement 2: Unified Message Classification and Entity Extraction

**User Story:** As a user, I want every email to be automatically analyzed for financial signals, so that no subscription, commitment, or financial event goes undetected.

#### Acceptance Criteria

1. WHEN a new message is received, THE Claude_Classifier SHALL analyze the message and produce a structured AnalyzedMessage containing all detected financial signal types in a single pass
2. WHEN a message contains subscription signals, THE Claude_Classifier SHALL extract vendor name, amount, currency, billing frequency, category, renewal date, active status, and auto-renewal flag
3. WHEN a message contains commitment signals, THE Claude_Classifier SHALL extract commitment type, owner, counterparty, due date, financial value, and confidence score between 0 and 1
4. WHEN a message contains contract signals, THE Claude_Classifier SHALL extract contract type, parties, total value, renewal date, auto-renewal status, penalty clauses, notice window days, and financial exposure
5. WHEN a message contains refund signals, THE Claude_Classifier SHALL extract vendor, amount, currency, status, expected date, and reason
6. WHEN a message contains trial signals, THE Claude_Classifier SHALL extract vendor, trial start date, trial end date, conversion amount, conversion frequency, auto-conversion flag, and cancellation URL
7. THE Claude_Classifier SHALL assign an urgency score between 0 and 10 to each analyzed message based on financial impact and time sensitivity
8. WHEN processing a batch of messages, THE Claude_Classifier SHALL analyze all messages in the batch and return results for each message

---

### Requirement 3: Entity Storage and Data Persistence

**User Story:** As a user, I want all my financial data to be reliably stored and queryable, so that the system can provide accurate insights across all feature areas.

#### Acceptance Criteria

1. WHEN an analyzed message contains a subscription signal, THE Entity_Store SHALL upsert the subscription record in the Subscription_Ledger with deduplication by vendor domain
2. WHEN an analyzed message contains a trial signal, THE Entity_Store SHALL insert a trial record in the Free Trial Registry
3. WHEN an analyzed message contains a refund signal, THE Entity_Store SHALL insert a refund record with status tracking
4. WHEN an analyzed message contains commitment signals, THE Entity_Store SHALL insert each commitment into the Commitment_Ledger
5. WHEN an analyzed message contains a contract signal, THE Entity_Store SHALL upsert the obligation in the Obligation_Ledger
6. THE Entity_Store SHALL maintain a complete payment history for spend pattern analysis
7. THE Entity_Store SHALL support cross-cutting queries including financial calendar, vendor profile lookup, and digest data aggregation

---

### Requirement 4: Subscription and Spend Scanning

**User Story:** As a user, I want to see a complete picture of all my subscriptions and recurring charges, so that I know exactly where my money is going.

#### Acceptance Criteria

1. THE Intelligence_Engine SHALL maintain a live subscription ledger containing all detected subscriptions with vendor, amount, billing frequency, category, and status
2. WHEN a subscription has no email engagement signals for 60 or more days, THE Intelligence_Engine SHALL classify the subscription status as zombie
3. WHEN a price change is detected between invoice cycles, THE Intelligence_Engine SHALL record the previous amount, new amount, percentage change, and detection date in the subscription price change history
4. THE Intelligence_Engine SHALL classify each subscription into one of the defined categories: music-streaming, video-streaming, productivity, cloud-storage, fitness, news-media, software-saas, security-vpn, food-delivery, gaming, education, utilities, insurance, or other
5. WHEN scanning subscriptions, THE Intelligence_Engine SHALL assign a status of active-used, active-unused, zombie, price-increased, renewing-soon, trial-active, cancelled, or unknown to each subscription

---

### Requirement 5: Subscription Usage Scoring

**User Story:** As a user, I want to know which subscriptions I actually use, so that I can identify waste and make informed cancellation decisions.

#### Acceptance Criteria

1. THE Usage_Signal_Collector SHALL compute a usage score between 0 and 10 for each subscription based on engagement signals from vendor emails
2. WHEN computing usage scores, THE Usage_Signal_Collector SHALL weight login alerts at 3 points, usage reports at 2.5 points, support interactions at 3 points, feature updates at 1 point, and newsletter engagement at 0.5 points
3. THE Usage_Signal_Collector SHALL apply a recency decay factor that reduces the score linearly to zero over 90 days since the last interaction
4. WHEN a subscription has a usage score of 0 and no engagement for 60 or more days, THE Usage_Signal_Collector SHALL flag the subscription as a zombie subscription
5. THE Usage_Signal_Collector SHALL compute the total monthly and annual dollar waste across all zombie subscriptions
6. THE Usage_Signal_Collector SHALL track the engagement decay rate for each subscription to detect declining usage trends

---

### Requirement 6: Smart Savings and Negotiation Engine

**User Story:** As a user, I want to receive actionable savings recommendations and negotiation opportunities, so that I can reduce my recurring spend without losing services I value.

#### Acceptance Criteria

1. WHEN two or more active subscriptions exist in the same functional category, THE Intelligence_Engine SHALL detect redundancy and recommend cancelling the subscription with the lower usage score
2. WHEN a vendor raises prices, THE Intelligence_Engine SHALL generate a negotiation opportunity with the current amount, estimated savings, and user tenure as negotiation leverage
3. WHEN a competitor in the same category offers a lower price, THE Intelligence_Engine SHALL surface the comparison as a negotiation opportunity
4. THE Intelligence_Engine SHALL compute total potential monthly and annual savings across all recommendations
5. WHEN a savings recommendation is generated, THE Action_Engine SHALL make a one-click draft available for cancellation, negotiation, or downgrade request
6. THE Intelligence_Engine SHALL rank savings recommendations by annual savings amount in descending order

---

### Requirement 7: Free Trial Expiry Tracking

**User Story:** As a user, I want to be alerted before free trials convert to paid subscriptions, so that I can cancel unwanted trials before being charged.

#### Acceptance Criteria

1. WHEN a trial start or trial end email is detected, THE Intelligence_Engine SHALL create a trial record with start date, end date, conversion amount, and auto-conversion flag
2. WHEN a trial is active, THE Intelligence_Engine SHALL compute the days remaining until expiry
3. WHEN a trial auto-converts to a paid plan exceeding 20 dollars per month, THE Intelligence_Engine SHALL assign an urgency score of 9
4. WHEN a trial expires within 48 hours, THE Intelligence_Engine SHALL assign an urgency score of 10
5. WHEN a trial expiry is detected, THE Action_Engine SHALL schedule countdown reminders at configurable intervals defaulting to 7 days, 3 days, and 1 day before expiry
6. WHEN a cancellation URL is present in the original trial email, THE Intelligence_Engine SHALL store and surface the cancellation URL in the trial record
7. WHEN a user decides not to continue a trial, THE Action_Engine SHALL generate a one-click cancellation draft

---

### Requirement 8: Annual vs Monthly Billing Optimization

**User Story:** As a user, I want to know when switching to annual billing would save me money, so that I can optimize my subscription costs.

#### Acceptance Criteria

1. WHEN a monthly subscription has an annual plan available, THE Intelligence_Engine SHALL calculate the monthly equivalent of the annual plan and the resulting savings
2. THE Intelligence_Engine SHALL compute the break-even point in months for switching from monthly to annual billing
3. WHEN a user has held a monthly subscription for 6 or more months with stable usage, THE Intelligence_Engine SHALL recommend switching to annual billing with high confidence
4. WHEN a user has held a monthly subscription for fewer than 6 months, THE Intelligence_Engine SHALL recommend waiting before committing to annual billing
5. THE Intelligence_Engine SHALL compute the total annual savings if the user switched all eligible subscriptions to annual plans
6. WHEN a vendor email contains an annual plan offer, THE Claude_Classifier SHALL extract the annual plan amount and flag the annual plan as available on the subscription record

---

### Requirement 9: Subscription Creep Detection

**User Story:** As a user, I want to be alerted when my total recurring spend is growing without my awareness, so that I can take corrective action before costs spiral.

#### Acceptance Criteria

1. THE Intelligence_Engine SHALL take monthly snapshots of total recurring spend including subscription count, new additions, cancellations, and price changes
2. WHEN total recurring spend grows by 15 percent or more over a 90-day period, THE Intelligence_Engine SHALL generate a Creep_Alert
3. WHEN 3 or more new subscriptions are added within a 30-day period, THE Intelligence_Engine SHALL generate a Creep_Alert
4. WHEN a Creep_Alert is generated, THE Intelligence_Engine SHALL include a breakdown of which new subscriptions and which price hikes contributed to the increase
5. WHEN a Creep_Alert is generated, THE Intelligence_Engine SHALL produce a natural language insight describing the percentage increase, absolute dollar increase, starting spend, and current spend
6. WHEN a user acknowledges a Creep_Alert, THE Action_Engine SHALL mark the alert as acknowledged and suppress repeated alerts for the same period

---

### Requirement 10: Refund and Credit Tracking

**User Story:** As a user, I want to track whether promised refunds actually arrive, so that I can follow up on missing money.

#### Acceptance Criteria

1. WHEN a refund confirmation email is detected, THE Intelligence_Engine SHALL create a refund record with status set to processing or received
2. WHEN a refund promise email is detected without a specific date, THE Intelligence_Engine SHALL set the expected-by date to 14 days from the promise date
3. WHEN a promised refund has not been confirmed as received within 14 days of the expected date, THE Intelligence_Engine SHALL mark the refund status as overdue
4. WHEN a refund becomes overdue, THE Action_Engine SHALL generate a follow-up draft email to the vendor requesting status
5. WHEN a refund is confirmed as received, THE Entity_Store SHALL update the refund record with the actual received date and mark status as received
6. THE Intelligence_Engine SHALL track the total amount of pending and overdue refunds

---

### Requirement 11: Payment Promise Tracking

**User Story:** As a user, I want to track when someone promises to pay me, so that I can follow up on broken payment promises.

#### Acceptance Criteria

1. WHEN an email contains an explicit payment promise such as "I'll pay by Friday", THE Claude_Classifier SHALL extract the promise with confidence score, promiser, amount, and due date
2. WHEN an email contains an implicit payment indication such as "We're working on it", THE Claude_Classifier SHALL extract the promise with a lower confidence score and flag it as implicit
3. WHEN a payment promise due date passes without a corresponding payment receipt email, THE Intelligence_Engine SHALL mark the commitment status as overdue
4. WHEN a payment promise becomes overdue, THE Action_Engine SHALL generate a polite follow-up draft email
5. THE Intelligence_Engine SHALL rank overdue payment promises by financial amount and days overdue
6. WHEN a payment receipt email is detected that matches a prior payment promise, THE Intelligence_Engine SHALL mark the commitment as fulfilled

---

### Requirement 12: Renewal and Deadline Reminders

**User Story:** As a user, I want to be reminded before subscriptions renew or financial deadlines pass, so that I can take action before money leaves my account.

#### Acceptance Criteria

1. THE Intelligence_Engine SHALL compute upcoming renewal dates for all active subscriptions and surface them with configurable lead-time alerts defaulting to 30, 7, 3, and 1 days before renewal
2. WHEN a subscription has an auto-renewal clause the user did not explicitly opt into, THE Intelligence_Engine SHALL flag the auto-renewal in the renewal alert
3. THE Intelligence_Engine SHALL generate a unified Financial_Calendar containing all upcoming charges, renewals, contract deadlines, trial expiries, and refund expected dates
4. WHEN a renewal or deadline is detected, THE Action_Engine SHALL create a calendar reminder within 5 minutes of detection
5. WHEN configuring lead-time alerts, THE Dashboard SHALL allow the user to set custom lead-time days per vendor

---

### Requirement 13: Spend Pattern Analysis and Insights

**User Story:** As a user, I want to understand how my spending is changing over time, so that I can make informed financial decisions.

#### Acceptance Criteria

1. THE Intelligence_Engine SHALL track monthly spending totals and produce category breakdowns with percentage of total spend per category
2. THE Intelligence_Engine SHALL compute month-over-month and quarter-over-quarter spend comparisons
3. WHEN a spending anomaly is detected such as a sudden increase or new recurring charge, THE Intelligence_Engine SHALL flag the anomaly in the spend analysis
4. THE Intelligence_Engine SHALL generate natural language insights describing spending trends such as "Your SaaS spending increased 23% this quarter"
5. THE Intelligence_Engine SHALL predict future monthly spend based on current trajectory and historical patterns
6. THE Intelligence_Engine SHALL identify the top spending category and its percentage of total recurring spend

---

### Requirement 14: Follow-Up and Financial Commitment Tracking

**User Story:** As a user, I want to track all financial promises made to me and by me, so that no commitment falls through the cracks.

#### Acceptance Criteria

1. THE Intelligence_Engine SHALL track both inbound commitments (promises made to the user) and outbound commitments (promises made by the user)
2. WHEN a financial commitment has no activity for 14 or more days past its due date, THE Intelligence_Engine SHALL mark the commitment status as overdue
3. WHEN a commitment becomes overdue, THE Action_Engine SHALL generate a follow-up draft email
4. THE Intelligence_Engine SHALL rank open commitments by financial value with higher amounts receiving higher priority
5. WHEN a commitment is fulfilled, THE Entity_Store SHALL update the commitment status to fulfilled with the fulfillment date
6. THE Intelligence_Engine SHALL feed relevant commitments into the Refund Tracker and Payment Promise Tracker for specialized handling

---

### Requirement 15: Financial Obligations and Contract Watch

**User Story:** As a user, I want to monitor my contracts and financial obligations, so that I can avoid penalties and unfavorable automatic renewals.

#### Acceptance Criteria

1. WHEN a contract, lease, or service agreement is detected in email or attachments, THE Claude_Classifier SHALL extract contract type, parties, total value, renewal date, auto-renewal status, penalty clauses, and notice window days
2. WHEN a contract contains a silent auto-renewal clause, THE Intelligence_Engine SHALL flag the contract with the auto_renewal risk flag
3. WHEN a contract contains a price escalation clause, THE Intelligence_Engine SHALL flag the contract with the price_escalation risk flag
4. WHEN a contract contains penalty clauses, THE Intelligence_Engine SHALL extract the trigger condition and penalty amount and flag the contract with the penalty_clause risk flag
5. WHEN a notice window deadline has passed without user action, THE Intelligence_Engine SHALL flag the contract with the missed_notice_window risk flag
6. THE Intelligence_Engine SHALL compute the total financial exposure across all active obligations
7. WHEN an obligation deadline is approaching, THE Action_Engine SHALL schedule lead-time alerts based on the notice window days

---

### Requirement 16: Smart Digest Generation and Delivery

**User Story:** As a user, I want a daily or weekly summary of everything financially relevant, so that I can stay informed without checking the dashboard constantly.

#### Acceptance Criteria

1. THE Digest_Composer SHALL generate a daily or weekly digest containing total recurring spend, spend change from last period, and total potential savings
2. THE Digest_Composer SHALL include the top 5 priority items ranked by urgency score and financial impact
3. THE Digest_Composer SHALL include sections for upcoming renewals, expiring trials, overdue refunds, broken payment promises, top savings opportunity, spending trend insight, and subscription creep warning when applicable
4. WHEN a digest item has an available action, THE Digest_Composer SHALL attach a one-click action of type cancel, negotiate, follow-up, set-reminder, review, or acknowledge
5. THE Action_Engine SHALL deliver the daily digest by 7:00 AM in the user's local time zone
6. WHERE the user configures email delivery, THE Action_Engine SHALL deliver the digest via email in addition to the dashboard
7. WHEN a user repeatedly dismisses a specific type of digest item, THE Digest_Composer SHALL reduce the priority of similar items in future digests

---

### Requirement 17: Action Engine Draft Generation

**User Story:** As a user, I want the system to generate ready-to-send email drafts for cancellations, negotiations, and follow-ups, so that I can take action with minimal effort.

#### Acceptance Criteria

1. WHEN a cancellation action is requested, THE Action_Engine SHALL generate a cancellation draft email addressed to the subscription vendor
2. WHEN a negotiation action is requested, THE Action_Engine SHALL generate a negotiation draft email incorporating the negotiation reason, current amount, user tenure, and requested outcome
3. WHEN a refund follow-up action is requested, THE Action_Engine SHALL generate a follow-up draft referencing the original refund promise date and amount
4. WHEN a trial cancellation action is requested, THE Action_Engine SHALL generate a trial cancellation draft including the cancellation URL when available
5. WHEN a payment follow-up action is requested, THE Action_Engine SHALL generate a polite follow-up draft referencing the original payment promise and due date
6. THE Action_Engine SHALL present all generated drafts for user approval before sending

---

### Requirement 18: Priority Ranking and Urgency Scoring

**User Story:** As a user, I want the most important financial items surfaced first, so that I can focus on what matters most.

#### Acceptance Criteria

1. THE Priority_Ranker SHALL assign an urgency score between 0 and 10 to each insight based on financial impact and time sensitivity
2. WHEN a trial expires within 48 hours and auto-converts, THE Priority_Ranker SHALL assign an urgency score of 10
3. WHEN a trial auto-converts to a plan exceeding 20 dollars per month, THE Priority_Ranker SHALL assign an urgency score of 9
4. THE Priority_Ranker SHALL rank all items by urgency score in descending order for the priority feed
5. WHEN two items have equal urgency scores, THE Priority_Ranker SHALL rank the item with higher financial impact first
6. THE Dashboard SHALL display the priority feed as the primary view on the overview tab

---

### Requirement 19: Unified Dashboard

**User Story:** As a user, I want a single dashboard with organized tabs, so that I can access all financial insights from one place.

#### Acceptance Criteria

1. THE Dashboard SHALL provide an Overview tab displaying the priority feed and smart digest
2. THE Dashboard SHALL provide a Subscriptions tab displaying the subscription scanner results, usage scores, active trials, and zombie subscriptions
3. THE Dashboard SHALL provide a Savings tab displaying recommendations, billing optimizations, negotiation opportunities, and total potential savings
4. THE Dashboard SHALL provide a Reminders tab displaying upcoming renewals, expiring trials, and deadline alerts
5. THE Dashboard SHALL provide a Patterns tab displaying spend trends, month-over-month comparisons, creep alerts, and recurring spend timeline
6. THE Dashboard SHALL provide a Commitments tab displaying payment promises, pending refunds, and financial commitment status
7. THE Dashboard SHALL provide an Obligations tab displaying contracts, risk flags, and financial exposure
8. WHEN a user clicks a one-click action on any tab, THE Dashboard SHALL invoke the Action_Engine to execute the requested action
9. WHEN a user dismisses an item, THE Dashboard SHALL remove the item from the active feed and record the dismissal for digest priority adjustment

---

### Requirement 20: Pipeline Performance and Data Privacy

**User Story:** As a user, I want the system to process my emails quickly and keep my data private, so that I get timely insights without compromising my personal information.

#### Acceptance Criteria

1. WHEN processing a batch of 100 new messages, THE Intelligence_Engine SHALL complete the full pipeline run in fewer than 30 seconds
2. THE Claude_Classifier SHALL achieve subscription detection precision greater than 95 percent and recall greater than 90 percent
3. THE Entity_Store SHALL store all data locally using SQLite in development or in the user's own PostgreSQL database in production with no third-party data sharing
4. WHEN a renewal or deadline is detected, THE Action_Engine SHALL create the corresponding calendar reminder within 5 minutes of detection
5. THE Usage_Signal_Collector SHALL update usage scores on every pipeline run to reflect the latest engagement signals
