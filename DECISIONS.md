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
