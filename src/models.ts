/**
 * The shapes the API returns.
 *
 * Plain interfaces that mirror the JSON exactly — same names, same casing. There is no mapping
 * layer, deliberately: a mapping layer is a second place for the contract to live, and the two
 * drift the moment the API adds a field. What you get back is what the API sent.
 *
 * Timestamps stay as ISO-8601 strings rather than becoming `Date`. Converting them would mean
 * walking every response to find them, and a string round-trips through logs, queues and JSON
 * without a timezone quietly changing under you. `new Date(message.createdAt)` when you need one.
 */

export interface MessageAccepted {
  /** Keep this. It is how you match a delivery webhook back to what you sent. */
  id: string;
  channel: string;
  /** Accepted, not delivered. Delivery is reported by webhook. */
  status: string;
  provider: string;
}

export interface Message {
  id: string;
  channel: string;
  direction: string;
  from: string;
  to: string;
  status: string;
  provider: string;
  failureReason?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface Template {
  id: string;
  name: string;
  subject?: string | null;
  html?: string | null;
  text?: string | null;
  /** Bumped on every edit, so a sent message stays traceable to the body that produced it. */
  version: number;
}

export interface Suppression {
  address: string;
  reason: string;
  channel?: string | null;
  createdAt: string;
}

export interface Balance {
  amount: number;
  currency: string;
}

export interface LedgerEntry {
  id: string;
  type: string;
  amount: number;
  description: string;
  createdAt: string;
}

export interface AccountInfo {
  id: string;
  name: string;
  /** The address assigned to your account, used until you verify a domain of your own. */
  senderAddress: string;
}

export interface ChannelStatus {
  channel: string;
  available: boolean;
  /** Why it cannot send, when it cannot. */
  reason?: string | null;
}

export interface SendingDomain {
  domain: string;
  verified: boolean;
  /** The DNS records to publish. Empty once verified. */
  records: Array<Record<string, unknown>>;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  /** Returned once, when the endpoint is created. Store it; it is not shown again. */
  secret?: string | null;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventType: string;
  statusCode?: number | null;
  succeeded: boolean;
  attempts: number;
  createdAt: string;
}

export interface WebhookEvent {
  id: string;
  type: string;
  messageId: string;
  createdAt?: Date;
  /** Everything the body carried, including fields added after this version shipped. */
  raw: Record<string, unknown>;
}

// ---------------------------------------------------------------------- helpers

/** Whether the message reached the recipient. */
export function isDelivered(message: Pick<Message, 'status'>): boolean {
  return message.status.toLowerCase() === 'delivered';
}

/** Whether it definitively failed. `failureReason` says why. */
export function isFailed(message: Pick<Message, 'status'>): boolean {
  return message.status.toLowerCase() === 'failed';
}

/** Neither delivered nor failed — still on its way, or waiting for a sending window to open. */
export function isInFlight(message: Pick<Message, 'status'>): boolean {
  return !isDelivered(message) && !isFailed(message);
}

/**
 * Whether the recipient created this suppression.
 *
 * One they created cannot be removed by the sender — not through the API, not through the portal,
 * not by asking support. Only they can undo it, by opting in again.
 */
export function chosenByRecipient(suppression: Pick<Suppression, 'reason'>): boolean {
  return ['unsubscribed', 'complained', 'stopreply', 'optoutregistry'].includes(
    suppression.reason.toLowerCase(),
  );
}
