# Core Banking - First Principles

A core banking system built from first principles on a 7-hour flight from Dubai to Paris.

Event-sourced. Double-entry. No sacred cows.

## Architecture

The system is built in 7 layers, each independently valuable:

| Layer | Component | What it does |
|-------|-----------|-------------|
| L1 | Event Store + Domain Model | Money value object, account aggregate, append-only event log |
| L2 | Ledger Engine | Double-entry accounting, balance projections, overdraft policies |
| L3 | Transaction Engine | Atomic transfers, saga pattern, compensating transactions, idempotency |
| L4 | Reconciliation Engine | Continuous verification, hash chain tamper detection |
| L5 | API Layer + Tests | REST endpoints with Zod validation, full test suite |
| L6 | Settlement Bridge | Pluggable adapter - mock, on-chain (EVM/Solana), SWIFT/SEPA |
| L7 | Dashboard | Live event stream, balances, transaction graph, reconciliation status |

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

Giovanni Everduin - built at 35,000 feet.
