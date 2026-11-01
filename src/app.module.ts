import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';
import { DatabaseService } from './infrastructure/persistence/database.service';
import { WageringService } from './application/wagering.service';
import { WageringController } from './presentation/wagering.controller';
import { SqsService } from './infrastructure/messaging/sqs.service';
import { OutboxPublisher } from './infrastructure/messaging/outbox.publisher';
import { WageringConsumer } from './infrastructure/messaging/wagering.consumer';
import { PendingReferenceWorker } from './infrastructure/messaging/pending-reference.worker';
import { MetricsService } from './infrastructure/observability/metrics.service';
import { MetricsController } from './infrastructure/observability/metrics.controller';
@Module({ imports: [ConfigModule.forRoot({ isGlobal: true })], controllers: [HealthController, WageringController, MetricsController], providers: [DatabaseService, MetricsService, WageringService, SqsService, OutboxPublisher, WageringConsumer, PendingReferenceWorker] })
export class AppModule {}
