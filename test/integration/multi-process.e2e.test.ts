import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../src/infrastructure/persistence/database.service';
import type { ConfigService } from '@nestjs/config';

const testUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://jungle:jungle@localhost:5432/jungle_test';
const database = new DatabaseService({ get: () => testUrl } as unknown as ConfigService);
const ports = [31_001, 31_002, 31_003];
const processes: ReturnType<typeof Bun.spawn>[] = [];
const json = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return response.json() as Promise<Record<string, unknown>>;
};

beforeAll(async () => {
  const current = await database.pool.query<{ current_database: string }>('select current_database()');
  if (current.rows[0]?.current_database !== 'jungle_test') throw new Error('Multi-process tests refuse to run outside jungle_test');
  await database.pool.query('truncate outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade');
  for (const port of ports) processes.push(Bun.spawn(['bun', 'src/main.ts'], { cwd: process.cwd(), stdout: 'ignore', stderr: 'ignore', env: { ...process.env, PORT: String(port), DATABASE_URL: testUrl, SQS_POLL_ENABLED: 'false' } }));
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { await Promise.all(ports.map((port) => json(`http://localhost:${port}/health/ready`))); return; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  throw new Error('Three Nest processes did not become ready');
});
afterAll(async () => { for (const child of processes) child.kill(); await Promise.all(processes.map((child) => child.exited)); await database.onModuleDestroy(); });

describe('three independent Nest processes', () => {
  test('share PostgreSQL locks and persistent idempotency without duplicate debits', async () => {
    const playerId = randomUUID();
    const wallet = await json(`http://localhost:${ports[0]}/wallets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }) });
    const idempotencyKey = `multiprocess:${randomUUID()}`;
    const body = JSON.stringify({ providerId: 'multiprocess-provider', externalTransactionId: randomUUID(), playerId, walletId: wallet.id, roundId: 'round', gameId: 'game', kind: 'BET', money: { amount: '80.00', currency: 'BRL' } });
    await Promise.all(Array.from({ length: 30 }, (_, index) => json(`http://localhost:${ports[index % ports.length]}/wagering/transactions`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body })));
    const finalWallet = await json(`http://localhost:${ports[1]}/wallets/${wallet.id}`) as { balance: { amount: string } };
    const ledger = await database.pool.query('select 1 from wallet_ledger_entries where wallet_id=$1 and direction=$2', [wallet.id, 'DEBIT']);
    expect(finalWallet.balance.amount).toBe('20.00');
    expect(ledger.rowCount).toBe(1);
  });
});
