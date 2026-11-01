import { Injectable } from '@nestjs/common';

export type LogIdentifiers = {
  correlationId?: string;
  messageId?: string;
  transactionId?: string;
  walletId?: string;
  providerId?: string;
};

/** Emits one machine-readable event per line. Do not pass financial payloads here. */
@Injectable()
export class StructuredLogger {
  info(event: string, identifiers: LogIdentifiers = {}, extra: Record<string, string | number | boolean | undefined> = {}): void {
    this.write('info', event, identifiers, extra);
  }

  warn(event: string, identifiers: LogIdentifiers = {}, extra: Record<string, string | number | boolean | undefined> = {}): void {
    this.write('warn', event, identifiers, extra);
  }

  error(event: string, identifiers: LogIdentifiers = {}, extra: Record<string, string | number | boolean | undefined> = {}): void {
    this.write('error', event, identifiers, extra);
  }

  private write(level: 'info' | 'warn' | 'error', event: string, identifiers: LogIdentifiers, extra: Record<string, string | number | boolean | undefined>): void {
    const fields = Object.fromEntries(Object.entries({
      timestamp: new Date().toISOString(), level, event, ...identifiers, ...extra,
    }).filter(([, value]) => value !== undefined));
    // JSON is intentionally emitted directly: Nest's default formatter may add non-JSON prefixes.
    console.log(JSON.stringify(fields));
  }
}
