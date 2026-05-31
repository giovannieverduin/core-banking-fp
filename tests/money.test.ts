import { describe, expect, it } from 'vitest';
import {
  CurrencyMismatchError,
  InvalidMoneyError,
  Money,
} from '../src/domain/money.js';

describe('Money', () => {
  it('constructs from a string and preserves precision', () => {
    const m = Money.of('100.005', 'USD');
    expect(m.amount.toFixed()).toBe('100.005');
    expect(m.currency).toBe('USD');
  });

  it('rejects non-finite amounts', () => {
    expect(() => Money.of(Infinity, 'USD')).toThrow(InvalidMoneyError);
    expect(() => Money.of(NaN, 'USD')).toThrow();
  });

  it('avoids float drift on classic 0.1 + 0.2', () => {
    const sum = Money.of('0.1', 'USD').add(Money.of('0.2', 'USD'));
    expect(sum.equals(Money.of('0.3', 'USD'))).toBe(true);
  });

  it('subtracts, allowing negative result', () => {
    const diff = Money.of(5, 'USD').subtract(Money.of(8, 'USD'));
    expect(diff.equals(Money.of(-3, 'USD'))).toBe(true);
    expect(diff.isNegative()).toBe(true);
  });

  it('refuses mixed-currency arithmetic', () => {
    const usd = Money.of(10, 'USD');
    const eur = Money.of(10, 'EUR');
    expect(() => usd.add(eur)).toThrow(CurrencyMismatchError);
    expect(() => usd.gt(eur)).toThrow(CurrencyMismatchError);
  });

  it('compares amounts in the same currency', () => {
    const a = Money.of(10, 'USD');
    const b = Money.of('10.00', 'USD');
    const c = Money.of(11, 'USD');
    expect(a.equals(b)).toBe(true);
    expect(c.gt(a)).toBe(true);
    expect(a.lt(c)).toBe(true);
    expect(a.gte(b)).toBe(true);
  });

  it('treats equal-amount different-currency as unequal', () => {
    expect(Money.of(10, 'USD').equals(Money.of(10, 'EUR'))).toBe(false);
  });

  it('serializes to a stable string and JSON', () => {
    const m = Money.of('1.23', 'EUR');
    expect(m.toString()).toBe('1.23 EUR');
    expect(m.toJSON()).toEqual({ amount: '1.23', currency: 'EUR' });
  });
});
