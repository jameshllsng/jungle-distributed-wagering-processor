import { describe, expect, test } from 'bun:test';
import { InconsistentLedgerEntryError } from '../../src/domain/errors';
import { Money, CurrencyMismatchError } from '../../src/domain/money';
import { LedgerDirection } from '../../src/domain/wager-transaction';
import { WalletLedgerEntry } from '../../src/domain/wallet-ledger-entry';

const money = (amount: string, currency = 'BRL'): Money => Money.from({ amount, currency });
const entry = (overrides: Partial<Parameters<typeof WalletLedgerEntry.create>[0]> = {}): WalletLedgerEntry => WalletLedgerEntry.create({
  id: 'ledger-1', walletId: 'wallet-1', transactionId: 'transaction-1', direction: LedgerDirection.Credit,
  money: money('10.00'), balanceBefore: money('20.00'), balanceAfter: money('30.00'), ...overrides,
});

describe('WalletLedgerEntry', () => {
  test('creates balanced credit and debit entries', () => {
    expect(entry().isBalanced()).toBe(true);
    expect(entry({ direction: LedgerDirection.Debit, balanceBefore: money('30.00'), balanceAfter: money('20.00') }).isBalanced()).toBe(true);
  });

  test('rejects invalid arithmetic and zero-value entries', () => {
    expect(() => entry({ balanceAfter: money('31.00') })).toThrow(InconsistentLedgerEntryError);
    expect(() => entry({ money: money('0.00'), balanceAfter: money('20.00') })).toThrow(InconsistentLedgerEntryError);
  });

  test('rejects negative before and after balances even when arithmetic matches', () => {
    expect(() => entry({
      direction: LedgerDirection.Debit,
      money: money('10.00'),
      balanceBefore: money('5.00').negate(),
      balanceAfter: money('15.00').negate(),
    })).toThrow(InconsistentLedgerEntryError);
    expect(() => entry({
      direction: LedgerDirection.Debit,
      money: money('10.00'),
      balanceBefore: money('5.00'),
      balanceAfter: money('5.00').negate(),
    })).toThrow(InconsistentLedgerEntryError);
  });

  test('rejects currency conflicts', () => {
    expect(() => entry({ balanceAfter: money('30.00', 'USD') })).toThrow(CurrencyMismatchError);
  });

  test('has no mutable state or mutation methods', () => {
    const ledger = entry();
    expect(Object.isFrozen(ledger)).toBe(true);
    expect('markProcessed' in ledger).toBe(false);
    const timestamp = ledger.createdAt;
    timestamp.setUTCFullYear(2000);
    expect(ledger.createdAt.getUTCFullYear()).not.toBe(2000);
  });
});
