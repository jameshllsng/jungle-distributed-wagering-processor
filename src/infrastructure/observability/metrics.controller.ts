import { Controller, Get } from '@nestjs/common';
import { MetricsService } from './metrics.service';
@Controller('metrics')
export class MetricsController { constructor(private readonly metrics: MetricsService) {} @Get() snapshot(): Record<string, number> { return this.metrics.snapshot(); } }
