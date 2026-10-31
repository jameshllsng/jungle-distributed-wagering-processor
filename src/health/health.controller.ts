import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
@Controller('health')
export class HealthController {
  @Get('live') live(): { status: 'ok' } { return { status: 'ok' }; }
  @Get('ready') ready(): never { throw new ServiceUnavailableException({ status: 'not-ready', reason: 'dependencies are not configured yet' }); }
}
