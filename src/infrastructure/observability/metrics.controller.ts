import { Controller, Get, Header } from '@nestjs/common';
import { DatabaseService } from '../persistence/database.service';
import { SqsService } from '../messaging/sqs.service';
import { MetricsService } from './metrics.service';
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService, private readonly database: DatabaseService, private readonly sqs: SqsService) {}
  @Get() @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  async snapshot(): Promise<string> {
    const lag = await this.database.pool.query<{ seconds: string }>("select coalesce(extract(epoch from now() - min(occurred_at)), 0)::text seconds from outbox_messages where published_at is null");
    this.metrics.set('wager_outbox_lag_seconds', Number(lag.rows[0]?.seconds ?? 0));
    this.metrics.set('wager_dlq_messages', await this.sqs.dlqDepth());
    return this.metrics.prometheus();
  }
}
