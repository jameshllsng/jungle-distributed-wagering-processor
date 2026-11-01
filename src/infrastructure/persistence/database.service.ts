import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MikroORM } from '@mikro-orm/postgresql';
import { Pool, type PoolClient } from 'pg';
import { WalletEntity, WalletSchema } from './entities/wallet.entity';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly pool: Pool;
  private readonly ormReady: Promise<MikroORM>;

  constructor(config: ConfigService) {
    const connectionString = config.get<string>('DATABASE_URL') ?? 'postgresql://jungle:jungle@localhost:5432/jungle';
    this.pool = new Pool({ connectionString });
    this.ormReady = MikroORM.init({ clientUrl: connectionString, entities: [WalletSchema] });
  }

  async onModuleInit(): Promise<void> { await this.ormReady; }

  async findWallet(id: string): Promise<WalletEntity | null> { return (await this.ormReady).em.fork().findOne(WalletEntity, { id }); }

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

  async onModuleDestroy(): Promise<void> { await this.pool.end(); await (await this.ormReady).close(true); }
}
