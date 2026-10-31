import { describe, expect, test } from 'bun:test';
import { CurrencyMismatchError, InvalidMoneyError, Money } from '../../src/domain/money';
describe('Money', () => {
  test('preserves exact decimal arithmetic and fixed scale', () => {
    const result = Money.from({ amount: '100.00', currency: 'BRL' }).subtract(Money.from({ amount: '0.10', currency: 'BRL' })).subtract(Money.from({ amount: '0.20', currency: 'BRL' }));
    expect(result.toJSON()).toEqual({ amount: '99.70', currency: 'BRL' });
  });
  test('rejects non-contract input', () => { for (const amount of ['1', '1.000', '-1.00', '1e2', '', 'Infinity']) expect(() => Money.from({ amount, currency: 'BRL' })).toThrow(InvalidMoneyError); });
  test('rejects mixing currencies', () => { expect(() => Money.from({ amount: '1.00', currency: 'BRL' }).add(Money.from({ amount: '1.00', currency: 'USD' }))).toThrow(CurrencyMismatchError); });
});
