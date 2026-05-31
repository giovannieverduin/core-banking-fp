# Decision Log - Core Banking MVP

> Every architectural choice documented the moment it is made.
> Future-you needs the rationale, not just the outcome.

---

## DECISION 01 - Account Identity Model

**Options:** UUID only / IBAN-format / Custom account number scheme
**Decision:** UUID internally, IBAN-format display string
**Rationale:** Decouples identity from format. Internal operations use UUID for speed and simplicity. Display layer formats as IBAN for human readability. Changing the display format later never touches the engine.

---

## DECISION 02 - Multi-Currency Handling

**Options:** Single currency MVP / Currency-aware from day one
**Decision:** Currency-aware from day one
**Rationale:** The data model cost is low - a currency field on Money value objects and accounts. Retrofitting multi-currency into a single-currency system is expensive and error-prone. Build it right once.

---

## DECISION 03 - Overdraft Policy

**Options:** Hard reject / Configurable limit per account type
**Decision:** Pluggable policy object. Default is hard reject.
**Rationale:** Overdraft logic does not belong in the engine. It is a business rule that varies by account type, customer tier, and jurisdiction. Define an OverdraftPolicy interface, ship HardRejectPolicy as default. Credit accounts come later without touching core.

---

## DECISION 04 - On-Chain Settlement Layer

**Options:** EVM (Ethereum/Base) / Solana / Mock-only for MVP
**Decision:** Mock adapter in MVP. Interface designed for EVM.
**Rationale:** Settlement is an adapter, not a core concern. The mock simulates T+0, T+1, T+2 settlement cycles. The adapter interface is designed to slot in EVM (or Solana) post-flight without touching any core logic. The interface is the product.

---

## DECISION 05 - CBDC Asset Type

**Options:** Treat as currency / Treat as asset class
**Decision:** Asset class with currency-like behavior
**Rationale:** Future-proofs for multi-CBDC environments (digital dirham, digital euro, etc.). CBDCs have currency properties but also asset-class characteristics (issuance rules, programmability constraints). Modeling as asset class with currency behavior covers both.

---

## DECISION 06 - Compliance Hooks

**Options:** Baked in / Event-driven side effects
**Decision:** Event-driven. Compliance consumers subscribe to the event stream.
**Rationale:** Core never knows compliance exists. AML checks, transaction monitoring, regulatory reporting - all subscribe to events and act independently. This means compliance rules can change, be added, or be removed without a single line of core engine code changing. Clean separation.

---

## DECISION 07 - API Auth Model

**Options:** API keys / JWT / None for MVP
**Decision:** API key per account in MVP. JWT-ready interface.
**Rationale:** Auth is a layer, not a core concern. API keys are simple, sufficient for MVP testing, and easy to validate. The auth middleware interface is designed so JWT can be swapped in without touching route handlers.

---

## In-Flight Additions

> Add new decisions below as they arise during the build. Format: number, options considered, decision, rationale.

---

## DECISION 08 - SQLite Driver

**Options:** `better-sqlite3` (native) / `sql.js` (WASM) / Postgres-only
**Decision:** `sql.js` (WASM) for the MVP event-store implementation.
**Rationale:** No native compilation, no platform-specific binaries, works identically on every node version we hit. CLAUDE.md already pins this. Throughput is irrelevant at MVP scale - correctness is what we are buying. The `EventStore` interface hides the driver so Postgres can slot in later without touching the domain.

---

## DECISION 09 - Event Versioning Scheme

**Options:** Global monotonic only / Per-aggregate version + global sequence / Timestamp ordering
**Decision:** Per-aggregate version (1..n, contiguous) plus a separate `global_seq` for cross-aggregate ordering.
**Rationale:** Per-aggregate version is what optimistic concurrency control needs - the append API takes an `expectedVersion` and rejects on mismatch. `global_seq` gives a stable read-all order for projections and downstream subscribers without coupling to wall-clock timestamps, which can skew or repeat. Timestamps are recorded but never used for ordering.

---

## DECISION 10 - AccountId Representation

**Options:** Plain string / Branded string (compile-time only) / Class wrapper
**Decision:** Branded `string` type (`AccountId = string & { brand }`), constructed via `newAccountId()` (UUID v4) or parsed via Zod schema at boundaries.
**Rationale:** Branding gives type safety with zero runtime cost - the engine cannot accidentally pass a raw user string where an `AccountId` is expected. A class wrapper would force `.value` accesses everywhere and complicate JSON serialization for the event log. The IBAN display format (Decision 01) lives in a separate formatting layer.

---

## DECISION 11 - Money Arithmetic Strictness

**Options:** Silent currency coercion / Throw on mixed currency / Result-type union
**Decision:** Throw `CurrencyMismatchError` on any mixed-currency operation, including comparisons.
**Rationale:** Silent coercion is how exchange-rate bugs become production incidents. A throw is loud, traceable, and forces the caller to introduce an explicit FX step. Result types would be cleaner functionally but add ceremony that does not pay off until we have a real FX module. Default precision is 38 digits with banker's rounding (`ROUND_HALF_EVEN`).

---

## DECISION 12 - Event Payload Storage Format

**Options:** Typed columns per event type / JSON blob / Protobuf
**Decision:** JSON blob in a single `payload` column, with `event_type` denormalized for indexed lookups.
**Rationale:** Event schemas evolve. Typed columns force a migration every time a new event field appears, and protobuf adds a build step we do not need at MVP. JSON keeps the schema fluid while `event_type` plus `(aggregate_id, version)` indexes give us all the read paths we need. Amounts are stored as their `Decimal.toFixed()` string form - never as floats - so round-tripping through JSON preserves precision exactly.

---

## DECISION 13 - Projection Purity

**Options:** Projections hold mutable state / Projections are pure functions over event streams
**Decision:** Pure functions: `replayAccount(events)` returns an immutable `AccountState`; `balanceOf(store, id)` reads the stream and replays.
**Rationale:** A projection that caches state becomes a second source of truth, which violates the layer's core invariant. Pure replay is trivially testable, trivially correct, and the obvious place to introduce a snapshot cache later if performance demands it - but the cache will be derivable from the log, not authoritative.

---

## DECISION 14 - Optimistic Concurrency on Append

**Options:** Last-write-wins / Optimistic with `expectedVersion` / Pessimistic locking
**Decision:** Optimistic: the caller passes `expectedVersion`; the store throws `ConcurrencyError` if the aggregate has moved on.
**Rationale:** Append-only logs cannot tolerate last-write-wins - it would let two concurrent writers both apply a withdrawal against the same balance. Pessimistic locking is overkill for sql.js (single-process) and would not generalize cleanly to Postgres. Optimistic concurrency forces the caller to re-read and retry, which is exactly the contract the domain wants.

---

## DECISION 15 - Posting Rules as a Pure Projection

**Options:** Events carry debit/credit pairs / Events are business-level, posting rules derive entries
**Decision:** Events stay business-level (`MoneyDeposited`, `TransferInitiated`, etc.). A separate, pure `eventToJournal` function applies posting rules to derive a balanced journal of ledger entries.
**Rationale:** Business events describe *intent*, not bookkeeping mechanics. Coupling Dr/Cr pairs into the event payload would leak accounting concerns into the domain - and every new account type (loan, credit, escrow) would need a new event shape. Keeping posting rules as a pure projection means we can evolve the chart of accounts without touching the log, and the rules themselves are trivially testable in isolation. The function asserts the journal is balanced before returning - if a rule ever produced a lopsided journal, it would throw immediately rather than silently corrupting the books.

---

## DECISION 16 - System Accounts for Double-Entry Counterparties

**Options:** Single-sided customer entries / Synthetic system accounts (cash-in, cash-out, suspense) / Real GL accounts created via events
**Decision:** Synthetic, per-currency system accounts (`cash-in:USD`, `cash-out:USD`, `suspense:USD`) referenced by tagged-union `LedgerAccountRef`. They have no `AccountCreated` event.
**Rationale:** Double-entry needs a counterparty for every customer-side entry. Modelling them as real customer accounts would require special-case event flows and pollute the customer aggregate. Modelling them as bookkeeping-only entities via the ledger projection keeps the customer aggregate clean and makes the chart of accounts trivially extensible (e.g. add a `fee-revenue:USD` system account later by editing one file). Per-currency split is mandatory because cross-currency `Money` arithmetic throws - mixing them in one bucket would be a bug.

---

## DECISION 17 - Normal-Side Balance Convention

**Options:** Always `debit - credit` signed / Per-account normal side / Treat all balances as positive Money with separate sign field
**Decision:** Each ledger account has a `NormalSide` (debit for assets like cash-in, credit for liabilities like customer accounts). Balance is computed as `(normal-side total) - (opposite-side total)`.
**Rationale:** This is how real accounting systems work. A customer's account is a liability from the bank's perspective, so credits increase the balance and debits decrease it. Hard-coding `debit - credit` everywhere would make customer balances negative-of-intuitive and break overdraft logic. The per-account normal side is two lines of config per account type and makes future account kinds (assets, equity, revenue, expense) drop in cleanly.

---

## DECISION 18 - Trial Balance Per Currency

**Options:** Single global trial balance / Per-currency trial balance / Convert to a base currency
**Decision:** Per-currency trial balance. Books must balance independently in each currency.
**Rationale:** Cross-currency netting is an FX operation that requires a rate and produces a P&L entry. Until we have an FX module, mixing currencies in the trial balance would either require silent conversion (banned by the money-safety rules) or accept a "balanced" book that is in fact off by an unrecognised FX exposure. Per-currency is the only safe default - the FX module will later add a currency-translation journal whose own entries also balance per-currency.

---

## DECISION 19 - Overdraft as an Authorize Decision

**Options:** Boolean predicate / Throw inside policy / Return discriminated decision
**Decision:** `OverdraftPolicy.authorize(account, amount)` returns `{ ok: true } | { ok: false; reason }`. Commands map a non-ok decision to `CommandError`.
**Rationale:** A boolean loses the rejection reason, which the API layer needs to render error responses and compliance needs for audit. Throwing inside the policy couples control flow to exceptions and makes composition (policy A and policy B) awkward. A discriminated result is composable, type-safe, and gives the caller full context. `HardRejectPolicy` is the default to preserve Layer-1 behavior; alternative policies are opt-in via the command input.

---

## DECISION 20 - Ledger Projection is Disposable

**Options:** Persist the ledger as authoritative state / Project from events on demand / Snapshot the projection periodically
**Decision:** Project from events on demand. No persisted ledger state in MVP.
**Rationale:** The event log is the source of truth (Decision from CLAUDE.md). The ledger is a view. Persisting it would create a second source of truth that can drift, and the only safe way to recover from drift would be to rebuild from the log anyway. Snapshots are a performance optimisation, not a correctness mechanism - they go in the parking lot until measurement proves they are needed.

---

## DECISION 21 - Two-Sided Transfer Events

**Options:** All transfer events on the source aggregate / Mirror events on both aggregates / Single global "Transfer" aggregate
**Decision:** Source emits `TransferInitiated` + `TransferCompleted`. Destination emits its own `TransferReceived`. Failures use `TransferRejected` (pre-debit) or `TransferFailed` (post-debit compensation).
**Rationale:** With single-sided events, the destination's per-aggregate `replayAccount` could not see incoming money - its balance would silently lag the ledger, breaking the invariant that the event log fully describes an aggregate's state. The fix is symmetry: each aggregate's stream is authoritative for that aggregate. The cross-aggregate atomicity is the EventStore's responsibility, not the aggregate's. This also makes per-aggregate snapshots and reconciliation easy later - no projection needs to read another aggregate's stream to know its balance.

---

## DECISION 22 - Atomic Multi-Aggregate Write vs Async Saga

**Options:** Asynchronous saga with compensating events / Synchronous atomic multi-aggregate append / Two-phase commit
**Decision:** Synchronous atomic append across both aggregates in one EventStore transaction.
**Rationale:** sql.js runs in-process and supports a single BEGIN/COMMIT spanning any number of inserts, so we get true atomicity for free. An async saga would invent a problem we do not have - in-flight states, timeout handling, compensation orchestration - all to solve a distributed-systems problem that does not exist yet. The interface still records `TransferInitiated` and `TransferCompleted` as separate events, so a future Postgres+queue implementation can split the commit and resurrect the saga without changing the event shapes or consumer code. `TransferFailed` stays in the model as the compensation event for that future world.

---

## DECISION 23 - Idempotency via Stream Scan

**Options:** Separate idempotency-key table / Scan source stream for prior `transferId` / Hash-based dedup at API boundary
**Decision:** Scan the source aggregate's event stream for any event with the same `transferId`. If a terminal event (`Completed`, `Rejected`, `Failed`) is present, return its outcome marked `idempotent: true` without writing.
**Rationale:** The event log is already the source of truth - a separate dedup table would be a second source that can drift. The scan is O(n) per call which is fine at MVP scale, and the same query gives us the saga-state info we need (no special "claimed" state to manage). Future optimisation: a `transferId` index column on the events table, or a projection of `transferId → outcome`. The interface is unchanged either way.

---

## DECISION 24 - TransferRejected vs TransferFailed

**Options:** Single failure event with a `phase` discriminator / Two distinct events for pre-debit vs post-debit failure
**Decision:** `TransferRejected` for pre-debit failures (validation, overdraft); `TransferFailed` for post-debit compensation.
**Rationale:** The two cases have different balance semantics and the type system should reflect that. `TransferRejected` produces no ledger entries - the transfer never moved money and the rejection is purely an audit/idempotency marker. `TransferFailed` produces a compensating journal that credits the source back and debits suspense - it means a transfer did move money and is now being reversed. Collapsing them under one event with a `phase` field would force every consumer to branch on that field and risk applying the wrong posting rule. Distinct types make the posting rules exhaustive and let TypeScript's switch-narrowing catch missed cases.

---

## DECISION 25 - Candidate-Order Preserving Append

**Options:** Group candidates by aggregate before insert / Preserve the candidate array's order across aggregates
**Decision:** Preserve the candidate array's order across aggregates. Per-aggregate version cursor tracks in-batch increments.
**Rationale:** The transfer saga writes `[Initiated(source), Received(destination), Completed(source)]`. The grouping approach would insert in `[Initiated, Completed, Received]` order in the global sequence, which is wrong for downstream subscribers that expect `Received` to precede `Completed`. Preserving array order makes the API contract obvious: the caller controls the global sequence by ordering their candidates correctly. Per-aggregate version monotonicity is still enforced via the cursor.
