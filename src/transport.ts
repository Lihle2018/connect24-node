/**
 * Shared request plumbing.
 *
 * Not exported from the package root: the shape of a Connect24 call is not part of the public
 * surface, so it can change without breaking anyone.
 *
 * Built on the global `fetch`, which Node has had since 18 — so this package pulls in no HTTP
 * dependency at all. An SDK is a dependency of somebody else's application, and every package it
 * drags in is a version conflict that becomes theirs to resolve.
 */

import { Connect24ApiError, Connect24ConnectionError } from './errors.js';

const USER_AGENT = 'connect24-node';

/**
 * Statuses worth trying again. A 429 says the limit is temporary; 5xx says the fault was ours.
 * A 4xx means the request itself is wrong, and repeating it changes nothing.
 */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export interface TransportOptions {
  baseUrl: string;
  accountId: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  fetch?: typeof globalThis.fetch;
}

export class Transport {
  private readonly baseUrl: string;
  private readonly accountId: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: TransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.accountId = options.accountId;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
    this.maxRetries = options.maxRetries;
    this.fetchImpl = options.fetch ?? globalThis.fetch;

    if (typeof this.fetchImpl !== 'function') {
      throw new Error(
        'No fetch implementation found. Use Node 18 or newer, or pass one as `fetch` in the client options.',
      );
    }
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    return this.request<T>('POST', path, body, idempotencyKey);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  async delete(path: string): Promise<void> {
    await this.request<unknown>('DELETE', path);
  }

  // ------------------------------------------------------------------ internals

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const url = `${this.baseUrl}/${path.replace(/^\/+/, '')}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'X-Account-Id': this.accountId,
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    };

    let payload: string | undefined;
    if (body !== undefined && body !== null) {
      payload = JSON.stringify(withoutNulls(body));
      headers['Content-Type'] = 'application/json';
    }
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    for (let attempt = 0; ; attempt += 1) {
      // A timeout per attempt, not per call: a fresh signal each time, or the second attempt
      // inherits an already-aborted one and fails instantly.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(url, {
          method,
          headers,
          body: payload,
          signal: controller.signal,
        });

        const text = await response.text();

        if (!response.ok) {
          if (RETRYABLE.has(response.status) && attempt < this.maxRetries) {
            await sleep(backoffMs(attempt + 1));
            continue;
          }
          throw Connect24ApiError.fromResponse(response.status, text);
        }

        return (text.trim() ? JSON.parse(text) : undefined) as T;
      } catch (error) {
        if (error instanceof Connect24ApiError) {
          throw error;
        }

        // Everything else is a transport failure: the request never got an answer, so whether it
        // was applied is unknown. Retrying is safe only because callers can pass an idempotency
        // key — which is exactly what that argument is for.
        if (attempt < this.maxRetries) {
          await sleep(backoffMs(attempt + 1));
          continue;
        }

        const reason = error instanceof Error ? error.message : String(error);
        throw new Connect24ConnectionError(reason);
      } finally {
        clearTimeout(timer);
      }
    }
  }
}

/** Doubling, capped. Long enough to let a rate limit clear without stalling a request. */
function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 4000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drops null and undefined members before sending.
 *
 * The API treats an absent field and an explicit null differently in places — an absent `from`
 * means "use my account's assigned address", where a null would be an attempt to send from nothing.
 */
export function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutNulls);
  }

  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
      if (member !== null && member !== undefined) {
        result[key] = withoutNulls(member);
      }
    }
    return result;
  }

  return value;
}
