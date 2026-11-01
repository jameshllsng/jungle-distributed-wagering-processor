import { describe, expect, test } from 'bun:test';
import { CurrencyMismatchError, InvalidMoneyError, Money } from '../../src/domain/money';
describe('Money', () => {
  test('preserves exact decimal arithmetic and fixed scale', () => {
    const result = Money.from({ amount: '100.00', currency: 'BRL' }).subtract(Money.from({ amount: '0.10', currency: 'BRL' })).subtract(Money.from({ amount: '0.20', currency: 'BRL' }));
    expect(result.toJSON()).toEqual({ amount: '99.70', currency: 'BRL' });
  });
  test('rejects non-contract input', () => { for (const amount of ['1', '1.000', '-1.00', '1e2', '', 'Infinity']) expect(() => Money.from({ amount, currency: 'BRL' })).toThrow(InvalidMoneyError); });
  test('rejects mixing currencies', () => { expect(() => Money.from({ amount: '1.00', currency: 'BRL' }).add(Money.from({ amount: '1.00', currency: 'USD' }))).toThrow(CurrencyMismatchError); });
  test('supports comparisons, negation and JSON serialization without mutation', () => {
    const amount = Money.from({ amount: '10.00', currency: 'BRL' });
    const smaller = Money.from({ amount: '9.99', currency: 'BRL' });
    expect(amount.isPositive()).toBe(true);
    expect(amount.isZero()).toBe(false);
    expect(Money.zero('BRL').isPositive()).toBe(false);
    expect(amount.isLessThan(smaller)).toBe(false);
    expect(amount.negate().toJSON()).toEqual({ amount: '-10.00', currency: 'BRL' });
    expect(Money.zero('BRL').toString()).toBe('0.00 BRL');
    expect(amount.toJSON()).toEqual({ amount: '10.00', currency: 'BRL' });
  });
  test('rejects malformed currency and preserves two decimal scale after arithmetic', () => {
    expect(() => Money.from({ amount: '1.00', currency: 'brl' })).toThrow(InvalidMoneyError);
    expect(Money.from({ amount: '1.10', currency: 'BRL' }).add(Money.from({ amount: '2.20', currency: 'BRL' })).toJSON())
      .toEqual({ amount: '3.30', currency: 'BRL' });
  });
});
