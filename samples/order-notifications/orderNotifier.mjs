/**
 * Order-shipped notifications — the shape most Connect24 integrations take.
 *
 * A store's backend calls `notifyShipped(order)` when a parcel leaves the warehouse. The
 * service emails the customer, texts them when a phone number is on file, and answers the
 * three questions every real integration has to answer:
 *
 *  - What if this code runs twice for the same order (a retry, a replayed queue message)?
 *    Idempotency keys derived from the order id: the API returns the original message
 *    instead of sending a second copy, so calling this twice is always safe.
 *  - What if the customer opted out? The API refuses with a 403. That is not an error in
 *    your system — it is the suppression list doing its job — so it comes back as a
 *    `skipped` outcome, not a throw.
 *  - What if the account is out of credit? A 402 means every further send will also fail,
 *    so that one throws `OutOfCreditError` for the caller to alert on.
 */

import { Connect24ApiError } from '@connect24/sdk';

export class OutOfCreditError extends Error {
  constructor(message) {
    super(`Connect24 account is out of credit: ${message}`);
    this.name = 'OutOfCreditError';
  }
}

export class OrderNotifier {
  /** @param {import('@connect24/sdk').Connect24} client A configured SDK client. */
  constructor(client) {
    this.client = client;
  }

  /**
   * @param {{id: string, customerName: string, email: string, phone?: string,
   *          trackingUrl: string}} order
   * @returns {Promise<{email: Outcome, sms: Outcome}>} what happened on each channel —
   *   `{status: 'sent', id}` | `{status: 'skipped', reason}`.
   */
  async notifyShipped(order) {
    const email = await this.#deliver(() =>
      this.client.messages.sendEmail({
        to: order.email,
        subject: `Order ${order.id} is on its way`,
        html: `<p>Hi ${order.customerName},</p>
               <p>Your order <strong>${order.id}</strong> has shipped.
               <a href="${order.trackingUrl}">Track it here</a>.</p>`,
        text: `Hi ${order.customerName}, your order ${order.id} has shipped. Track it: ${order.trackingUrl}`,
        // Stable and tied to the event — NOT a random UUID, which would differ on a retry
        // and defeat the point.
        idempotencyKey: `order-${order.id}-shipped-email`,
        metadata: { orderId: order.id },
      }),
    );

    const sms = order.phone
      ? await this.#deliver(() =>
          this.client.messages.sendSms(
            order.phone,
            // Plain GSM-7 characters only: one emoji or curly quote turns 1 SMS into 3.
            `Your order ${order.id} has shipped. Track it: ${order.trackingUrl}`,
            { idempotencyKey: `order-${order.id}-shipped-sms`, metadata: { orderId: order.id } },
          ),
        )
      : { status: 'skipped', reason: 'no phone number on file' };

    return { email, sms };
  }

  async #deliver(send) {
    try {
      const accepted = await send();
      return { status: 'sent', id: accepted.id };
    } catch (error) {
      if (error instanceof Connect24ApiError && error.statusCode === 403) {
        // Most often the suppression list: the person opted out or hard-bounced before.
        // Retrying will never succeed, and contacting them anyway is the one thing a
        // messaging integration must never do.
        return { status: 'skipped', reason: error.message };
      }
      if (error instanceof Connect24ApiError && error.statusCode === 402) {
        throw new OutOfCreditError(error.message);
      }
      // Everything else (bad request, 5xx, connection loss) surfaces to the caller. A
      // connection error is safe to retry with the SAME order — the idempotency keys above
      // make the retry return the original message.
      throw error;
    }
  }
}
