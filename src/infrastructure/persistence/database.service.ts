import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(config: ConfigService) {
    this.pool = new Pool({ connectionString: config.get<string>('DATABASE_URL') ?? 'postgresql://jungle:jungle@localhost:5432/jungle' });
  }

  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await operation(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
  }

  async isReady(): Promise<boolean> {
    try { await this.pool.query('select 1'); return true; } catch { return false; }
  }

  async onModuleDestroy(): Promise<void> { await this.pool.end(); }
}
