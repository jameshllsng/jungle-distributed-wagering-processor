import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private readonly values = new Map<string, number>();
  increment(name: string, labels: Record<string, string> = {}): void { const key = `${name}{${Object.entries(labels).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}="${v}"`).join(',')}}`; this.values.set(key, (this.values.get(key) ?? 0) + 1); }
  snapshot(): Record<string, number> { return Object.fromEntries(this.values); }
}
