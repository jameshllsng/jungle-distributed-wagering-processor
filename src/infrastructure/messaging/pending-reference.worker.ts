import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WageringService } from '../../application/wagering.service';

@Injectable()
export class PendingReferenceWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  constructor(private readonly wagering: WageringService, private readonly config: ConfigService) {}
  onModuleInit(): void { if (this.config.get<string>('PENDING_REFERENCE_WORKER_ENABLED') !== 'false') this.timer = setInterval(() => { void this.wagering.resolvePendingReferences(); }, Number(this.config.get<string>('PENDING_REFERENCE_POLL_MS') ?? 1000)); }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
}
