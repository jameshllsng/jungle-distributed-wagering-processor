import { Migration } from '@mikro-orm/migrations';

export class Migration20261031000100 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table wallets (
        id uuid primary key,
        player_id uuid not null,
        currency varchar(3) not null check (currency ~ '^[A-Z]{3}$'),
        balance numeric(20,2) not null check (balance >= 0),
        version integer not null check (version >= 1),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (player_id, currency)
      );

      create table wager_transactions (
        id uuid primary key,
        provider_id text not null,
        external_transaction_id text not null,
        idempotency_key text not null unique,
        payload_hash char(64) not null,
        wallet_id uuid not null references wallets(id),
        player_id uuid not null,
        round_id text not null,
        game_id text not null,
        kind varchar(8) not null check (kind in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')),
        amount numeric(20,2) not null check (amount >= 0),
        currency varchar(3) not null check (currency ~ '^[A-Z]{3}$'),
        reference_external_transaction_id text null,
        reference_transaction_id uuid null references wager_transactions(id),
        status varchar(20) not null check (status in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')),
        failure_code text null,
        result_balance numeric(20,2) null check (result_balance is null or result_balance >= 0),
        result_currency varchar(3) null check (result_currency is null or result_currency ~ '^[A-Z]{3}$'),
        processed_at timestamptz null,
        retry_attempts integer not null default 0 check (retry_attempts >= 0),
        next_retry_at timestamptz null,
        created_at timestamptz not null default now(),
        unique (provider_id, external_transaction_id),
        check ((kind in ('REFUND', 'ROLLBACK')) = (reference_external_transaction_id is not null)),
        check ((result_balance is null) = (result_currency is null))
      );
      create index wager_transactions_pending_reference_idx on wager_transactions (status, next_retry_at) where status = 'PENDING_REFERENCE';
      create index wager_transactions_wallet_created_idx on wager_transactions (wallet_id, created_at, id);

      create table wallet_ledger_entries (
        id uuid primary key,
        wallet_id uuid not null references wallets(id),
        transaction_id uuid not null unique references wager_transactions(id),
        direction varchar(6) not null check (direction in ('DEBIT', 'CREDIT')),
        amount numeric(20,2) not null check (amount > 0),
        currency varchar(3) not null check (currency ~ '^[A-Z]{3}$'),
        balance_before numeric(20,2) not null check (balance_before >= 0),
        balance_after numeric(20,2) not null check (balance_after >= 0),
        created_at timestamptz not null default now(),
        check (
          (direction = 'DEBIT' and balance_before - amount = balance_after)
          or (direction = 'CREDIT' and balance_before + amount = balance_after)
        )
      );
      create index wallet_ledger_entries_wallet_cursor_idx on wallet_ledger_entries (wallet_id, created_at desc, id desc);

      create or replace function reject_wallet_ledger_mutation() returns trigger language plpgsql as $$
      begin raise exception 'wallet ledger entries are immutable'; end;
      $$;
      create trigger wallet_ledger_entries_immutable
      before update or delete on wallet_ledger_entries
      for each row execute function reject_wallet_ledger_mutation();

      create table inbox_messages (
        consumer_name text not null,
        message_id text not null,
        payload_hash char(64) not null,
        received_at timestamptz not null default now(),
        processed_at timestamptz null,
        primary key (consumer_name, message_id)
      );

      create table outbox_messages (
        id uuid primary key,
        aggregate_id uuid not null,
        event_type text not null,
        payload jsonb not null,
        occurred_at timestamptz not null,
        attempts integer not null default 0 check (attempts >= 0),
        next_attempt_at timestamptz null,
        published_at timestamptz null,
        created_at timestamptz not null default now()
      );
      create index outbox_messages_pending_idx on outbox_messages (next_attempt_at, occurred_at) where published_at is null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      drop table if exists outbox_messages;
      drop table if exists inbox_messages;
      drop table if exists wallet_ledger_entries;
      drop function if exists reject_wallet_ledger_mutation();
      drop table if exists wager_transactions;
      drop table if exists wallets;
    `);
  }
}
