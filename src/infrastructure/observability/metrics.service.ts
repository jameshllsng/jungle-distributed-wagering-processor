import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private readonly values = new Map<string, number>();
  increment(name: string, labels: Record<string, string> = {}): void { const key = this.key(name, labels); this.values.set(key, (this.values.get(key) ?? 0) + 1); }
  set(name: string, value: number, labels: Record<string, string> = {}): void { this.values.set(this.key(name, labels), value); }
  observe(name: string, value: number, labels: Record<string, string> = {}): void { this.increment(`${name}_count`, labels); this.increment(`${name}_sum`, labels); const sumKey = this.key(`${name}_sum`, labels); this.values.set(sumKey, (this.values.get(sumKey) ?? 0) + value - 1); }
  snapshot(): Record<string, number> { return Object.fromEntries(this.values); }
  prometheus(): string { return [...this.values.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key} ${value}`).join('\n') + '\n'; }
  private key(name: string, labels: Record<string, string>): string { const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)); return entries.length ? `${name}{${entries.map(([key, value]) => `${key}="${value.replaceAll('"', '\\"')}"`).join(',')}}` : name; }
}
