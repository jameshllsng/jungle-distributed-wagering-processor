import Decimal from 'decimal.js';
export interface MoneyProps { amount: string; currency: string; }
export class InvalidMoneyError extends Error { constructor(message: string) { super(message); this.name = 'InvalidMoneyError'; } }
export class CurrencyMismatchError extends Error { constructor(left: string, right: string) { super(`Currency mismatch: ${left} and ${right}`); this.name = 'CurrencyMismatchError'; } }
/** Immutable decimal money value. Public input is a non-negative fixed-scale string. */
export class Money {
  private static readonly inputPattern = /^(?:0|[1-9]\d*)\.\d{2}$/u;
  private constructor(private readonly value: Decimal, public readonly currency: string) {}
  static from(props: MoneyProps): Money {
    if (!Money.inputPattern.test(props.amount)) throw new InvalidMoneyError('Amount must be a non-negative decimal string with exactly two fraction digits');
    if (!/^[A-Z]{3}$/u.test(props.currency)) throw new InvalidMoneyError('Currency must be a three-letter ISO-4217 code');
    return Money.fromDecimal(new Decimal(props.amount), props.currency);
  }
  static zero(currency: string): Money { return Money.from({ amount: '0.00', currency }); }
  add(other: Money): Money { this.assertSameCurrency(other); return Money.fromDecimal(this.value.plus(other.value), this.currency); }
  subtract(other: Money): Money { this.assertSameCurrency(other); return Money.fromDecimal(this.value.minus(other.value), this.currency); }
  negate(): Money { return Money.fromDecimal(this.value.negated(), this.currency); }
  isZero(): boolean { return this.value.isZero(); }
  isPositive(): boolean { return this.value.isPositive(); }
  isNegative(): boolean { return this.value.isNegative(); }
  isLessThan(other: Money): boolean { this.assertSameCurrency(other); return this.value.lessThan(other.value); }
  equals(other: Money): boolean { this.assertSameCurrency(other); return this.value.equals(other.value); }
  toJSON(): MoneyProps { return { amount: this.value.toFixed(2), currency: this.currency }; }
  toString(): string { return `${this.value.toFixed(2)} ${this.currency}`; }
  private static fromDecimal(value: Decimal, currency: string): Money { if (!value.isFinite() || value.decimalPlaces() > 2) throw new InvalidMoneyError('Money must be finite and have at most two fraction digits'); return new Money(value, currency); }
  private assertSameCurrency(other: Money): void { if (this.currency !== other.currency) throw new CurrencyMismatchError(this.currency, other.currency); }
}
