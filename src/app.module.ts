import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';
import { DatabaseService } from './infrastructure/persistence/database.service';
import { WageringService } from './application/wagering.service';
import { WageringController } from './presentation/wagering.controller';
import { SqsService } from './infrastructure/messaging/sqs.service';
import { OutboxPublisher } from './infrastructure/messaging/outbox.publisher';
import { WageringConsumer } from './infrastructure/messaging/wagering.consumer';
@Module({ imports: [ConfigModule.forRoot({ isGlobal: true })], controllers: [HealthController, WageringController], providers: [DatabaseService, WageringService, SqsService, OutboxPublisher, WageringConsumer] })
export class AppModule {}
