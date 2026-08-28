/** The client and its transport, driven with a stub fetch so nothing touches the network. */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { Connect24, Connect24ApiError, Connect24ConnectionError, isDelivered, isFailed, isInFlight, chosenByRecipient } from '../dist/index.js';

/** Records what the SDK sent, and replies with whatever the test lines up. */
function stub(responses) {
  const calls = [];
  const queue = Array.isArray(responses) ? [...responses] : [responses];

  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift() : queue[0];

    if (next instanceof Error) throw next;

    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      text: async () => next.body ?? '',
    };
  };

  return { fetchImpl, calls };
}

function client(responses, options = {}) {
  const { fetchImpl, calls } = stub(responses);
  return {
    calls,
    client: new Connect24({
      accountId: 'acc_1',
      apiKey: 'ck_live_secret',
      fetch: fetchImpl,
      maxRetries: 0,
      ...options,
    }),
  };
}

describe('construction', () => {
  it('requires both credentials', () => {
    assert.throws(() => new Connect24({ accountId: '', apiKey: 'ck' }), /accountId/);
    assert.throws(() => new Connect24({ accountId: 'acc_1', apiKey: '' }), /apiKey/);
  });

  it('exposes every resource', () => {
    const { client: c } = client({ body: '{}' });

    for (const name of ['messages', 'templates', 'suppressions', 'webhooks', 'sendingDomains', 'billing', 'account']) {
      assert.ok(c[name], name);
    }
  });

  it('does not leak the key when serialised', () => {
    // A client that prints its own credential ends up in a log, and a log ends up in a ticket.
    const { client: c } = client({ body: '{}' });

    assert.equal(JSON.stringify(c).includes('ck_live_secret'), false);
    assert.ok(JSON.stringify(c).includes('acc_1'));
  });

  it('fromEnv names what is missing', () => {
    const saved = process.env.CONNECT24_ACCOUNT_ID;
    delete process.env.CONNECT24_ACCOUNT_ID;
    process.env.CONNECT24_API_KEY = 'ck_live_x';

    assert.throws(() => Connect24.fromEnv(), /CONNECT24_ACCOUNT_ID/);

    if (saved !== undefined) process.env.CONNECT24_ACCOUNT_ID = saved;
  });
});

describe('requests', () => {
  it('sends the auth headers on every call', async () => {
    const { client: c, calls } = client({ body: '{"id":"msg_1"}' });

    await c.messages.sendSms('+27821234567', 'Hello');

    const { headers } = calls[0].init;
    assert.equal(headers.Authorization, 'Bearer ck_live_secret');
    assert.equal(headers['X-Account-Id'], 'acc_1');
  });

  it('drops nulls from the body', async () => {
    // An absent `from` means "use my account's assigned address". An explicit null would be an
    // attempt to send from nothing, which the API rejects.
    const { client: c, calls } = client({ body: '{}' });

    await c.messages.sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>Hi</p>' });

    const body = JSON.parse(calls[0].init.body);
    assert.equal('from' in body, false);
    assert.equal('text' in body.content, false);
    assert.equal(body.content.html, '<p>Hi</p>');
  });

  it('passes an idempotency key as a header, not a field', async () => {
    const { client: c, calls } = client({ body: '{}' });

    await c.messages.sendSms('+27821234567', 'Hello', { idempotencyKey: 'order-42' });

    assert.equal(calls[0].init.headers['Idempotency-Key'], 'order-42');
    assert.equal('idempotencyKey' in JSON.parse(calls[0].init.body), false);
  });

  it('refuses a WhatsApp message with neither text nor template', async () => {
    const { client: c } = client({ body: '{}' });

    await assert.rejects(() => c.messages.sendWhatsApp({ to: '+27821234567' }), TypeError);
  });
});

describe('errors', () => {
  it('reads the API error message', async () => {
    const { client: c } = client({ status: 402, body: '{"error":"Insufficient credit."}' });

    await assert.rejects(
      () => c.messages.sendSms('+27821234567', 'Hello'),
      (error) => error instanceof Connect24ApiError && error.statusCode === 402 && /Insufficient credit/.test(error.message),
    );
  });

  it('reads field-level validation errors', async () => {
    const body = '{"title":"Validation failed","errors":{"to":["Not a valid number."]}}';
    const { client: c } = client({ status: 400, body });

    await assert.rejects(
      () => c.messages.sendSms('x', 'Hello'),
      (error) => error.errors.to[0] === 'Not a valid number.',
    );
  });

  it('survives a body that is not JSON', async () => {
    // A proxy returning an HTML 502 must not become a JSON parse error that hides the 502.
    const { client: c } = client({ status: 502, body: '<html>Bad Gateway</html>' });

    await assert.rejects(
      () => c.messages.sendSms('+27821234567', 'Hello'),
      (error) => error instanceof Connect24ApiError && error.statusCode === 502,
    );
  });

  it('reports a transport failure as a different class', async () => {
    // The outcome is genuinely unknown — the message may have been sent — so it must not look like
    // a rejection from the API.
    const { client: c } = client(new Error('socket hang up'));

    await assert.rejects(
      () => c.messages.sendSms('+27821234567', 'Hello'),
      (error) => error instanceof Connect24ConnectionError,
    );
  });

  it('does not retry a 4xx', async () => {
    const { client: c, calls } = client({ status: 400, body: '{"error":"bad"}' }, { maxRetries: 3 });

    await assert.rejects(() => c.messages.sendSms('+27821234567', 'Hello'));

    assert.equal(calls.length, 1, 'a 400 fails identically however many times it is repeated');
  });

  it('retries a 429 and returns the eventual success', async () => {
    const { client: c, calls } = client(
      [{ status: 429, body: '{"error":"slow down"}' }, { status: 200, body: '{"id":"msg_1"}' }],
      { maxRetries: 2 },
    );

    const accepted = await c.messages.sendSms('+27821234567', 'Hello');

    assert.equal(accepted.id, 'msg_1');
    assert.equal(calls.length, 2);
  });
});

describe('model helpers', () => {
  it('reads message status', () => {
    assert.equal(isDelivered({ status: 'Delivered' }), true);
    assert.equal(isFailed({ status: 'failed' }), true);
    assert.equal(isInFlight({ status: 'queued' }), true);
    assert.equal(isInFlight({ status: 'delivered' }), false);
  });

  it('knows which suppressions the sender may not remove', () => {
    assert.equal(chosenByRecipient({ reason: 'Unsubscribed' }), true);
    assert.equal(chosenByRecipient({ reason: 'StopReply' }), true);
    assert.equal(chosenByRecipient({ reason: 'HardBounce' }), false);
  });
});
