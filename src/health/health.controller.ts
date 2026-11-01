import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../infrastructure/persistence/database.service';
import { SqsService } from '../infrastructure/messaging/sqs.service';
@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService, private readonly sqs: SqsService) {}
  @Get('live') live(): { status: 'ok' } { return { status: 'ok' }; }
  @Get('ready') async ready(): Promise<{ status: 'ok' }> { if (!await this.database.isReady() || !await this.sqs.isReady()) throw new ServiceUnavailableException({ status: 'not-ready', reason: 'dependency unavailable' }); return { status: 'ok' }; }
}
