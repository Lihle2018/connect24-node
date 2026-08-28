/**
 * Proving a webhook request really came from Connect24.
 *
 * Your webhook URL is public, so anyone can POST to it. Without verification, anyone could tell
 * your system that a message bounced, that a customer unsubscribed, or that an invoice was paid.
 * **Verify every request before acting on it.**
 *
 * Two things are easy to get wrong and both fail silently:
 *
 * 1. Verify against the **raw request body**, byte for byte as received. Parsing JSON and
 *    re-serialising changes whitespace and key order, and the signature no longer matches.
 * 2. Read the body **before** your framework parses it. In Express that means
 *    `express.raw({ type: 'application/json' })` on this route — not `express.json()`.
 *
 * An Express receiver, in full:
 *
 * ```ts
 * app.post(
 *   '/hooks/connect24',
 *   express.raw({ type: 'application/json' }),   // raw body, not express.json()
 *   (req, res) => {
 *     const signature = req.header('X-Connect24-Signature') ?? '';
 *     if (!verifySignature(req.body, signature, process.env.WEBHOOK_SECRET!)) {
 *       return res.sendStatus(401);
 *     }
 *
 *     const event = parseWebhookEvent(req.body);
 *     // Acknowledge fast — anything that is not 2xx is retried.
 *     res.sendStatus(200);
 *   },
 * );
 * ```
 *
 * Delivery is at-least-once, so deduplicate on `event.id`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookEvent } from './models.js';

/**
 * How old a delivery may be and still be accepted. Five minutes leaves room for clock drift and a
 * slow network, while stopping a captured request from being replayed hours later.
 */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Whether a webhook request is authentic and recent.
 *
 * @param payload The raw request body, exactly as received.
 * @param signatureHeader The `X-Connect24-Signature` header, `t=1770000000,v1=abc123…`.
 * @param secret The endpoint's signing secret (`whsec_…`). Keep it out of source control.
 * @param toleranceSeconds How old the delivery may be. Pass `0` to skip the age check — only
 *   sensible when replaying a captured request in a test.
 *
 * Never throws. A malformed header from an attacker returns false rather than becoming a 500,
 * because an exception here would turn a forged request into an outage.
 */
export function verifySignature(
  payload: string | Buffer | Uint8Array,
  signatureHeader: string,
  secret: string,
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
): boolean {
  if (!payload || !payload.length || !signatureHeader || !secret) {
    return false;
  }

  const parsed = parseHeader(signatureHeader);
  if (!parsed) {
    return false;
  }

  const { timestamp, signature } = parsed;

  if (toleranceSeconds > 0) {
    const age = Date.now() / 1000 - timestamp;
    // Absolute, so a delivery stamped in the future — a forged request, or badly skewed clocks —
    // is refused too.
    if (Math.abs(age) > toleranceSeconds) {
      return false;
    }
  }

  const body = typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8');
  const expected = compute(secret, timestamp, body);

  // timingSafeEqual, not ===: a plain comparison stops at the first differing character, and the
  // time that takes leaks how much of the signature an attacker has guessed correctly.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** When Connect24 signed the delivery, in seconds, or null if the header is malformed. */
export function signatureTimestamp(signatureHeader: string): number | null {
  return parseHeader(signatureHeader)?.timestamp ?? null;
}

/**
 * Reads an event from a raw webhook body.
 *
 * Verify the signature first. Parsing an unverified body means acting on something anyone could
 * have posted to your public URL.
 */
export function parseWebhookEvent(payload: string | Buffer | Uint8Array): WebhookEvent {
  const text = typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8');
  const data = JSON.parse(text) as Record<string, unknown>;

  return {
    id: String(data.id ?? ''),
    type: String(data.type ?? ''),
    messageId: String(data.messageId ?? ''),
    createdAt: typeof data.createdAt === 'string' ? new Date(data.createdAt) : undefined,
    raw: data,
  };
}

function parseHeader(header: string): { timestamp: number; signature: string } | null {
  let timestamp = 0;
  let signature = '';

  for (const part of header.split(',')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (key === 't') {
      if (!/^\d+$/.test(value)) return null;
      timestamp = Number(value);
    } else if (key === 'v1') {
      signature = value;
    }
  }

  return timestamp > 0 && signature ? { timestamp, signature } : null;
}

/**
 * The HMAC covers `"{timestamp}.{payload}"`, not the payload alone.
 *
 * That is what stops a captured request being replayed indefinitely: the timestamp is inside the
 * signature, so an attacker cannot rewrite it to look recent without invalidating the whole thing.
 */
function compute(secret: string, timestamp: number, payload: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
}
