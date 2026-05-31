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
