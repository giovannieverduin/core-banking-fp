import Decimal from 'decimal.js';
import { CurrencySchema, type Currency } from './currency.js';

Decimal.set({ precision: 38, rounding: Decimal.ROUND_HALF_EVEN });

export class CurrencyMismatchError extends Error {
  constructor(left: Currency, right: Currency) {
    super(`Currency mismatch: ${left} vs ${right}`);
    this.name = 'CurrencyMismatchError';
  }
}

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

export class Money {
  readonly amount: Decimal;
  readonly currency: Currency;

  private constructor(amount: Decimal, currency: Currency) {
    this.amount = amount;
    this.currency = currency;
  }

  static of(amount: Decimal.Value, currency: Currency): Money {
    CurrencySchema.parse(currency);
    let decimal: Decimal;
    try {
      decimal = new Decimal(amount);
    } catch {
      throw new InvalidMoneyError(`Cannot parse amount: ${String(amount)}`);
    }
    if (!decimal.isFinite()) {
      throw new InvalidMoneyError(`Amount must be finite: ${decimal.toString()}`);
    }
    return new Money(decimal, currency);
  }

  static zero(currency: Currency): Money {
    return Money.of(0, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.minus(other.amount), this.currency);
  }

  negate(): Money {
    return new Money(this.amount.negated(), this.currency);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.eq(other.amount);
  }

  gt(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount.gt(other.amount);
  }

  gte(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount.gte(other.amount);
  }

  lt(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount.lt(other.amount);
  }

  lte(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount.lte(other.amount);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative();
  }

  isPositive(): boolean {
    return this.amount.isPositive() && !this.amount.isZero();
  }

  toString(): string {
    return `${this.amount.toFixed()} ${this.currency}`;
  }

  toJSON(): { amount: string; currency: Currency } {
    return { amount: this.amount.toFixed(), currency: this.currency };
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
