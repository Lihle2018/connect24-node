import type { Transport } from '../transport.js';
import type { SendingDomain } from '../models.js';

/**
 * `client.sendingDomains` — proving you control a domain, so mail goes out as you.
 *
 * Until a domain is verified, email leaves from your account's assigned address on
 * `connect24.co.za` and your address becomes the Reply-To. That address is random and not
 * chooseable: if customers could pick it, one could send as `security@connect24.co.za` and phish
 * under the platform's brand. Sending reputation is shared, so the identity stays ours until you
 * have proved a domain of your own.
 */
export class SendingDomains {
  constructor(private readonly transport: Transport) {}

  list(): Promise<SendingDomain[]> {
    return this.transport.get<SendingDomain[]>('v1/sending-domains');
  }

  /** Registers a domain and returns the DNS records to publish. */
  add(domain: string): Promise<SendingDomain> {
    return this.transport.post<SendingDomain>('v1/sending-domains', { domain });
  }

  /**
   * Checks the DNS records you published.
   *
   * DNS propagation is not instant, so a first call that comes back unverified usually means
   * "not yet" rather than "wrong" — wait and call again.
   */
  verify(domain: string): Promise<SendingDomain> {
    return this.transport.post<SendingDomain>(`v1/sending-domains/${encodeURIComponent(domain)}/verify`);
  }

  remove(domain: string): Promise<void> {
    return this.transport.delete(`v1/sending-domains/${encodeURIComponent(domain)}`);
  }
}
