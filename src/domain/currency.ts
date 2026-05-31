import { z } from 'zod';

export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'AED', 'GBP'] as const;

export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export const CurrencySchema = z.enum(SUPPORTED_CURRENCIES);

export function isCurrency(value: unknown): value is Currency {
  return CurrencySchema.safeParse(value).success;
}
