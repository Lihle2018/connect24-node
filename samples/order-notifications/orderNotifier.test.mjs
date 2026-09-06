/**
 * These tests run the notifier through the REAL SDK with a stubbed `fetch`, so they verify
 * what actually goes on the wire — payloads, headers, idempotency keys — without a network
 * or an API key. Run them with `npm test` in this folder.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { Connect24 } from '@connect24/sdk';
import { OrderNotifier, OutOfCreditError } from './orderNotifier.mjs';

/** Records every request the SDK makes and replies with whatever the test queued. */
function stubClient(responses) {
  const calls = [];
  const queue = Array.isArray(responses) ? [...responses] : [responses];

  const client = new Connect24({
    accountId: 'acc_1',
    apiKey: 'ck_test_secret',
    maxRetries: 0,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : null });
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return { ok: (next.status ?? 200) < 400, status: next.status ?? 200, text: async () => next.body ?? '{}' };
    },
  });

  return { client, calls };
}

const order = {
  id: '1042',
  customerName: 'Thandi',
  email: 'thandi@example.co.za',
  phone: '+27821234567',
  trackingUrl: 'https://store.example/track/1042',
};

describe('notifyShipped', () => {
  it('sends the email and the SMS with idempotency keys tied to the order', async () => {
    const { client, calls } = stubClient({ body: JSON.stringify({ id: 'msg_1', status: 'queued' }) });

    const result = await new OrderNotifier(client).notifyShipped(order);

    assert.equal(result.email.status, 'sent');
    assert.equal(result.sms.status, 'sent');
    assert.equal(calls.length, 2);

    const [email, sms] = calls;
    assert.equal(email.body.channel, 'Email');
    assert.equal(email.body.to, order.email);
    assert.match(email.body.content.html, /1042/);
    assert.equal(email.init.headers['Idempotency-Key'], 'order-1042-shipped-email');

    assert.equal(sms.body.channel, 'Sms');
    assert.equal(sms.body.to, order.phone);
    assert.equal(sms.init.headers['Idempotency-Key'], 'order-1042-shipped-sms');
  });

  it('skips the SMS when there is no phone on file, without calling the API', async () => {
    const { client, calls } = stubClient({ body: JSON.stringify({ id: 'msg_1' }) });

    const result = await new OrderNotifier(client).notifyShipped({ ...order, phone: undefined });

    assert.equal(result.sms.status, 'skipped');
    assert.equal(calls.length, 1); // only the email went out
  });

  it('treats a suppressed recipient (403) as a skip, not a failure', async () => {
    const { client } = stubClient([
      { status: 403, body: JSON.stringify({ error: 'That recipient is on your suppression list and cannot be contacted.' }) },
      { body: JSON.stringify({ id: 'msg_2', status: 'queued' }) },
    ]);

    const result = await new OrderNotifier(client).notifyShipped(order);

    assert.equal(result.email.status, 'skipped');
    assert.match(result.email.reason, /suppression list/);
    assert.equal(result.sms.status, 'sent'); // one refused channel must not block the other
  });

  it('surfaces an empty balance as OutOfCreditError', async () => {
    const { client } = stubClient({ status: 402, body: JSON.stringify({ error: 'Insufficient credit.' }) });

    await assert.rejects(
      () => new OrderNotifier(client).notifyShipped(order),
      OutOfCreditError,
    );
  });

  it('lets unexpected errors escape so the caller can retry with the same keys', async () => {
    const { client } = stubClient({ status: 500, body: JSON.stringify({ error: 'boom' }) });

    await assert.rejects(() => new OrderNotifier(client).notifyShipped(order), /boom/);
  });
});
