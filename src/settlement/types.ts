import { z } from 'zod';
import type { AccountId } from '../domain/account-id.js';
import type { Currency } from '../domain/currency.js';
import type { Money } from '../domain/money.js';

export const SETTLEMENT_RAILS = ['MOCK', 'EVM', 'SWIFT', 'SEPA'] as const;
export type SettlementRail = (typeof SETTLEMENT_RAILS)[number];
export const SettlementRailSchema = z.enum(SETTLEMENT_RAILS);

export const SETTLEMENT_CYCLES = ['T+0', 'T+1', 'T+2'] as const;
export type SettlementCycle = (typeof SETTLEMENT_CYCLES)[number];
export const SettlementCycleSchema = z.enum(SETTLEMENT_CYCLES);

declare const settlementIdBrand: unique symbol;
export type SettlementId = string & { readonly [settlementIdBrand]: true };

export interface ExternalAccountRef {
  readonly rail: SettlementRail;
  readonly identifier: string;
}

export const ExternalAccountRefSchema = z.object({
  rail: SettlementRailSchema,
  identifier: z.string().min(1, 'external identifier must not be empty'),
});

export type SettlementDirection = 'outbound' | 'inbound';

export interface SettlementInstruction {
  readonly instructionId: SettlementId;
  readonly internalAccountId: AccountId;
  readonly externalAccount: ExternalAccountRef;
  readonly amount: Money;
  readonly direction: SettlementDirection;
  readonly cycle: SettlementCycle;
}

export type SettlementResult =
  | {
      readonly status: 'settled';
      readonly settledAt: string;
      readonly externalRef: string;
    }
  | {
      readonly status: 'failed';
      readonly settledAt: string;
      readonly reason: string;
    };
