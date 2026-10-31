import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { WalletSchema } from './src/infrastructure/persistence/entities/wallet.entity';

export default defineConfig({
  clientUrl: process.env.DATABASE_URL ?? 'postgresql://jungle:jungle@localhost:5432/jungle',
  entities: [WalletSchema],
  extensions: [Migrator],
  migrations: { path: 'src/infrastructure/persistence/migrations' },
});
