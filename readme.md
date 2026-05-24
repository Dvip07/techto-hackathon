# Inbox Intelligence Platform

An Enterprise Communication Intelligence Layer — Gmail-native, modular, built to scale from personal inbox to enterprise org.

## What It Does

Inbox Intelligence transforms unstructured email communication into structured, actionable intelligence. One ingestion pipeline powers six specialized analysis modules on top of a shared parsing and entity extraction core.

## Core Modules

| Module | Purpose |
|--------|---------|
| **Financial Scanner** | Surfaces forgotten subscriptions, price increases, and recurring waste |
| **Relationship Signal** | Detects relationship decay, generates pre-meeting briefings and warm-up drafts |
| **Legal & Contract Watch** | Tracks obligations, deadlines, renewal windows, and flags risky clauses |
| **Follow-Up Tracker** | Identifies open commitments (inbound + outbound) and surfaces stale threads |
| **Institutional Memory** | Queryable knowledge base with decision trail reconstruction (RAG-based) |
| **Life & Health Admin** | Tracks health follow-ups, insurance claims, and appointment scheduling |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  DATA SOURCES: Gmail · Calendar · Drive · Documents     │
├─────────────────────────────────────────────────────────┤
│  INGESTION: Gmail MCP · Batch Fetcher · Attachment Parser│
├─────────────────────────────────────────────────────────┤
│  PARSING CORE: Claude Classifier · Entity Extractor     │
│                Temporal Indexer · Dedup Engine           │
├─────────────────────────────────────────────────────────┤
│  ENTITY STORE: Messages · Entity Graph · Commitments    │
├─────────────────────────────────────────────────────────┤
│  MODULES: Financial · Relationship · Legal · Follow-Up  │
│           Institutional Memory · Health Admin            │
├─────────────────────────────────────────────────────────┤
│  ACTION ENGINE: Priority Surface · Draft Generator      │
│                 Calendar MCP · Alert Dispatcher          │
└─────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Data Ingestion | Gmail MCP + Google Calendar MCP |
| Message Parsing | Claude Sonnet (classifier + entity extractor) |
| Entity Store | SQLite (dev) / PostgreSQL (prod) |
| Embedding Store | pgvector / Chroma (Institutional Memory) |
| Action Engine | Calendar MCP + Claude draft generator |
| Frontend | React + Tailwind |
| Testing | fast-check (property-based testing) |

## Getting Started

### Prerequisites

- Node.js 18+
- Gmail API credentials (OAuth2)
- Anthropic API key (Claude access)

### Setup

```bash
# Install dependencies
npm install

# Copy the env template and fill in your keys
cp .env.example .env.local
```

### Configure `.env.local`

Open `.env.local` and fill in:

| Variable | Where to get it |
|----------|----------------|
| `GOOGLE_CLIENT_ID` | [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) — Create OAuth 2.0 Client ID (Web app) |
| `GOOGLE_CLIENT_SECRET` | Same place as above |
| `ANTHROPIC_API_KEY` | [Anthropic Console](https://console.anthropic.com/settings/keys) |

**Google Cloud setup:**
1. Create a project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) and [Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)
3. Create OAuth 2.0 credentials (Web application)
4. Add `http://localhost:3001/auth/google/callback` as an authorized redirect URI

### Run

```bash
# Start both backend + frontend together
npm start

# Or run them separately:
npm run server   # Backend API on http://localhost:3001
npm run dev      # Frontend on http://localhost:5173
```

### Connect Gmail

1. Open `http://localhost:5173` in your browser
2. You'll see the "Connect Your Gmail" screen
3. Click "Connect with Google" and authorize
4. Done — the system will start scanning your inbox

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Run backend + frontend together |
| `npm run server` | Backend API only (port 3001) |
| `npm run dev` | Frontend dev server only (port 5173) |
| `npm test` | Run all tests |
| `npm run lint` | TypeScript type check |

## Key Design Decisions

1. **Single ingestion, multiple consumers** — One parsing pipeline feeds all six modules. No redundant API calls.
2. **Claude as the classification spine** — A single prompt chain handles classification, entity extraction, and commitment detection simultaneously.
3. **Modular prompt chains** — Each module is an independent Claude prompt chain that can be enabled, disabled, or upgraded independently.
4. **Persistent entity store** — The entity graph accumulates over time, creating a compounding intelligence moat.

## Roadmap

- [x] **Hackathon (48h)**: Gmail ingestion, Claude classifier, SQLite store, Financial Scanner, Follow-Up Tracker, React dashboard
- [ ] **Beta (Month 1–3)**: Relationship Signal, Legal Watch, Outlook connector, auth, mobile dashboard
- [ ] **V1 Enterprise (Month 4–8)**: Institutional Memory (RAG), Health Admin, team mode, SOC 2 Type I
- [ ] **Scale (Month 9–12)**: Enterprise SSO, API access, CRM sync, SOC 2 Type II + GDPR

## Pricing

| Tier | Target | Price |
|------|--------|-------|
| Personal | Individual users | $19/month |
| Team | 5–50 users | $49/seat/month |
| Business | 50–500 users | $99/seat/month |
| Enterprise | 500+ users | Custom contract |

## License

Confidential — Hackathon Edition, May 2026
