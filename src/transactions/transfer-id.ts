import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { TransferId } from '../events/types.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TransferIdSchema = z
  .string()
  .regex(UUID_RE, 'TransferId must be a UUID v4 string')
  .transform((s) => s.toLowerCase() as TransferId);

export function newTransferId(): TransferId {
  return randomUUID() as TransferId;
}

export function parseTransferId(value: string): TransferId {
  return TransferIdSchema.parse(value);
}
