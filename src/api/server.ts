import Fastify, { type FastifyInstance } from 'fastify';
import {
  createAccount,
  depositMoney,
  withdrawMoney,
} from '../domain/commands.js';
import { Money } from '../domain/money.js';
import type { EventStore } from '../events/event-store.js';
import { balanceOf } from '../ledger/balance-projection.js';
import {
  HardRejectPolicy,
  fixedLimitPolicy,
  type OverdraftPolicy,
} from '../ledger/overdraft-policy.js';
import { executeTransfer } from '../transactions/transfer.js';
import { reconcile } from '../reconciliation/reconcile.js';
import {
  AdminKeyStore,
  ApiKeyStore,
  authenticateAccount,
  extractBearerToken,
} from './auth.js';
import { handleError, sendError } from './errors.js';
import {
  AccountIdParam,
  CreateAccountBody,
  DepositBody,
  TransferBody,
  TransferIdParam,
  WithdrawBody,
} from './schemas.js';

export interface BuildAppOptions {
  readonly store: EventStore;
  readonly adminApiKeys: readonly string[];
  readonly apiKeys?: ApiKeyStore;
  readonly logger?: boolean;
}

export interface AppContext {
  readonly app: FastifyInstance;
  readonly apiKeys: ApiKeyStore;
  readonly adminKeys: AdminKeyStore;
}

export function buildApp(options: BuildAppOptions): AppContext {
  const apiKeys = options.apiKeys ?? new ApiKeyStore();
  const adminKeys = new AdminKeyStore(options.adminApiKeys);
  const app = Fastify({ logger: options.logger ?? false });
  const store = options.store;

  function resolveOverdraftPolicy(
    limitStr: string | undefined,
    currency: Money['currency'],
  ): OverdraftPolicy {
    if (!limitStr) return HardRejectPolicy;
    return fixedLimitPolicy(Money.of(limitStr, currency));
  }

  app.post('/accounts', async (request, reply) => {
    try {
      const body = CreateAccountBody.parse(request.body);
      const accountId = await createAccount(store, {
        owner: body.owner,
        currency: body.currency,
      });
      const issued = apiKeys.issue(accountId);
      return reply.status(201).send({
        accountId,
        owner: body.owner,
        currency: body.currency,
        apiKey: issued.apiKey,
      });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/accounts/:id/balance', async (request, reply) => {
    try {
      const params = AccountIdParam.parse(request.params);
      const auth = authenticateAccount(apiKeys, request.headers.authorization);
      if (!auth.ok) return sendError(reply, 401, 'unauthorized', auth.reason);
      if (auth.accountId !== params.id) {
        return sendError(reply, 403, 'forbidden', 'API key does not match account');
      }
      const balance = await balanceOf(store, params.id);
      return reply.send({ accountId: params.id, balance: balance.toJSON() });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/accounts/:id/deposits', async (request, reply) => {
    try {
      const params = AccountIdParam.parse(request.params);
      const body = DepositBody.parse(request.body);
      const auth = authenticateAccount(apiKeys, request.headers.authorization);
      if (!auth.ok) return sendError(reply, 401, 'unauthorized', auth.reason);
      if (auth.accountId !== params.id) {
        return sendError(reply, 403, 'forbidden', 'API key does not match account');
      }
      await depositMoney(store, {
        accountId: params.id,
        amount: Money.of(body.amount, body.currency),
        reference: body.reference,
      });
      const balance = await balanceOf(store, params.id);
      return reply.status(201).send({
        accountId: params.id,
        balance: balance.toJSON(),
      });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/accounts/:id/withdrawals', async (request, reply) => {
    try {
      const params = AccountIdParam.parse(request.params);
      const body = WithdrawBody.parse(request.body);
      const auth = authenticateAccount(apiKeys, request.headers.authorization);
      if (!auth.ok) return sendError(reply, 401, 'unauthorized', auth.reason);
      if (auth.accountId !== params.id) {
        return sendError(reply, 403, 'forbidden', 'API key does not match account');
      }
      const policy = resolveOverdraftPolicy(body.overdraftLimit, body.currency);
      await withdrawMoney(store, {
        accountId: params.id,
        amount: Money.of(body.amount, body.currency),
        reference: body.reference,
        overdraftPolicy: policy,
      });
      const balance = await balanceOf(store, params.id);
      return reply.status(201).send({
        accountId: params.id,
        balance: balance.toJSON(),
      });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/transfers', async (request, reply) => {
    try {
      const body = TransferBody.parse(request.body);
      const auth = authenticateAccount(apiKeys, request.headers.authorization);
      if (!auth.ok) return sendError(reply, 401, 'unauthorized', auth.reason);
      if (auth.accountId !== body.fromAccountId) {
        return sendError(
          reply,
          403,
          'forbidden',
          'API key must match the source account',
        );
      }
      const policy = resolveOverdraftPolicy(body.overdraftLimit, body.currency);
      const outcome = await executeTransfer(store, {
        fromAccountId: body.fromAccountId,
        toAccountId: body.toAccountId,
        amount: Money.of(body.amount, body.currency),
        transferId: body.transferId,
        overdraftPolicy: policy,
      });
      const status = outcome.status === 'completed' ? 201 : 422;
      return reply.status(status).send(outcome);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/transfers/:transferId', async (request, reply) => {
    try {
      const params = TransferIdParam.parse(request.params);
      const auth = authenticateAccount(apiKeys, request.headers.authorization);
      if (!auth.ok) return sendError(reply, 401, 'unauthorized', auth.reason);
      const events = await store.readStream(auth.accountId);
      const match = events.find((e) => {
        const p = e.payload;
        return (
          (p.type === 'TransferInitiated' ||
            p.type === 'TransferReceived' ||
            p.type === 'TransferCompleted' ||
            p.type === 'TransferFailed' ||
            p.type === 'TransferRejected') &&
          p.transferId === params.transferId
        );
      });
      if (!match) {
        return sendError(reply, 404, 'unknown_transfer', `No transfer ${params.transferId} on caller's account`);
      }
      const terminal = events.find((e) => {
        const p = e.payload;
        return (
          (p.type === 'TransferCompleted' ||
            p.type === 'TransferFailed' ||
            p.type === 'TransferRejected') &&
          p.transferId === params.transferId
        );
      });
      if (!terminal) {
        return reply.send({ transferId: params.transferId, status: 'in_flight' });
      }
      if (terminal.payload.type === 'TransferCompleted') {
        return reply.send({ transferId: params.transferId, status: 'completed' });
      }
      const reason =
        terminal.payload.type === 'TransferFailed' ||
        terminal.payload.type === 'TransferRejected'
          ? terminal.payload.reason
          : '';
      return reply.send({
        transferId: params.transferId,
        status: 'rejected',
        reason,
      });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/admin/reconcile', async (request, reply) => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token || !adminKeys.matches(token)) {
      return sendError(reply, 401, 'unauthorized', 'Admin key required');
    }
    try {
      const report = await reconcile(store);
      return reply.send({
        ok: report.ok,
        integrity: {
          ok: report.integrity.ok,
          eventsChecked: report.integrity.eventsChecked,
          errors: report.integrity.errors,
        },
        trialBalance: report.trialBalance.map((row) => ({
          currency: row.currency,
          debit: row.debit.toJSON(),
          credit: row.credit.toJSON(),
          difference: row.difference.toJSON(),
        })),
        findings: report.findings,
      });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  return { app, apiKeys, adminKeys };
}
