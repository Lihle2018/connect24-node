import type { Transport } from '../transport.js';
import type { Message, MessageAccepted } from '../models.js';

/** Who a message is from. Only used for email, and only once the domain is verified. */
export interface MessageSender {
  address: string;
  name?: string;
}

export interface Attachment {
  name: string;
  contentType: string;
  /** Base64. Total attachments are capped at roughly 7 MB per message. */
  content: string;
  /** Set this and reference it as `<img src="cid:logo">` for an inline image. */
  contentId?: string;
}

export interface SendOptions {
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  attachments?: Attachment[];
  headers?: Record<string, string>;
  tags?: string[];
  metadata?: Record<string, string>;
  provider?: string;
  /**
   * Pass one when a network failure leaves you unsure whether a send arrived. A repeat with the
   * same key returns the original message instead of sending again.
   *
   * Use something stable and tied to the event — an order id, not a UUID generated at call time,
   * which would differ on the retry and defeat the point.
   */
  idempotencyKey?: string;
}

/** `client.messages` — every channel through one shape. */
export class Messages {
  constructor(private readonly transport: Transport) {}

  /**
   * Sends one message. Prefer {@link sendSms}, {@link sendEmail} or {@link sendWhatsApp}; this is
   * the full shape underneath them, for the cases they do not cover.
   */
  async send(
    request: {
      channel: string;
      to: string;
      content: Record<string, unknown>;
      from?: MessageSender;
      template?: string;
      variables?: Record<string, string>;
    } & SendOptions,
  ): Promise<MessageAccepted> {
    const { idempotencyKey, ...body } = request;
    return this.transport.post<MessageAccepted>('v1/messages', body, idempotencyKey);
  }

  /**
   * Sends an SMS.
   *
   * There is no sender argument, deliberately. South African traffic leaves from a shared
   * originator pool, and naming an identity you do not own is rejected by the network rather than
   * by us.
   *
   * Watch what goes in `text`. An SMS holds 160 characters using the GSM-7 alphabet; one emoji,
   * curly quote or em dash switches the whole message to UCS-2, which holds 70 per part. A
   * 150-character message with one emoji costs three SMS, not one.
   */
  sendSms(to: string, text: string, options: SendOptions = {}): Promise<MessageAccepted> {
    return this.send({ channel: 'Sms', to, content: { type: 'text', text }, ...options });
  }

  /**
   * Sends an email.
   *
   * `from` is not used until you verify the domain it belongs to. Until then mail leaves from your
   * account's assigned address on `connect24.co.za` and the address you give becomes the Reply-To —
   * so replies still reach you, but the envelope is ours.
   */
  sendEmail(
    request: { to: string; subject: string; html?: string; text?: string; from?: MessageSender } & SendOptions,
  ): Promise<MessageAccepted> {
    const { to, subject, html, text, from, ...options } = request;

    return this.send({
      channel: 'Email',
      to,
      from,
      content: { type: html ? 'html' : 'text', subject, html, text },
      ...options,
    });
  }

  /**
   * Sends a WhatsApp message.
   *
   * Free-form text only works inside the 24-hour window that opens when the customer last messaged
   * you. Outside it WhatsApp requires an approved template — pass `templateName`. Sending free-form
   * outside the window is refused by WhatsApp, not by us.
   */
  // `async`, so the guard below rejects rather than throwing synchronously. A method that returns
  // a promise but throws before the first await is a trap: `.catch()` never sees it, and the error
  // escapes to the top level from what looked like handled code.
  async sendWhatsApp(
    request: { to: string; text?: string; templateName?: string; variables?: Record<string, string> } & SendOptions,
  ): Promise<MessageAccepted> {
    const { to, text, templateName, variables, ...options } = request;

    if (!text && !templateName) {
      throw new TypeError(
        'Give either text, or templateName for a message outside the 24-hour window.',
      );
    }

    return this.send({
      channel: 'WhatsApp',
      to,
      content: { type: 'text', text, templateName },
      variables,
      ...options,
    });
  }

  /** Sends a stored template, with values substituted into its placeholders. */
  sendTemplate(
    request: { channel: string; to: string; template: string; variables?: Record<string, string> } & SendOptions,
  ): Promise<MessageAccepted> {
    const { channel, to, template, variables, ...options } = request;
    return this.send({ channel, to, content: { type: 'template' }, template, variables, ...options });
  }

  /** One message, with its current status and why it failed if it did. */
  get(id: string): Promise<Message> {
    return this.transport.get<Message>(`v1/messages/${encodeURIComponent(id)}`);
  }

  /** The most recent messages, newest first. */
  list(limit = 100): Promise<Message[]> {
    return this.transport.get<Message[]>(`v1/messages?limit=${Number(limit)}`);
  }
}
