/**
 * Official Node client for the Connect24 communications API.
 *
 * One interface for email, SMS and WhatsApp:
 *
 * ```ts
 * import { Connect24 } from '@connect24/sdk';
 *
 * const client = Connect24.fromEnv();
 * await client.messages.sendSms('+27821234567', 'Your order has shipped.');
 * ```
 *
 * Two things surprise people, both deliberate:
 *
 * **Your `from` address is not used until you verify the domain.** Until then mail leaves from your
 * account's assigned address on `connect24.co.za` and yours becomes the Reply-To.
 *
 * **There is no sender for SMS.** South African traffic routes from a shared originator pool, and
 * naming an identity you do not own is rejected by the network.
 */

export { Connect24, DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS } from './client.js';
export type { Connect24Options } from './client.js';

export { Connect24ApiError, Connect24ConnectionError, Connect24Error } from './errors.js';

export {
  DEFAULT_TOLERANCE_SECONDS,
  parseWebhookEvent,
  signatureTimestamp,
  verifySignature,
} from './webhooks.js';

export { chosenByRecipient, isDelivered, isFailed, isInFlight } from './models.js';

export type {
  AccountInfo,
  Balance,
  ChannelStatus,
  LedgerEntry,
  Message,
  MessageAccepted,
  SendingDomain,
  Suppression,
  Template,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEvent,
} from './models.js';

export type { Attachment, MessageSender, SendOptions } from './resources/messages.js';
export type { TemplateInput } from './resources/templates.js';
