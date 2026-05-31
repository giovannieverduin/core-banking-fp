import { z } from 'zod';
import { CurrencySchema } from '../domain/currency.js';
import { AccountIdSchema } from '../domain/account-id.js';
import { TransferIdSchema } from '../transactions/transfer-id.js';

const DecimalAmountSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'amount must be a decimal string');

const MoneyBody = z.object({
  amount: DecimalAmountSchema,
  currency: CurrencySchema,
});

export const CreateAccountBody = z.object({
  owner: z.string().min(1, 'owner must not be empty'),
  currency: CurrencySchema,
});

export const DepositBody = MoneyBody.extend({
  reference: z.string().min(1, 'reference must not be empty'),
});

export const WithdrawBody = MoneyBody.extend({
  reference: z.string().min(1, 'reference must not be empty'),
  overdraftLimit: DecimalAmountSchema.optional(),
});

export const TransferBody = MoneyBody.extend({
  fromAccountId: AccountIdSchema,
  toAccountId: AccountIdSchema,
  transferId: TransferIdSchema.optional(),
  overdraftLimit: DecimalAmountSchema.optional(),
});

export const AccountIdParam = z.object({
  id: AccountIdSchema,
});

export const TransferIdParam = z.object({
  transferId: TransferIdSchema,
});

export type CreateAccountBodyT = z.infer<typeof CreateAccountBody>;
export type DepositBodyT = z.infer<typeof DepositBody>;
export type WithdrawBodyT = z.infer<typeof WithdrawBody>;
export type TransferBodyT = z.infer<typeof TransferBody>;
