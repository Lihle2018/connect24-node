# Order-shipped notifications

The shape most Connect24 integrations take: when an order ships, email the customer and
text them if a phone number is on file — safely.

What it demonstrates (and what the tests prove):

- **Idempotency keys tied to the order** (`order-1042-shipped-email`), so a retried queue
  message or a crashed worker never sends a customer two copies.
- **Suppression is a skip, not a failure** — a 403 means the person opted out; the notifier
  records it and carries on with the other channel.
- **Out of credit (402) is loud** — every further send would fail too, so it throws a
  dedicated error for your alerting.
- **No phone → no SMS call at all.**

Run the tests (no network, no key — they drive the real SDK against a stubbed `fetch` and
assert what goes on the wire):

    npm install
    npm test

Run it for real — safe with a test key, because the default recipient uses a simulation
address that never leaves the platform:

    set CONNECT24_ACCOUNT_ID=acc_...
    set CONNECT24_API_KEY=ck_test_...
    npm start
