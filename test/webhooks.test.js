/**
 * Signature verification.
 *
 * Tested harder than anything else here, because it is the only part of the SDK that is a security
 * control. Everything else fails loudly when it is wrong; this one fails by quietly accepting a
 * forged request.
 */

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

import { parseWebhookEvent, signatureTimestamp, verifySignature } from '../dist/index.js';

const SECRET = 'whsec_test';
const PAYLOAD = '{"id":"evt_1","type":"message.delivered","messageId":"msg_1"}';

function header({ payload = PAYLOAD, secret = SECRET, at = Math.floor(Date.now() / 1000) } = {}) {
  const digest = createHmac('sha256', secret).update(`${at}.${payload}`, 'utf8').digest('hex');
  return `t=${at},v1=${digest}`;
}

describe('verifySignature', () => {
  it('accepts a genuine recent delivery', () => {
    assert.equal(verifySignature(PAYLOAD, header(), SECRET), true);
  });

  it('accepts a Buffer as well as a string', () => {
    // express.raw() hands you a Buffer. Requiring a string would push every caller into a decode
    // they might do with the wrong encoding.
    assert.equal(verifySignature(Buffer.from(PAYLOAD, 'utf8'), header(), SECRET), true);
  });

  it('rejects a payload that was altered', () => {
    const tampered = PAYLOAD.replace('delivered', 'bounced');
    assert.equal(verifySignature(tampered, header(), SECRET), false);
  });

  it('rejects the wrong secret', () => {
    assert.equal(verifySignature(PAYLOAD, header({ secret: 'whsec_other' }), SECRET), false);
  });

  it('rejects a delivery that is too old', () => {
    // The signature is still valid; the point is that a captured request cannot be replayed
    // tomorrow.
    const old = header({ at: Math.floor(Date.now() / 1000) - 3600 });
    assert.equal(verifySignature(PAYLOAD, old, SECRET), false);
  });

  it('rejects a delivery stamped in the future', () => {
    // Not symmetry for its own sake: a future timestamp means a forged request or a badly skewed
    // clock, and neither should be trusted.
    const ahead = header({ at: Math.floor(Date.now() / 1000) + 3600 });
    assert.equal(verifySignature(PAYLOAD, ahead, SECRET), false);
  });

  it('skips the age check when tolerance is zero', () => {
    assert.equal(verifySignature(PAYLOAD, header({ at: 1_600_000_000 }), SECRET, 0), true);
  });

  it('returns false rather than throwing on a malformed header', () => {
    // An exception here would let an attacker turn a forged request into a 500, which is a denial
    // of service on an endpoint meant to be resilient.
    for (const bad of ['', 'garbage', 't=,v1=abc', 't=notanumber,v1=abc', 'v1=abc', 't=1770000000', 't=1770000000,v1=']) {
      assert.equal(verifySignature(PAYLOAD, bad, SECRET), false, bad);
    }
  });

  it('returns false when an input is missing', () => {
    assert.equal(verifySignature('', header(), SECRET), false);
    assert.equal(verifySignature(PAYLOAD, '', SECRET), false);
    assert.equal(verifySignature(PAYLOAD, header(), ''), false);
  });

  it('rejects a signature of a different length without throwing', () => {
    // timingSafeEqual throws when the buffers differ in length, so the length check has to come
    // first — otherwise a short forged signature crashes the handler.
    assert.equal(verifySignature(PAYLOAD, `t=${Math.floor(Date.now() / 1000)},v1=abc`, SECRET), false);
  });
});

describe('signatureTimestamp', () => {
  it('reads the timestamp', () => {
    assert.equal(signatureTimestamp(header({ at: 1_770_000_000 })), 1_770_000_000);
  });

  it('returns null when malformed', () => {
    assert.equal(signatureTimestamp('nonsense'), null);
  });
});

describe('parseWebhookEvent', () => {
  it('reads an event from a raw body', () => {
    const event = parseWebhookEvent(PAYLOAD);

    assert.equal(event.id, 'evt_1');
    assert.equal(event.type, 'message.delivered');
    assert.equal(event.messageId, 'msg_1');
  });

  it('keeps the raw body, so a new field is still reachable', () => {
    const event = parseWebhookEvent('{"id":"evt_1","somethingNew":42}');

    assert.equal(event.raw.somethingNew, 42);
  });
});
