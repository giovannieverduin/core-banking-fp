# Core Banking - First Principles

A core banking system built from first principles on a flight from Dubai to Paris.

Takeoff was delayed by an hour. I used the time for prep work - first-principles design specs, a focus group of assumptions to challenge, and mapping out the repo. Once we were finally airborne, all seven layers shipped through Claude Code.

From event-sourced to double-entry. Never any inherited assumptions.

## Architecture

The system is built in 7 layers, each independently valuable. All seven shipped:

| Layer | Component | What it does | Status |
|-------|-----------|-------------|--------|
| L1 | Event Store + Domain Model | Money value object, account aggregate, append-only event log | shipped |
| L2 | Ledger Engine | Double-entry accounting, balance projections, overdraft policies | shipped |
| L3 | Transaction Engine | Atomic transfers, saga pattern, compensating transactions, idempotency | shipped |
| L4 | Reconciliation Engine | Continuous verification, SHA-256 hash chain tamper detection | shipped |
| L5 | API Layer + Tests | Fastify routes with Zod validation, per-account API keys | shipped |
| L6 | Settlement Bridge | Pluggable adapter - mock; interface designed for EVM, SWIFT, SEPA | shipped |
| L7 | Dashboard | Live SSE event stream, balances, trial balance, integrity status | shipped |

106 tests passing across 13 files. Strict TypeScript clean throughout.

## Core Principles

- **Events are truth.** State is always derived, never stored.
- **No floats near money.** Decimal.js for all monetary arithmetic.
- **Double-entry enforced.** Every debit has a credit. The books always balance.
- **Settlement is an adapter.** Swap mock for on-chain without touching core logic.
- **Compliance is a subscriber.** Event-driven. Core never knows compliance exists.

## Stack

- TypeScript (strict mode)
- SQLite (local) - Postgres (production)
- Fastify + Zod (API layer)
- Decimal.js (monetary arithmetic)
- Vitest (testing)

## Quick Start

```bash
npm install
npm test
npm run dev
```

## Files

- `DECISIONS.md` - Architectural decision log
- `PARKING_LOT.md` - Deferred ideas and post-flight features
- `.cursorrules` - AI coding assistant constraints

## Author

Giovanni Everduin - built with Claude and Emirates in-flight WiFi at 35,000 feet aboard EK073.
