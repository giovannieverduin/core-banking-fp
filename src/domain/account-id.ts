import { randomUUID } from 'node:crypto';
import { z } from 'zod';

declare const accountIdBrand: unique symbol;
export type AccountId = string & { readonly [accountIdBrand]: true };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const AccountIdSchema = z
  .string()
  .regex(UUID_RE, 'AccountId must be a UUID v4 string')
  .transform((s) => s.toLowerCase() as AccountId);

export function newAccountId(): AccountId {
  return randomUUID() as AccountId;
}

export function parseAccountId(value: string): AccountId {
  return AccountIdSchema.parse(value);
}
