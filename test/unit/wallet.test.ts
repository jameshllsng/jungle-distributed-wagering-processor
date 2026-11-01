import { describe, expect, test } from 'bun:test';
import { InsufficientBalanceError } from '../../src/domain/errors';
import { Money, InvalidMoneyError, CurrencyMismatchError } from '../../src/domain/money';
import { LedgerDirection } from '../../src/domain/wager-transaction';
import { Wallet } from '../../src/domain/wallet';

const brl = (amount: string): Money => Money.from({ amount, currency: 'BRL' });

describe('Wallet', () => {
  test('opens with its initial balance and version one', () => {
    const openedAt = new Date('2026-10-31T10:00:00.000Z');
    const wallet = Wallet.open({ id: 'wallet-1', playerId: 'player-1', initialBalance: brl('100.00'), openedAt });
    expect(wallet.balance.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(wallet.currency).toBe('BRL');
    expect(wallet.version).toBe(1);
    expect(wallet.createdAt).toEqual(openedAt);
  });

  test('debits and credits with an auditable balance change and increments version only on change', () => {
    const wallet = Wallet.open({ id: 'wallet-1', playerId: 'player-1', initialBalance: brl('100.00') });
    const debit = wallet.debit(brl('30.00'), new Date('2026-10-31T10:01:00.000Z'));
    expect(debit).toEqual({
      direction: LedgerDirection.Debit,
      money: brl('30.00'),
      balanceBefore: brl('100.00'),
      balanceAfter: brl('70.00'),
      walletVersion: 2,
    });
    const credit = wallet.credit(brl('10.00'));
    expect(credit.direction).toBe(LedgerDirection.Credit);
    expect(wallet.balance.toJSON()).toEqual({ amount: '80.00', currency: 'BRL' });
    expect(wallet.version).toBe(3);
  });

  test('rejects insufficient funds without changing state', () => {
    const wallet = Wallet.open({ id: 'wallet-1', playerId: 'player-1', initialBalance: brl('10.00') });
    expect(() => wallet.debit(brl('10.01'))).toThrow(InsufficientBalanceError);
    expect(wallet.balance.toJSON()).toEqual({ amount: '10.00', currency: 'BRL' });
    expect(wallet.version).toBe(1);
  });

  test('rejects a currency conflict and a zero-value movement without changing state', () => {
    const wallet = Wallet.open({ id: 'wallet-1', playerId: 'player-1', initialBalance: brl('10.00') });
    expect(() => wallet.credit(Money.from({ amount: '1.00', currency: 'USD' }))).toThrow(CurrencyMismatchError);
    expect(() => wallet.credit(brl('0.00'))).toThrow(InvalidMoneyError);
    expect(wallet.balance.toJSON()).toEqual({ amount: '10.00', currency: 'BRL' });
    expect(wallet.version).toBe(1);
  });
});
