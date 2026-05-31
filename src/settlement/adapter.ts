import type {
  SettlementInstruction,
  SettlementRail,
  SettlementResult,
} from './types.js';

export interface SettlementAdapter {
  readonly rail: SettlementRail;
  submit(instruction: SettlementInstruction): Promise<SettlementResult>;
}

export class SettlementAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettlementAdapterError';
  }
}
