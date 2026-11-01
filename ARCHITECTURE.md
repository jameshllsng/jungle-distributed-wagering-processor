# Architecture

## Scope and boundary

This service processes wagering operations delivered by HTTP or SQS. Both adapters invoke the same application use case. Authentication is deliberately out of scope: a future `ProviderIdentityPort`/Nest guard is the extension point; health endpoints remain public as required by the challenge.

## Financial representation

The domain uses the immutable `Money` value object backed by `decimal.js`. Public contracts use `{ amount: string, currency: string }`, always at two decimal places. PostgreSQL stores amounts as `numeric(20,2)`. JavaScript `number` is never used to represent money.

## Persistence and transactions

MikroORM is currently used for migration configuration and execution. The runtime persistence path uses the PostgreSQL `pg` driver with explicit SQL transactions because the financial hot path requires `SELECT ... FOR UPDATE`, conditional balance updates and a shared transaction spanning Inbox, wallet, ledger and Outbox. This is an explicit trade-off and a remaining compliance risk against the challenge preference for MikroORM/TypeORM; it must not be read as MikroORM being the runtime persistence boundary.

The transaction use case will execute, in one PostgreSQL transaction:

1. persist/check the inbox record when the source is SQS;
2. obtain the wallet row lock (`SELECT ... FOR UPDATE` through MikroORM);
3. persist the wager transaction, wallet change, and immutable ledger entry;
4. persist integration events in the outbox;
5. commit before SQS acknowledgement or publication.

The database schema enforces a unique wallet per `(player_id, currency)`, a unique idempotency key, a unique `(provider_id, external_transaction_id)`, non-negative wallet balances, one ledger row per financial transaction, and the arithmetic of every ledger entry. A trigger rejects update and delete operations on the ledger.

## Concurrency

The contention unit is `wallet_id`. A transaction locks only the affected wallet, not a global lock. The lock serializes same-wallet balance mutations across any number of app instances while different wallets remain parallel. A conditional/locked balance update plus schema checks prevents lost updates and negative balances.

## Idempotency and delivery

The idempotency key and canonical business-payload SHA-256 will be persisted with the transaction. A matching replay returns the saved original result; the same key with a different payload hash is a conflict. SQS deduplication is only an optimization. The durable inbox key is `(consumer_name, message_id)` and the message is acknowledged only after the SQL commit.

## Outbox and recovery

Outbox rows are inserted within the financial transaction. Publishers claim due rows with `FOR UPDATE SKIP LOCKED`, which permits several publisher instances without a global mutex. A crash after commit and before publish leaves a durable pending row for another publisher. Consumers are idempotent, so duplicate publication is safe.

## Pending references

`REFUND` and `ROLLBACK` without their reference are stored as `PENDING_REFERENCE`. A scheduled worker will retry them with bounded exponential backoff; an exhausted retry budget becomes an explicit terminal rejection and produces an outbox event.

## Observability

Structured logs will contain correlation, message, transaction, wallet, and provider identifiers, but never full financial payloads. Metrics will cover transaction statuses, duplicate detection, retries, DLQ activity, lock conflicts, outbox lag, and processing latency. Liveness checks process health; readiness checks PostgreSQL and SQS.
