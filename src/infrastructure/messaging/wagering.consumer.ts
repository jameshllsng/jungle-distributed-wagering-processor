import { HttpException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../persistence/database.service';
import { WageringService, type WagerRequest } from '../../application/wagering.service';
import { SqsService } from './sqs.service';

type Envelope = { messageId: string; type: 'WagerTransactionRequested'; data: WagerRequest & { idempotencyKey: string } };

@Injectable()
export class WageringConsumer {
  private readonly consumerName = 'wagering-consumer-v1';
  constructor(private readonly database: DatabaseService, private readonly wagering: WageringService, private readonly sqs: SqsService) {}

  async pollOnce(): Promise<number> {
    const received = await this.sqs.receive(); let acknowledged = 0;
    for (const message of received.Messages ?? []) {
      if (!message.Body || !message.ReceiptHandle) continue;
      try {
        await this.processEnvelope(JSON.parse(message.Body) as Envelope);
        await this.sqs.acknowledge(message.ReceiptHandle);
        acknowledged += 1;
      } catch (error) {
        if (this.isPermanent(error)) await this.sqs.acknowledge(message.ReceiptHandle);
      }
    }
    return acknowledged;
  }

  async processEnvelope(envelope: Envelope): Promise<object | undefined> {
    this.assertEnvelope(envelope);
    const payloadHash = createHash('sha256').update(JSON.stringify(envelope.data)).digest('hex');
    return this.database.transaction(async (client) => {
      const inserted = await client.query('insert into inbox_messages (consumer_name,message_id,payload_hash) values ($1,$2,$3) on conflict do nothing returning message_id', [this.consumerName, envelope.messageId, payloadHash]);
      if (!inserted.rowCount) {
        const existing = await client.query<{ payload_hash: string; processed_at: Date | null }>('select payload_hash,processed_at from inbox_messages where consumer_name=$1 and message_id=$2 for update', [this.consumerName, envelope.messageId]);
        if (existing.rows[0]?.payload_hash !== payloadHash) throw new TypeError('Inbox message payload conflict');
        return undefined;
      }
      const { idempotencyKey, ...request } = envelope.data;
      const result = await this.wagering.process(request, idempotencyKey, client);
      await client.query('update inbox_messages set processed_at=now() where consumer_name=$1 and message_id=$2', [this.consumerName, envelope.messageId]);
      return result;
    });
  }

  private assertEnvelope(envelope: Envelope): void {
    if (!envelope?.messageId || envelope.type !== 'WagerTransactionRequested' || !envelope.data?.idempotencyKey || !envelope.data.providerId) throw new TypeError('Invalid wagering SQS envelope');
  }

  private isPermanent(error: unknown): boolean {
    return error instanceof SyntaxError || error instanceof TypeError || error instanceof HttpException;
  }
}
