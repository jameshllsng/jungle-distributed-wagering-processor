import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { WageringService } from '../../src/application/wagering.service';
import { OutboxPublisher } from '../../src/infrastructure/messaging/outbox.publisher';
import { SqsService } from '../../src/infrastructure/messaging/sqs.service';
import { DatabaseService } from '../../src/infrastructure/persistence/database.service';

const testUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://jungle:jungle@localhost:5432/jungle_test';
const suffix = randomUUID();
const config = new ConfigService({ DATABASE_URL: testUrl, SQS_ENDPOINT: process.env.SQS_ENDPOINT ?? 'http://localhost:4566', AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', SQS_QUEUE_NAME: `outbox-it-${suffix}.fifo`, SQS_DLQ_NAME: `outbox-it-dlq-${suffix}.fifo`, SQS_EVENT_QUEUE_NAME: `outbox-it-events-${suffix}.fifo` });
const database = new DatabaseService(config); const wagering = new WageringService(database); const sqs = new SqsService(config);
const publisherA = new OutboxPublisher(database, sqs); const publisherB = new OutboxPublisher(database, sqs);

beforeAll(async () => { if ((await database.pool.query<{ current_database:string }>('select current_database()')).rows[0]?.current_database !== 'jungle_test') throw new Error('Outbox integration tests refuse to run outside jungle_test'); await sqs.onModuleInit(); });
beforeEach(async () => { await database.pool.query('truncate outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade'); });
afterAll(async () => { await database.onModuleDestroy(); });

describe('OutboxPublisher recovery with PostgreSQL and LocalStack', () => {
  test('claims each pending record once across concurrent publishers', async () => {
    await wagering.createWallet(randomUUID(), { amount: '100.00', currency: 'BRL' });
    const published = await Promise.all([publisherA.publishDue(), publisherB.publishDue()]);
    expect(published[0] + published[1]).toBe(2);
    const events = await sqs.receiveEvent(); expect(events.Messages).toHaveLength(2);
    await Promise.all(events.Messages!.map((message) => sqs.acknowledgeEvent(message.ReceiptHandle!)));
    expect((await database.pool.query('select 1 from outbox_messages where published_at is not null')).rowCount).toBe(2);
  });

  test('recovers duplicate-safe after SendMessage succeeds but published_at update fails', async () => {
    await wagering.createWallet(randomUUID(), { amount: '100.00', currency: 'BRL' });
    await database.pool.query(`create or replace function fail_outbox_confirmation() returns trigger language plpgsql as $$ begin if new.published_at is not null then raise exception 'simulated confirmation failure'; end if; return new; end; $$; create trigger fail_outbox_confirmation before update on outbox_messages for each row execute function fail_outbox_confirmation();`);
    expect(await publisherA.publishDue()).toBe(0);
    expect((await database.pool.query('select 1 from outbox_messages where published_at is null')).rowCount).toBe(2);
    await database.pool.query('drop trigger fail_outbox_confirmation on outbox_messages; drop function fail_outbox_confirmation(); update outbox_messages set next_attempt_at=now() where published_at is null');
    expect(await publisherB.publishDue()).toBe(2);
    expect((await database.pool.query('select 1 from outbox_messages where published_at is not null')).rowCount).toBe(2);
    expect((await sqs.receiveEvent()).Messages).toHaveLength(4);
  });
});
