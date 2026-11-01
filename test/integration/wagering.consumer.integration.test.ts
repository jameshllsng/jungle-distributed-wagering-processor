import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { WageringService, type WagerRequest } from '../../src/application/wagering.service';
import { WageringConsumer } from '../../src/infrastructure/messaging/wagering.consumer';
import { SqsService } from '../../src/infrastructure/messaging/sqs.service';
import { DatabaseService } from '../../src/infrastructure/persistence/database.service';

const testUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://jungle:jungle@localhost:5432/jungle_test';
const suffix = randomUUID();
const config = new ConfigService({
  DATABASE_URL: testUrl,
  SQS_ENDPOINT: process.env.SQS_ENDPOINT ?? 'http://localhost:4566',
  AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test',
  SQS_QUEUE_NAME: `wager-consumer-it-${suffix}.fifo`,
  SQS_DLQ_NAME: `wager-consumer-it-dlq-${suffix}.fifo`,
});
const database = new DatabaseService(config);
const wagering = new WageringService(database);
const sqs = new SqsService(config);
const consumer = new WageringConsumer(database, wagering, sqs);
const money = (amount: string) => ({ amount, currency: 'BRL' });

function bet(walletId: string, playerId: string): WagerRequest {
  return { providerId: 'consumer-integration-provider', externalTransactionId: `bet-${randomUUID()}`, playerId, walletId, roundId: 'consumer-round', gameId: 'consumer-game', kind: 'BET', money: money('30.00') };
}

beforeAll(async () => {
  const current = await database.pool.query<{ current_database: string }>('select current_database()');
  if (current.rows[0]?.current_database !== 'jungle_test') throw new Error('Consumer integration tests refuse to run outside jungle_test');
  await sqs.onModuleInit();
});
beforeEach(async () => { await database.pool.query('truncate outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade'); });
afterAll(async () => { await database.onModuleDestroy(); });

describe('WageringConsumer with LocalStack SQS and PostgreSQL', () => {
  test('commits Inbox, wallet, ledger and outbox before acknowledging a valid BET', async () => {
    const playerId = randomUUID();
    const wallet = await wagering.createWallet(playerId, money('100.00')) as { id: string };
    const request = bet(wallet.id, playerId);
    const messageId = randomUUID();
    await sqs.send({ messageId, type: 'WagerTransactionRequested', data: { ...request, idempotencyKey: `consumer:${messageId}` } });

    expect(await consumer.pollOnce()).toBe(1);

    const inbox = await database.pool.query<{ processed_at: Date | null }>('select processed_at from inbox_messages where consumer_name=$1 and message_id=$2', ['wagering-consumer-v1', messageId]);
    const balance = await wagering.getWallet(wallet.id) as { balance: { amount: string } };
    const ledger = await database.pool.query('select 1 from wallet_ledger_entries where wallet_id=$1 and direction=$2', [wallet.id, 'DEBIT']);
    const outbox = await database.pool.query<{ event_type: string }>('select event_type from outbox_messages order by event_type');
    expect(inbox.rows[0]?.processed_at).toBeDefined();
    expect(balance.balance.amount).toBe('70.00');
    expect(ledger.rowCount).toBe(1);
    expect(outbox.rows.map((row) => row.event_type)).toEqual(['WagerTransactionProcessed', 'WagerTransactionProcessed', 'WalletBalanceChanged', 'WalletBalanceChanged']);
    expect((await sqs.receive()).Messages ?? []).toHaveLength(0);
  });

  test('redelivers after a committed transaction without a second financial effect', async () => {
    const playerId = randomUUID();
    const wallet = await wagering.createWallet(playerId, money('100.00')) as { id: string };
    const request = bet(wallet.id, playerId);
    const messageId = randomUUID();
    const envelope = { messageId, type: 'WagerTransactionRequested' as const, data: { ...request, idempotencyKey: `consumer:${messageId}` } };
    await sqs.send(envelope);

    const received = await sqs.receive(1);
    expect(received.Messages).toHaveLength(1);
    await consumer.processEnvelope(JSON.parse(received.Messages![0]!.Body!) as typeof envelope);
    expect((await wagering.getWallet(wallet.id) as { balance: { amount: string } }).balance.amount).toBe('70.00');
    expect((await database.pool.query('select 1 from inbox_messages where message_id=$1', [messageId])).rowCount).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(await consumer.pollOnce()).toBe(1);
    const ledger = await database.pool.query('select 1 from wallet_ledger_entries where wallet_id=$1 and direction=$2', [wallet.id, 'DEBIT']);
    expect(ledger.rowCount).toBe(1);
    expect((await sqs.receive()).Messages ?? []).toHaveLength(0);
  });

  test('acknowledges a divergent payload for an existing messageId without changing money', async () => {
    const playerId = randomUUID();
    const wallet = await wagering.createWallet(playerId, money('100.00')) as { id: string };
    const messageId = randomUUID();
    const original = bet(wallet.id, playerId);
    await sqs.send({ messageId, type: 'WagerTransactionRequested', data: { ...original, idempotencyKey: `consumer:${messageId}` } });
    expect(await consumer.pollOnce()).toBe(1);
    const divergent = { ...original, externalTransactionId: `changed-${randomUUID()}`, money: money('20.00') };
    await sqs.send({ messageId, type: 'WagerTransactionRequested', data: { ...divergent, idempotencyKey: `consumer:${messageId}:changed` } });

    expect(await consumer.pollOnce()).toBe(0);
    expect((await wagering.getWallet(wallet.id) as { balance: { amount: string } }).balance.amount).toBe('70.00');
    expect((await database.pool.query('select 1 from wallet_ledger_entries where wallet_id=$1 and direction=$2', [wallet.id, 'DEBIT'])).rowCount).toBe(1);
    expect((await sqs.receive()).Messages ?? []).toHaveLength(0);
  });

  test('rolls back the Inbox and all financial writes when processing fails before commit', async () => {
    const playerId = randomUUID();
    const messageId = randomUUID();
    const envelope = { messageId, type: 'WagerTransactionRequested' as const, data: { ...bet(randomUUID(), playerId), idempotencyKey: `consumer:${messageId}` } };
    await sqs.send(envelope);
    const received = await sqs.receive(5);
    expect(received.Messages).toHaveLength(1);

    await expect(consumer.processEnvelope(JSON.parse(received.Messages![0]!.Body!) as typeof envelope)).rejects.toThrow('Wallet not found');
    expect((await database.pool.query('select 1 from inbox_messages where message_id=$1', [messageId])).rowCount).toBe(0);
    expect((await database.pool.query('select 1 from wager_transactions where idempotency_key=$1', [`consumer:${messageId}`])).rowCount).toBe(0);
    expect((await database.pool.query('select 1 from wallet_ledger_entries')).rowCount).toBe(0);
    await sqs.acknowledge(received.Messages![0]!.ReceiptHandle!);
  });

  test('moves an unacknowledged transient delivery to the configured LocalStack DLQ', async () => {
    await sqs.send({ messageId: randomUUID(), type: 'TransientInfrastructureFailure', data: { retry: true } });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const received = await sqs.receive(0);
      expect(received.Messages).toHaveLength(1);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await sqs.receive(0);
    const dlq = await sqs.receiveFromDlq();
    expect(dlq.Messages).toHaveLength(1);
  });
});
