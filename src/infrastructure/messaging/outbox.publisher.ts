import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../persistence/database.service';
import { SqsService } from './sqs.service';
import { MetricsService } from '../observability/metrics.service';
import { StructuredLogger } from '../observability/structured-logger.service';

type OutboxRow = { id: string; aggregate_id: string; event_type: string; payload: object; occurred_at: Date; attempts: number };

@Injectable()
export class OutboxPublisher {
  constructor(private readonly database: DatabaseService, private readonly sqs: SqsService, private readonly metrics?: MetricsService, private readonly logger?: StructuredLogger) {}

  async publishDue(limit = 20): Promise<number> {
    const rows = await this.database.transaction(async (client) => {
      const claimed = await client.query<OutboxRow>(`select id,aggregate_id,event_type,payload,occurred_at,attempts from outbox_messages where published_at is null and (next_attempt_at is null or next_attempt_at <= now()) order by occurred_at for update skip locked limit $1`, [limit]);
      for (const row of claimed.rows) await client.query('update outbox_messages set attempts=attempts+1, next_attempt_at=now() + interval \'30 seconds\' where id=$1', [row.id]);
      return claimed.rows;
    });
    let published = 0;
    for (const row of rows) {
      try {
        await this.sqs.sendEvent({ eventId: row.id, eventType: row.event_type, aggregateId: row.aggregate_id, occurredAt: row.occurred_at.toISOString(), version: 1, data: row.payload });
        await this.database.pool.query('update outbox_messages set published_at=now(), next_attempt_at=null where id=$1 and published_at is null', [row.id]);
        published += 1;
        this.logger?.info('outbox.published', { transactionId: row.aggregate_id }, { eventType: row.event_type, attempt: row.attempts + 1 });
      } catch {
        await this.database.pool.query(`update outbox_messages set next_attempt_at=now() + (least(attempts, 8) * interval '30 seconds') where id=$1 and published_at is null`, [row.id]);
        this.metrics?.increment('wager_retries_total', { component: 'outbox_publisher' });
        this.logger?.warn('outbox.publish_retry_scheduled', { transactionId: row.aggregate_id }, { eventType: row.event_type });
      }
    }
    return published;
  }
}
