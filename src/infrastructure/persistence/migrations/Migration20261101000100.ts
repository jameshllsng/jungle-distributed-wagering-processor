import { Migration } from '@mikro-orm/migrations';

/** Allows the optional BET reference accepted for WIN without rewriting applied history. */
export class Migration20261101000100 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table wager_transactions drop constraint if exists wager_transactions_check;
      alter table wager_transactions add constraint wager_transactions_reference_kind_check check (
        (kind in ('REFUND', 'ROLLBACK') and reference_external_transaction_id is not null)
        or (kind = 'WIN')
        or (kind in ('OPENING', 'BET', 'LOSS') and reference_external_transaction_id is null)
      );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      alter table wager_transactions drop constraint if exists wager_transactions_reference_kind_check;
      alter table wager_transactions add constraint wager_transactions_check check (
        (kind in ('REFUND', 'ROLLBACK')) = (reference_external_transaction_id is not null)
      );
    `);
  }
}
