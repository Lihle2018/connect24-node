# Connect24 Node SDK

Official Node client for the [Connect24](https://connect24.co.za) communications API —
one interface for email, SMS and WhatsApp.

```bash
npm install @connect24/sdk
```

No runtime dependencies — it uses the `fetch` built into Node 18 and newer. An SDK is a
dependency of *your* application, and every package it drags in is a version conflict that becomes
yours to resolve.

## Quick start

Get your **account id** and an **API key** from the portal, under Settings → API keys.

```ts
import { Connect24 } from '@connect24/sdk';

const client = new Connect24({
  accountId: 'acc_3f9c1a7b4e2d',
  apiKey: process.env.CONNECT24_API_KEY!,
});

await client.messages.sendSms('+27821234567', 'Your payment is due tomorrow.');
```

Or read both from the environment, which is what most deployments want:

```ts
const client = Connect24.fromEnv();   // CONNECT24_ACCOUNT_ID, CONNECT24_API_KEY
```

## What you can reach

| | |
|---|---|
| `client.messages` | Send email, SMS and WhatsApp; read status and history |
| `client.templates` | Stored bodies with placeholders, so copy lives on the platform |
| `client.suppressions` | Addresses that will not be sent to |
| `client.webhooks` | Delivery events pushed to you, plus signature verification |
| `client.sendingDomains` | Prove you control a domain, so mail goes out as you |
| `client.billing` | Prepaid credit, pricing and the statement |
| `client.account` | Who you are, and which channels can send right now |

## Every channel, one shape

```ts
// SMS
await client.messages.sendSms('+27821234567', 'Your delivery is on its way.');

// WhatsApp — free-form inside the 24-hour window, a template outside it
await client.messages.sendWhatsApp({ to: '+27821234567', text: 'Your order has shipped.' });
await client.messages.sendWhatsApp({ to: '+27821234567', templateName: 'payment_reminder' });

// Email
await client.messages.sendEmail({
  to: 'customer@example.com',
  subject: 'Payment reminder',
  html: '<p>Your account is overdue.</p>',
  from: { address: 'collections@acme.co.za', name: 'Acme Collections' },
});
```

## Two things that surprise people

**Your `from` address is not used until you verify the domain.** Until then mail leaves from your
account's assigned address on `connect24.co.za` and yours becomes the Reply-To. Verify with
`client.sendingDomains.add('acme.co.za')`, publish the returned DNS records, then `verify`.

**There is no sender for SMS.** South African traffic routes from a shared originator pool, and
naming an identity you do not own is rejected by the network.

## Not sending twice

Pass an idempotency key when a network failure leaves you unsure whether a send arrived. A repeat
with the same key returns the original message instead of sending again:

```ts
await client.messages.sendSms('+27821234567', 'Your order has shipped.', {
  idempotencyKey: `order-${order.id}-shipped`,
});
```

Use something stable and tied to the event — an order id, not a UUID generated at call time, which
would differ on the retry and defeat the point.

## Watch the emoji

An SMS holds 160 characters using the GSM-7 alphabet. A single emoji, curly quote or em dash
switches the whole message to UCS-2, which holds 70 characters per part. A 150-character message
with one emoji costs **three** SMS, not one. The portal shows the segment count while you write.

## Verifying a webhook

Verify against the **raw body**, before any framework parses it.

```ts
import express from 'express';
import { parseWebhookEvent, verifySignature } from '@connect24/sdk';

app.post(
  '/hooks/connect24',
  express.raw({ type: 'application/json' }),   // raw body, not express.json()
  (req, res) => {
    const signature = req.header('X-Connect24-Signature') ?? '';

    if (!verifySignature(req.body, signature, process.env.WEBHOOK_SECRET!)) {
      return res.sendStatus(401);
    }

    const event = parseWebhookEvent(req.body);
    // Acknowledge fast — anything that is not 2xx is retried.
    res.sendStatus(200);
  },
);
```

Delivery is at-least-once. Deduplicate on `event.id`.

## Errors

```ts
import { Connect24ApiError, Connect24ConnectionError } from '@connect24/sdk';

try {
  await client.messages.sendSms('+27821234567', 'Hello');
} catch (error) {
  if (error instanceof Connect24ApiError) {
    if (error.statusCode === 402) {
      // out of credit; topping up is the only fix
    } else if (error.statusCode === 401) {
      // key is wrong or revoked
    }
    console.log(error.errors);   // field-level validation messages, when the API sent any
  } else if (error instanceof Connect24ConnectionError) {
    // never reached the API — the send may or may not have happened
  }
}
```

Rate limits, 5xx and connection failures are retried twice with backoff before either is raised.
A 4xx is never retried, because repeating it changes nothing.

## What the send path enforces

Messages sent through Connect24 are subject to South African law, applied where the message is
actually sent rather than left to you:

- **POPIA** — a lawful basis is recorded per contact, with where the details came from.
- **Consumer Protection Act** — no marketing on Sundays or public holidays, Saturdays 09:00–13:00
  only, weekdays 08:00–20:00. A marketing send outside the window waits rather than going out late.
- **WASPA Code** — a working opt-out on every marketing message. Once used, it applies across every
  list, permanently, and cannot be reversed by the sender.

Connect24 enforces these in the send path. You remain the responsible party under POPIA for the
data you upload and the consent you hold — see the [terms](https://connect24.co.za/terms).

## Development

```bash
npm install
npm test          # builds, then runs the suite
npm run typecheck
```

## Links

- [API documentation](https://connect24.co.za/developer)
- [Support](mailto:support@connect24.co.za)
