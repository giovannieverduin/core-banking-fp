import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { CommandError } from '../domain/commands.js';
import { UnknownAccountError } from '../ledger/balance-projection.js';
import { ConcurrencyError } from '../events/event-store.js';
import { TransferInputError } from '../transactions/transfer.js';
import { SettlementInputError } from '../settlement/commands.js';
import {
  CurrencyMismatchError,
  InvalidMoneyError,
} from '../domain/money.js';
import { AccountReplayError } from '../domain/account.js';
import { BooksUnbalancedError } from '../ledger/trial-balance.js';
import { UnbalancedJournalError } from '../ledger/entry.js';

export interface ApiErrorBody {
  readonly error: string;
  readonly message: string;
  readonly details?: unknown;
}

export function sendError(
  reply: FastifyReply,
  status: number,
  error: string,
  message: string,
  details?: unknown,
): FastifyReply {
  const body: ApiErrorBody = details === undefined
    ? { error, message }
    : { error, message, details };
  return reply.status(status).send(body);
}

export function handleError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof ZodError) {
    return sendError(reply, 400, 'validation_error', 'Request did not validate', err.flatten());
  }
  if (err instanceof TransferInputError) {
    return sendError(reply, 400, 'transfer_input_error', err.message);
  }
  if (err instanceof SettlementInputError) {
    return sendError(reply, 400, 'settlement_input_error', err.message);
  }
  if (err instanceof CommandError) {
    return sendError(reply, 400, 'command_error', err.message);
  }
  if (err instanceof InvalidMoneyError || err instanceof CurrencyMismatchError) {
    return sendError(reply, 400, 'money_error', err.message);
  }
  if (err instanceof UnknownAccountError) {
    return sendError(reply, 404, 'unknown_account', err.message);
  }
  if (err instanceof ConcurrencyError) {
    return sendError(reply, 409, 'concurrency_conflict', err.message);
  }
  if (err instanceof AccountReplayError) {
    return sendError(reply, 500, 'replay_error', err.message);
  }
  if (err instanceof BooksUnbalancedError) {
    return sendError(reply, 500, 'books_unbalanced', err.message);
  }
  if (err instanceof UnbalancedJournalError) {
    return sendError(reply, 500, 'unbalanced_journal', err.message);
  }
  const message = err instanceof Error ? err.message : 'Unknown error';
  return sendError(reply, 500, 'internal_error', message);
}
