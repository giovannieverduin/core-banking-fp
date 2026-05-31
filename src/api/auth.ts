import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AccountId } from '../domain/account-id.js';

export interface IssuedKey {
  readonly accountId: AccountId;
  readonly apiKey: string;
}

export type AuthResult =
  | { readonly ok: true; readonly accountId: AccountId }
  | { readonly ok: false; readonly reason: string };

export class ApiKeyStore {
  private readonly byAccount = new Map<AccountId, string>();
  private readonly byKeyHash = new Map<string, AccountId>();

  issue(accountId: AccountId): IssuedKey {
    if (this.byAccount.has(accountId)) {
      throw new Error(`API key already issued for ${accountId}`);
    }
    const apiKey = randomBytes(32).toString('hex');
    const hash = hashKey(apiKey);
    this.byAccount.set(accountId, hash);
    this.byKeyHash.set(hash, accountId);
    return { accountId, apiKey };
  }

  resolve(apiKey: string): AccountId | null {
    const hash = hashKey(apiKey);
    return this.byKeyHash.get(hash) ?? null;
  }
}

export class AdminKeyStore {
  private readonly hashes = new Set<string>();

  constructor(adminKeys: readonly string[]) {
    if (adminKeys.length === 0) {
      throw new Error('AdminKeyStore requires at least one admin key');
    }
    for (const k of adminKeys) this.hashes.add(hashKey(k));
  }

  matches(apiKey: string): boolean {
    const hash = hashKey(apiKey);
    for (const stored of this.hashes) {
      if (constantTimeEqual(hash, stored)) return true;
    }
    return false;
  }
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader);
  return match ? (match[1] ?? null) : null;
}

export function authenticateAccount(
  store: ApiKeyStore,
  authHeader: string | undefined,
): AuthResult {
  const token = extractBearerToken(authHeader);
  if (!token) return { ok: false, reason: 'Missing or malformed Authorization header' };
  const accountId = store.resolve(token);
  if (!accountId) return { ok: false, reason: 'Unknown API key' };
  return { ok: true, accountId };
}

function hashKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
