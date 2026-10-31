import { EntitySchema } from '@mikro-orm/core';

/** Persistence model only; financial rules stay in the domain aggregate. */
export class WalletEntity {
  id!: string;
  playerId!: string;
  currency!: string;
  balance!: string;
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export const WalletSchema = new EntitySchema<WalletEntity>({
  class: WalletEntity,
  tableName: 'wallets',
  properties: {
    id: { primary: true, type: 'uuid' },
    playerId: { fieldName: 'player_id', type: 'uuid' },
    currency: { type: 'string', length: 3 },
    balance: { type: 'string', columnType: 'numeric(20,2)' },
    version: { type: 'integer' },
    createdAt: { fieldName: 'created_at', type: 'datetime' },
    updatedAt: { fieldName: 'updated_at', type: 'datetime' },
  },
  uniques: [{ properties: ['playerId', 'currency'] }],
});
