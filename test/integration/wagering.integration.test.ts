import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../src/infrastructure/persistence/database.service';
import { WageringService, type WagerRequest } from '../../src/application/wagering.service';

const testUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://jungle:jungle@localhost:5432/jungle_test';
const config = { get: () => testUrl } as unknown as ConfigService;
const database = new DatabaseService(config);
const wagering = new WageringService(database);
const money = (amount: string) => ({ amount, currency: 'BRL' });

const request = (walletId: string, playerId: string, externalTransactionId: string, kind: WagerRequest['kind'], amount = '80.00', referenceExternalTransactionId?: string): WagerRequest => ({ providerId: 'integration-provider', externalTransactionId, playerId, walletId, roundId: 'integration-round', gameId: 'integration-game', kind, money: money(amount), referenceExternalTransactionId });

beforeAll(async () => {
  const current = await database.pool.query<{ current_database: string }>('select current_database()');
  if (current.rows[0]?.current_database !== 'jungle_test') throw new Error('Integration tests refuse to run outside jungle_test');
});
beforeEach(async () => { await database.pool.query('truncate outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade'); });
afterAll(async () => { await database.onModuleDestroy(); });

describe('wagering integration with PostgreSQL', () => {
  test('opens a wallet atomically with OPENING and reconciles its ledger', async () => {
    const playerId = randomUUID();
    const wallet = await wagering.createWallet(playerId, money('100.00')) as { id: string; version: number };
    const ledger = await wagering.getLedger(wallet.id) as { entries: Array<{ direction: string; money: { amount: string } }> };
    const reconciliation = await wagering.reconcile(wallet.id) as { consistent: boolean; calculatedBalance: { amount: string } };
    const outbox = await database.pool.query<{ event_type: string }>('select event_type from outbox_messages order by event_type');
    expect(wallet.version).toBe(1); expect(ledger.entries).toHaveLength(1); expect(ledger.entries[0]?.direction).toBe('CREDIT'); expect(ledger.entries[0]?.money.amount).toBe('100.00'); expect(reconciliation).toMatchObject({ consistent: true, calculatedBalance: { amount: '100.00' } }); expect(outbox.rows.map((row) => row.event_type)).toEqual(['WagerTransactionProcessed', 'WalletBalanceChanged']);
  });

  test('does not create artificial opening events for zero and rejects an absent wallet cleanly', async () => {
    const playerId = randomUUID(); const zero = await wagering.createWallet(playerId, money('0.00')) as { id: string };
    expect((await database.pool.query('select 1 from outbox_messages')).rowCount).toBe(0);
    await expect(wagering.process(request(randomUUID(), playerId, 'missing-wallet', 'BET'), 'integration:missing-wallet')).rejects.toThrow('Wallet not found');
    expect((await database.pool.query('select 1 from wager_transactions where wallet_id=$1', [zero.id])).rowCount).toBe(0);
  });

  test('serializes two concurrent BETs against one wallet', async () => {
    const playerId = randomUUID(); const wallet = await wagering.createWallet(playerId, money('100.00')) as { id: string };
    const results = await Promise.all([wagering.process(request(wallet.id, playerId, 'bet-a', 'BET'), 'integration:bet-a'), wagering.process(request(wallet.id, playerId, 'bet-b', 'BET'), 'integration:bet-b')]) as Array<{ status: string }>;
    const final = await wagering.getWallet(wallet.id) as { balance: { amount: string } };
    const ledger = await wagering.getLedger(wallet.id) as { entries: Array<{ direction: string }> };
    expect(results.map((result) => result.status).sort()).toEqual(['PROCESSED', 'REJECTED']); expect(final.balance.amount).toBe('20.00'); expect(ledger.entries.filter((entry) => entry.direction === 'DEBIT')).toHaveLength(1);
  });

  test('persists idempotency across fifty concurrent deliveries', async () => {
    const playerId = randomUUID(); const wallet = await wagering.createWallet(playerId, money('100.00')) as { id: string };
    const results = await Promise.all(Array.from({ length: 50 }, () => wagering.process(request(wallet.id, playerId, 'same-bet', 'BET'), 'integration:same-bet'))) as Array<{ transactionId: string; idempotentReplay: boolean }>;
    const final = await wagering.getWallet(wallet.id) as { balance: { amount: string } };
    const ledger = await wagering.getLedger(wallet.id) as { entries: Array<{ direction: string }> };
    expect(new Set(results.map((result) => result.transactionId)).size).toBe(1); expect(results.filter((result) => !result.idempotentReplay)).toHaveLength(1); expect(final.balance.amount).toBe('20.00'); expect(ledger.entries.filter((entry) => entry.direction === 'DEBIT')).toHaveLength(1);
  });

  test('processes refund once and keeps a rejected duplicate auditable', async () => {
    const playerId = randomUUID(); const wallet = await wagering.createWallet(playerId, money('100.00')) as { id: string };
    await wagering.process(request(wallet.id, playerId, 'bet', 'BET'), 'integration:bet');
    const refund = await wagering.process(request(wallet.id, playerId, 'refund', 'REFUND', '80.00', 'bet'), 'integration:refund') as { status: string };
    const duplicate = await wagering.process(request(wallet.id, playerId, 'refund-duplicate', 'REFUND', '80.00', 'bet'), 'integration:refund-duplicate') as { status: string; failureCode?: string };
    const final = await wagering.getWallet(wallet.id) as { balance: { amount: string } };
    expect(refund.status).toBe('PROCESSED'); expect(duplicate).toMatchObject({ status: 'REJECTED', failureCode: 'REFERENCE_ALREADY_REVERSED' }); expect(final.balance.amount).toBe('100.00');
  });

  test('resolves a REFUND received before its BET through the pending-reference worker', async () => {
    const playerId = randomUUID(); const wallet = await wagering.createWallet(playerId, money('100.00')) as { id: string };
    const pending = await wagering.process(request(wallet.id, playerId, 'refund-before-bet', 'REFUND', '80.00', 'late-bet'), 'integration:refund-before-bet') as { status: string };
    expect(pending.status).toBe('PENDING_REFERENCE');
    await wagering.process(request(wallet.id, playerId, 'late-bet', 'BET'), 'integration:late-bet');
    expect(await wagering.resolvePendingReferences()).toBe(1);
    const resolved = await wagering.getProviderTransaction('integration-provider', 'refund-before-bet') as { status: string };
    const final = await wagering.getWallet(wallet.id) as { balance: { amount: string } };
    expect(resolved.status).toBe('PROCESSED'); expect(final.balance.amount).toBe('100.00');
    expect((await wagering.reconcile(wallet.id) as { consistent: boolean }).consistent).toBe(true);
  });

  test('rejects a missing pending reference after its retry budget without financial writes', async () => {
    const playerId = randomUUID(); const wallet = await wagering.createWallet(playerId, money('100.00')) as { id: string };
    await wagering.process(request(wallet.id, playerId, 'never-refund', 'REFUND', '80.00', 'never-bet'), 'integration:never-refund');
    for (let attempt = 0; attempt < 5; attempt += 1) { await database.pool.query('update wager_transactions set next_retry_at=now() where external_transaction_id=$1', ['never-refund']); await wagering.resolvePendingReferences(); }
    const failed = await wagering.getProviderTransaction('integration-provider', 'never-refund') as { status: string; failureCode: string };
    expect(failed).toMatchObject({ status: 'REJECTED', failureCode: 'REFERENCE_NOT_FOUND_TIMEOUT' });
    expect((await wagering.getWallet(wallet.id) as { balance: { amount: string } }).balance.amount).toBe('100.00');
    expect((await database.pool.query('select 1 from wallet_ledger_entries where wallet_id=$1', [wallet.id])).rowCount).toBe(1);
    expect((await database.pool.query("select 1 from outbox_messages where event_type='WagerTransactionRejected' and payload->>'failureCode'='REFERENCE_NOT_FOUND_TIMEOUT' ")).rowCount).toBe(1);
    expect(await wagering.resolvePendingReferences()).toBe(0);
  });
});
