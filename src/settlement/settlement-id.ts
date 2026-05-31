import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SettlementId } from './types.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SettlementIdSchema = z
  .string()
  .regex(UUID_RE, 'SettlementId must be a UUID v4 string')
  .transform((s) => s.toLowerCase() as SettlementId);

export function newSettlementId(): SettlementId {
  return randomUUID() as SettlementId;
}

export function parseSettlementId(value: string): SettlementId {
  return SettlementIdSchema.parse(value);
}
