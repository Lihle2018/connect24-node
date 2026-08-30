import { Transport } from './transport.js';
import { Account } from './resources/account.js';
import { Billing } from './resources/billing.js';
import { Messages } from './resources/messages.js';
import { SendingDomains } from './resources/sendingDomains.js';
import { Suppressions } from './resources/suppressions.js';
import { Templates } from './resources/templates.js';
import { Webhooks } from './resources/webhooks.js';

/** Where the API lives. Override with `baseUrl` to point at a sandbox. */
export const DEFAULT_BASE_URL = 'https://api.connect24.co.za';

export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Retries apply to rate limits, 5xx and connection failures — never to a 4xx, which would fail
 * identically however many times it is repeated.
 */
export const DEFAULT_MAX_RETRIES = 2;

export interface Connect24Options {
  accountId: string;
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Supply your own fetch — for tests, or for a runtime without a global one. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Entry point to the Connect24 communications API. Create one and reuse it.
 *
 * Both credentials come from the portal, under **Settings -> API keys**. The account id (`acc_...`)
 * is safe to commit; the key (`ck_live_...`) is a secret and belongs in an environment variable or
 * a secret store, never in source control — anyone holding it can send messages billed to you and
 * attributed to you.
 *
 * ```ts
 * import { Connect24 } from '@connect24/sdk';
 *
 * const client = new Connect24({
 *   accountId: 'acc_3f9c1a7b4e2d',
 *   apiKey: process.env.CONNECT24_API_KEY!,
 * });
 *
 * await client.messages.sendSms('+27821234567', 'Your order has shipped.');
 * ```
 *
 * Or read both from the environment, which is what most deployments want:
 *
 * ```ts
 * const client = Connect24.fromEnv();
 * ```
 */
export class Connect24 {
  readonly accountId: string;

  /** Send messages, and read back what happened to them. */
  readonly messages: Messages;
  /** Stored bodies with placeholders. */
  readonly templates: Templates;
  /** Addresses that will not be sent to. */
  readonly suppressions: Suppressions;
  /** Delivery events pushed to you. */
  readonly webhooks: Webhooks;
  /** Domains you have proved you control. */
  readonly sendingDomains: SendingDomains;
  /** Prepaid credit and the statement. */
  readonly billing: Billing;
  /** Who you are, and which channels can send right now. */
  readonly account: Account;

  constructor(options: Connect24Options) {
    if (!options?.accountId) {
      throw new TypeError('accountId is required — find it in the portal under Settings -> API keys.');
    }
    if (!options.apiKey) {
      throw new TypeError('apiKey is required — find it in the portal under Settings -> API keys.');
    }

    const transport = new Transport({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      accountId: options.accountId,
      apiKey: options.apiKey,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      fetch: options.fetch,
    });

    this.accountId = options.accountId;
    this.messages = new Messages(transport);
    this.templates = new Templates(transport);
    this.suppressions = new Suppressions(transport);
    this.webhooks = new Webhooks(transport);
    this.sendingDomains = new SendingDomains(transport);
    this.billing = new Billing(transport);
    this.account = new Account(transport);
  }

  /**
   * Builds a client from `CONNECT24_ACCOUNT_ID` and `CONNECT24_API_KEY`.
   *
   * `CONNECT24_BASE_URL` is honoured too, which is how a staging deployment points elsewhere
   * without a code change.
   */
  static fromEnv(options: Partial<Connect24Options> = {}): Connect24 {
    const accountId = options.accountId ?? process.env.CONNECT24_ACCOUNT_ID ?? '';
    const apiKey = options.apiKey ?? process.env.CONNECT24_API_KEY ?? '';

    const missing = [
      !accountId && 'CONNECT24_ACCOUNT_ID',
      !apiKey && 'CONNECT24_API_KEY',
    ].filter(Boolean);

    if (missing.length) {
      throw new Error(`Missing environment variable(s): ${missing.join(', ')}.`);
    }

    return new Connect24({
      ...options,
      accountId,
      apiKey,
      baseUrl: options.baseUrl ?? process.env.CONNECT24_BASE_URL ?? DEFAULT_BASE_URL,
    });
  }

  /** The key is deliberately absent: a client that prints its own credential ends up in a log. */
  toJSON(): Record<string, unknown> {
    return { accountId: this.accountId };
  }
}
