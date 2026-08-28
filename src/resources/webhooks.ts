import type { Transport } from '../transport.js';
import type { WebhookDelivery, WebhookEndpoint } from '../models.js';

/**
 * `client.webhooks` — delivery events pushed to you.
 *
 * Registering an endpoint is only half of it. Verify every request that arrives with
 * `verifySignature` before acting on it: the URL is public, so without that check anyone can tell
 * your system a message bounced.
 */
export class Webhooks {
  constructor(private readonly transport: Transport) {}

  list(): Promise<WebhookEndpoint[]> {
    return this.transport.get<WebhookEndpoint[]>('v1/webhooks');
  }

  /**
   * Registers an endpoint.
   *
   * The signing secret is on the returned object and is shown **once**. Store it now; it cannot be
   * read back later, only replaced.
   */
  create(url: string, events?: string[]): Promise<WebhookEndpoint> {
    return this.transport.post<WebhookEndpoint>('v1/webhooks', { url, events });
  }

  delete(endpointId: string): Promise<void> {
    return this.transport.delete(`v1/webhooks/${encodeURIComponent(endpointId)}`);
  }

  /** Recent attempts to reach your endpoints — the first place to look when events stop. */
  listDeliveries(limit = 100): Promise<WebhookDelivery[]> {
    return this.transport.get<WebhookDelivery[]>(`v1/webhooks/deliveries?limit=${Number(limit)}`);
  }
}
