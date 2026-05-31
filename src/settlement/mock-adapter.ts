import { randomUUID } from 'node:crypto';
import type { SettlementAdapter } from './adapter.js';
import type {
  SettlementInstruction,
  SettlementRail,
  SettlementResult,
} from './types.js';

export interface MockSettlementAdapterOptions {
  readonly rail?: SettlementRail;
  readonly failureIdentifiers?: ReadonlySet<string>;
  readonly externalRefPrefix?: string;
}

export class MockSettlementAdapter implements SettlementAdapter {
  readonly rail: SettlementRail;
  private readonly failureIdentifiers: ReadonlySet<string>;
  private readonly externalRefPrefix: string;
  private readonly submissions: SettlementInstruction[] = [];

  constructor(options: MockSettlementAdapterOptions = {}) {
    this.rail = options.rail ?? 'MOCK';
    this.failureIdentifiers = options.failureIdentifiers ?? new Set();
    this.externalRefPrefix = options.externalRefPrefix ?? 'mock-ref';
  }

  async submit(instruction: SettlementInstruction): Promise<SettlementResult> {
    this.submissions.push(instruction);
    const settledAt = new Date().toISOString();
    if (this.failureIdentifiers.has(instruction.externalAccount.identifier)) {
      return {
        status: 'failed',
        settledAt,
        reason: `mock adapter forced failure for ${instruction.externalAccount.identifier}`,
      };
    }
    return {
      status: 'settled',
      settledAt,
      externalRef: `${this.externalRefPrefix}-${randomUUID()}`,
    };
  }

  submissionCount(): number {
    return this.submissions.length;
  }

  lastSubmission(): SettlementInstruction | null {
    return this.submissions.at(-1) ?? null;
  }
}
