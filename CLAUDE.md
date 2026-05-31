# Core Banking MVP - Project Rules
# These rules are NON-NEGOTIABLE. Every file, every function, every line.

## Money Safety

- NEVER use JavaScript `number` type for monetary values. Ever.
- ALWAYS use `Decimal` from `decimal.js` for all monetary arithmetic.
- Use `sql.js` (SQLite via WASM) for persistence - no native compilation needed.
- No floats, no doubles, no `Number()` on money. If you see `number` near a balance, it is a bug.
- All monetary comparisons use Decimal methods (`.eq()`, `.gt()`, `.lt()`), never `===` or `>`.

## Event Sourcing

- Events are IMMUTABLE. Once written to the event store, they never change. No updates. No deletes.
- State is ALWAYS derived from events. Never store a computed balance. Never cache a running total as truth.
- The event log IS the source of truth. Everything else is a projection.
- If you need current state, replay the events. If that is too slow, build a projection - but the projection is disposable. The log is not.

## Naming Conventions

- Events are past tense: `AccountCreated`, `MoneyDeposited`, `TransferCompleted`, `TransferFailed`
- Commands are imperative: `CreateAccount`, `DepositMoney`, `InitiateTransfer`
- Aggregates are nouns: `Account`, `Ledger`, `Transaction`
- Value objects are descriptive: `Money`, `AccountId`, `Currency`

## Architecture

- Double-entry accounting: every debit has an equal and opposite credit. The books must always balance.
- Overdraft policy is a pluggable interface. Never hardcode overdraft logic into the engine.
- Settlement is an adapter pattern. Mock in MVP. The interface is the product.
- Compliance is event-driven. Consumers subscribe to events. Core never knows compliance exists.

## Testing

- Every layer ships with tests. A layer is not done until tests pass.
- Test the invariants: books balance, no partial states, idempotency holds, events are append-only.
- Edge cases are not optional. Zero amounts, negative attempts, same-account transfers, concurrent operations.

## Code Style

- TypeScript strict mode. No `any`. No `as` casts unless absolutely unavoidable and commented.
- Validate all external input at the boundary with Zod schemas. Reject bad data early.
- Functions are small. Files are focused. One concept per module.
- Error handling is explicit. No swallowed errors. No silent failures.

## Build Approach

- Build one layer at a time. Layer N must have passing tests and a clean commit before Layer N+1 starts.
- Commit between every layer with a descriptive message.
- Document every design decision in DECISIONS.md the moment it is made.
- Ideas outside current layer scope go to PARKING_LOT.md, not into the code.
