import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../infrastructure/persistence/database.service';

export type MoneyDto = { amount: string; currency: string };
export type WagerRequest = { providerId: string; externalTransactionId: string; playerId: string; walletId: string; roundId: string; gameId: string; kind: 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK'; money: MoneyDto; referenceExternalTransactionId?: string };

type WalletRow = { id: string; player_id: string; currency: string; balance: string; version: number };
type TransactionRow = { id: string; payload_hash: string; status: string; result_balance: string | null; result_currency: string | null; failure_code: string | null };

@Injectable()
export class WageringService {
  constructor(private readonly database: DatabaseService) {}

  static canonicalHash(payload: object): string {
    const canonicalize = (value: unknown): unknown => Array.isArray(value) ? value.map(canonicalize)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)])) : value;
    return createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
  }

  async createWallet(playerId: string, initialBalance: MoneyDto): Promise<object> {
    return this.database.transaction(async (client) => {
      const id = randomUUID();
      try {
        await client.query('insert into wallets (id, player_id, currency, balance, version) values ($1,$2,$3,$4,1)', [id, playerId, initialBalance.currency, initialBalance.amount]);
      } catch (error: unknown) {
        if ((error as { code?: string }).code === '23505') throw new ConflictException('Wallet already exists for player and currency');
        throw error;
      }
      if (initialBalance.amount !== '0.00') {
        const transactionId = randomUUID();
        await client.query(`insert into wager_transactions (id,provider_id,external_transaction_id,idempotency_key,payload_hash,wallet_id,player_id,round_id,game_id,kind,amount,currency,status,processed_at,result_balance,result_currency)
          values ($1,'internal',$2,$2,$3,$4,$5,'opening','opening','OPENING',$6,$7,'PROCESSED',now(),$6,$7)`, [transactionId, `opening:${id}`, WageringService.canonicalHash({ id, initialBalance }), id, playerId, initialBalance.amount, initialBalance.currency]);
        await client.query('insert into wallet_ledger_entries (id,wallet_id,transaction_id,direction,amount,currency,balance_before,balance_after) values ($1,$2,$3,$4,$5,$6,0,$5)', [randomUUID(), id, transactionId, 'CREDIT', initialBalance.amount, initialBalance.currency]);
        await this.outbox(client, transactionId, 'WagerTransactionProcessed', { transactionId, status: 'PROCESSED' });
        await this.outbox(client, transactionId, 'WalletBalanceChanged', { walletId: id, transactionId, direction: 'CREDIT', money: initialBalance, balanceBefore: { amount: '0.00', currency: initialBalance.currency }, balanceAfter: initialBalance, walletVersion: 1 });
      }
      return { id, playerId, balance: initialBalance, version: 1 };
    });
  }

  async getWallet(id: string): Promise<object> {
    const result = await this.database.pool.query<WalletRow>('select id, player_id, currency, balance::text, version from wallets where id=$1', [id]);
    const wallet = result.rows[0];
    if (!wallet) throw new NotFoundException('Wallet not found');
    return { id: wallet.id, playerId: wallet.player_id, balance: { amount: wallet.balance, currency: wallet.currency }, version: wallet.version };
  }

  async getLedger(walletId: string, cursor?: string, limit = 50): Promise<object> {
    const take = Math.min(Math.max(limit, 1), 100);
    const decoded = cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { createdAt: string; id: string } : undefined;
    const result = await this.database.pool.query<{ id: string; transaction_id: string; direction: string; amount: string; currency: string; balance_before: string; balance_after: string; created_at: Date }>(`select id,transaction_id,direction,amount::text,currency,balance_before::text,balance_after::text,created_at from wallet_ledger_entries where wallet_id=$1 ${decoded ? 'and (created_at,id) < ($2::timestamptz,$3::uuid)' : ''} order by created_at desc,id desc limit $${decoded ? 4 : 2}`, decoded ? [walletId, decoded.createdAt, decoded.id, take + 1] : [walletId, take + 1]);
    const entries = result.rows.slice(0, take).map((row) => ({ id: row.id, transactionId: row.transaction_id, direction: row.direction, money: { amount: row.amount, currency: row.currency }, balanceBefore: { amount: row.balance_before, currency: row.currency }, balanceAfter: { amount: row.balance_after, currency: row.currency }, createdAt: row.created_at.toISOString() }));
    const last = result.rows[take - 1];
    return { entries, nextCursor: result.rows.length > take && last ? Buffer.from(JSON.stringify({ createdAt: last.created_at.toISOString(), id: last.id })).toString('base64url') : undefined };
  }

  async getTransaction(id: string): Promise<object> { return this.findTransaction('id=$1', [id]); }
  async getProviderTransaction(providerId: string, externalId: string): Promise<object> { return this.findTransaction('provider_id=$1 and external_transaction_id=$2', [providerId, externalId]); }

  async reconcile(walletId: string): Promise<object> {
    const result = await this.database.pool.query<{ balance: string; currency: string; calculated: string; checked: string }>(`select w.balance::text,w.currency,coalesce(sum(case when l.direction='CREDIT' then l.amount else -l.amount end),0)::text calculated,count(l.id)::text checked from wallets w left join wallet_ledger_entries l on l.wallet_id=w.id where w.id=$1 group by w.id`, [walletId]);
    const row = result.rows[0]; if (!row) throw new NotFoundException('Wallet not found');
    const difference = await this.database.pool.query<{ value: string }>('select ($1::numeric - $2::numeric)::text value', [row.balance, row.calculated]);
    return { walletId, storedBalance: { amount: row.balance, currency: row.currency }, calculatedBalance: { amount: row.calculated, currency: row.currency }, difference: { amount: difference.rows[0]!.value, currency: row.currency }, consistent: difference.rows[0]!.value === '0.00', checkedEntries: Number(row.checked) };
  }

  async process(request: WagerRequest, idempotencyKey: string, transactionClient?: PoolClient): Promise<object> {
    if (!idempotencyKey) throw new UnprocessableEntityException('Idempotency-Key is required');
    const payloadHash = WageringService.canonicalHash(request);
    const operation = async (client: PoolClient): Promise<object> => {
      const locked = await client.query<WalletRow>('select id,player_id,currency,balance::text,version from wallets where id=$1 for update', [request.walletId]);
      const wallet = locked.rows[0];
      if (!wallet) throw new NotFoundException('Wallet not found');
      const inserted = await client.query<{ id: string }>('insert into wager_transactions (id,provider_id,external_transaction_id,idempotency_key,payload_hash,wallet_id,player_id,round_id,game_id,kind,amount,currency,reference_external_transaction_id,status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict (idempotency_key) do nothing returning id', [randomUUID(), request.providerId, request.externalTransactionId, idempotencyKey, payloadHash, request.walletId, request.playerId, request.roundId, request.gameId, request.kind, request.money.amount, request.money.currency, request.referenceExternalTransactionId ?? null, 'PENDING']);
      if (inserted.rowCount === 0) return this.replay(client, idempotencyKey, payloadHash);
      const transactionId = inserted.rows[0]!.id;
      if (wallet.player_id !== request.playerId || wallet.currency !== request.money.currency) {
        return this.finish(client, transactionId, 'REJECTED', wallet.balance, wallet.currency, 'WALLET_MISMATCH');
      }
      const reference = request.referenceExternalTransactionId ? await client.query<TransactionRow & { kind: string; wallet_id: string; player_id: string; provider_id: string; round_id: string; amount: string; currency: string }>('select id,payload_hash,status,result_balance,result_currency,failure_code,kind,wallet_id,player_id,provider_id,round_id,amount::text,currency from wager_transactions where provider_id=$1 and external_transaction_id=$2', [request.providerId, request.referenceExternalTransactionId]) : undefined;
      if ((request.kind === 'REFUND' || request.kind === 'ROLLBACK') && !reference?.rows[0]) {
        await client.query('update wager_transactions set status=$2, result_balance=$3, result_currency=$4 where id=$1', [transactionId, 'PENDING_REFERENCE', wallet.balance, wallet.currency]);
        await this.outbox(client, transactionId, 'WagerTransactionPendingReference', { transactionId, walletId: wallet.id });
        return { transactionId, status: 'PENDING_REFERENCE', balance: { amount: wallet.balance, currency: wallet.currency }, idempotentReplay: false };
      }
      const ref = reference?.rows[0];
      if (ref && (ref.status !== 'PROCESSED' || ref.wallet_id !== wallet.id || ref.player_id !== wallet.player_id || ref.round_id !== request.roundId || ref.currency !== wallet.currency || ref.amount !== request.money.amount || !this.referenceAllowed(request.kind, ref.kind))) {
        return this.finish(client, transactionId, 'REJECTED', wallet.balance, wallet.currency, 'INVALID_REFERENCE');
      }
      if (ref && (request.kind === 'REFUND' || request.kind === 'ROLLBACK')) {
        const prior = await client.query('select 1 from wager_transactions where kind=$1 and reference_transaction_id=$2 and status=$3 limit 1', [request.kind, ref.id, 'PROCESSED']);
        if (prior.rowCount) return this.finish(client, transactionId, 'REJECTED', wallet.balance, wallet.currency, 'REFERENCE_ALREADY_REVERSED');
      }
      let direction: 'DEBIT' | 'CREDIT' | undefined = request.kind === 'BET' ? 'DEBIT' : ['WIN', 'REFUND'].includes(request.kind) ? 'CREDIT' : undefined;
      if (request.kind === 'ROLLBACK') direction = ref!.kind === 'BET' ? 'CREDIT' : 'DEBIT';
      const amount = request.money.amount;
      if (direction) {
        const changed = await client.query<WalletRow>(`update wallets set balance = balance ${direction === 'DEBIT' ? '-' : '+'} $1::numeric, version=version+1, updated_at=now() where id=$2${direction === 'DEBIT' ? ' and balance >= $1::numeric' : ''} returning id,player_id,currency,balance::text,version`, [amount, wallet.id]);
        if (changed.rowCount === 0) return this.finish(client, transactionId, 'REJECTED', wallet.balance, wallet.currency, request.kind === 'ROLLBACK' ? 'ROLLBACK_WOULD_CREATE_NEGATIVE_BALANCE' : 'INSUFFICIENT_BALANCE');
        const after = changed.rows[0]!;
        await client.query('insert into wallet_ledger_entries (id,wallet_id,transaction_id,direction,amount,currency,balance_before,balance_after) values ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), wallet.id, transactionId, direction, amount, wallet.currency, wallet.balance, after.balance]);
        await this.outbox(client, transactionId, 'WalletBalanceChanged', { walletId: wallet.id, transactionId, direction, money: request.money, balanceBefore: { amount: wallet.balance, currency: wallet.currency }, balanceAfter: { amount: after.balance, currency: wallet.currency }, walletVersion: after.version });
        return this.finish(client, transactionId, 'PROCESSED', after.balance, wallet.currency, undefined, ref?.id);
      }
      return this.finish(client, transactionId, 'PROCESSED', wallet.balance, wallet.currency, undefined, ref?.id);
    };
    return transactionClient ? operation(transactionClient) : this.database.transaction(operation);
  }

  async resolvePendingReferences(limit = 20, maxAttempts = 5): Promise<number> {
    let resolved = 0;
    for (let index = 0; index < limit; index += 1) {
      const changed = await this.database.transaction(async (client) => {
        const pending = await client.query<{ id:string; provider_id:string; external_transaction_id:string; wallet_id:string; player_id:string; round_id:string; kind:'REFUND'|'ROLLBACK'; amount:string; currency:string; reference_external_transaction_id:string; retry_attempts:number }>(`select id,provider_id,external_transaction_id,wallet_id,player_id,round_id,kind,amount::text,currency,reference_external_transaction_id,retry_attempts from wager_transactions where status='PENDING_REFERENCE' and (next_retry_at is null or next_retry_at <= now()) order by created_at for update skip locked limit 1`);
        const row = pending.rows[0]; if (!row) return false;
        const wallet = (await client.query<WalletRow>('select id,player_id,currency,balance::text,version from wallets where id=$1 for update', [row.wallet_id])).rows[0]!;
        const reference = (await client.query<TransactionRow & { kind:string; wallet_id:string; player_id:string; provider_id:string; round_id:string; amount:string; currency:string }>('select id,payload_hash,status,result_balance::text,result_currency,failure_code,kind,wallet_id,player_id,provider_id,round_id,amount::text,currency from wager_transactions where provider_id=$1 and external_transaction_id=$2', [row.provider_id, row.reference_external_transaction_id])).rows[0];
        if (!reference) {
          if (row.retry_attempts + 1 >= maxAttempts) { await this.finish(client, row.id, 'FAILED', wallet.balance, wallet.currency, 'REFERENCE_NOT_FOUND_TIMEOUT'); return true; }
          await client.query(`update wager_transactions set retry_attempts=retry_attempts+1,next_retry_at=now() + ((power(2,retry_attempts)::int) * interval '1 second') where id=$1`, [row.id]);
          await this.outbox(client, row.id, 'WagerTransactionPendingReferenceRetry', { transactionId: row.id, attempt: row.retry_attempts + 1 }); return true;
        }
        if (reference.status !== 'PROCESSED' || reference.wallet_id !== wallet.id || reference.player_id !== wallet.player_id || reference.round_id !== row.round_id || reference.currency !== wallet.currency || reference.amount !== row.amount || !this.referenceAllowed(row.kind, reference.kind)) { await this.finish(client, row.id, 'REJECTED', wallet.balance, wallet.currency, 'INVALID_REFERENCE'); return true; }
        const prior = await client.query('select 1 from wager_transactions where kind=$1 and reference_transaction_id=$2 and status=$3 and id<>$4 limit 1', [row.kind, reference.id, 'PROCESSED', row.id]);
        if (prior.rowCount) { await this.finish(client, row.id, 'REJECTED', wallet.balance, wallet.currency, 'REFERENCE_ALREADY_REVERSED'); return true; }
        const direction = row.kind === 'REFUND' || reference.kind === 'BET' ? 'CREDIT' : 'DEBIT';
        const changedWallet = await client.query<WalletRow>(`update wallets set balance=balance ${direction === 'DEBIT' ? '-' : '+'} $1::numeric,version=version+1,updated_at=now() where id=$2${direction === 'DEBIT' ? ' and balance >= $1::numeric' : ''} returning id,player_id,currency,balance::text,version`, [row.amount, wallet.id]);
        if (!changedWallet.rowCount) { await this.finish(client, row.id, 'REJECTED', wallet.balance, wallet.currency, 'ROLLBACK_WOULD_CREATE_NEGATIVE_BALANCE'); return true; }
        const after = changedWallet.rows[0]!;
        await client.query('insert into wallet_ledger_entries (id,wallet_id,transaction_id,direction,amount,currency,balance_before,balance_after) values ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), wallet.id, row.id, direction, row.amount, wallet.currency, wallet.balance, after.balance]);
        await this.outbox(client, row.id, 'WalletBalanceChanged', { walletId: wallet.id, transactionId: row.id, direction, money: { amount: row.amount, currency: wallet.currency }, balanceBefore: { amount: wallet.balance, currency: wallet.currency }, balanceAfter: { amount: after.balance, currency: wallet.currency }, walletVersion: after.version });
        await this.finish(client, row.id, 'PROCESSED', after.balance, wallet.currency, undefined, reference.id); return true;
      });
      if (!changed) break; resolved += 1;
    }
    return resolved;
  }

  private referenceAllowed(kind: WagerRequest['kind'], referenceKind: string): boolean { return kind === 'REFUND' ? referenceKind === 'BET' : kind === 'ROLLBACK' ? ['BET', 'WIN', 'REFUND'].includes(referenceKind) : kind === 'WIN' ? referenceKind === 'BET' : true; }
  private async findTransaction(where: string, values: string[]): Promise<object> { const row = (await this.database.pool.query<{ id:string; provider_id:string; external_transaction_id:string; status:string; failure_code:string|null; result_balance:string|null; result_currency:string|null }>(`select id,provider_id,external_transaction_id,status,failure_code,result_balance::text,result_currency from wager_transactions where ${where}`, values)).rows[0]; if (!row) throw new NotFoundException('Transaction not found'); return { transactionId: row.id, providerId: row.provider_id, externalTransactionId: row.external_transaction_id, status: row.status, failureCode: row.failure_code, balance: row.result_balance ? { amount: row.result_balance, currency: row.result_currency } : undefined }; }
  private async replay(client: PoolClient, key: string, hash: string): Promise<object> { const row = (await client.query<TransactionRow>('select id,payload_hash,status,result_balance::text,result_currency,failure_code from wager_transactions where idempotency_key=$1', [key])).rows[0]!; if (row.payload_hash !== hash) throw new ConflictException('Idempotency-Key was used with a different payload'); return { transactionId: row.id, status: row.status, balance: row.result_balance ? { amount: row.result_balance, currency: row.result_currency } : undefined, failureCode: row.failure_code, idempotentReplay: true }; }
  private async finish(client: PoolClient, id: string, status: 'PROCESSED' | 'REJECTED' | 'FAILED', balance: string | null, currency: string, failureCode?: string, referenceTransactionId?: string): Promise<object> { await client.query('update wager_transactions set status=$2,failure_code=$3,processed_at=now(),result_balance=$4,result_currency=$5,reference_transaction_id=$6 where id=$1', [id,status,failureCode ?? null,balance,currency,referenceTransactionId ?? null]); await this.outbox(client,id,status === 'PROCESSED' ? 'WagerTransactionProcessed' : 'WagerTransactionRejected',{ transactionId:id,status,failureCode }); return { transactionId:id,status,balance:balance ? { amount:balance,currency } : undefined,failureCode,idempotentReplay:false }; }
  private async outbox(client: PoolClient, aggregateId: string, eventType: string, payload: object): Promise<void> { await client.query('insert into outbox_messages (id,aggregate_id,event_type,payload,occurred_at) values ($1,$2,$3,$4,now())',[randomUUID(),aggregateId,eventType,JSON.stringify(payload)]); }
}
