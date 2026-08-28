import type { Transport } from '../transport.js';
import type { Suppression } from '../models.js';

/**
 * `client.suppressions` — addresses that will not be sent to.
 *
 * Two kinds live here and they behave differently. One the **recipient** created — an unsubscribe,
 * a STOP reply, a spam complaint, the National Opt-Out Registry — cannot be removed by you, through
 * this API or any other route. Only they can undo it, by opting in again. Suppressions created for
 * other reasons, such as a mailbox that permanently rejected mail or an address you added by hand,
 * you may remove.
 */
export class Suppressions {
  constructor(private readonly transport: Transport) {}

  list(limit = 100): Promise<Suppression[]> {
    return this.transport.get<Suppression[]>(`v1/suppressions?limit=${Number(limit)}`);
  }

  /** Suppresses an address yourself, for somebody who asked you directly. */
  async add(address: string, reason?: string): Promise<void> {
    await this.transport.post('v1/suppressions', { address, reason });
  }

  /**
   * Removes a suppression you are allowed to remove.
   *
   * Refused with a 403 when the recipient created it. That is not a bug to work around: acting on
   * it would mean messaging somebody who said no.
   */
  remove(address: string): Promise<void> {
    return this.transport.delete(`v1/suppressions/${encodeURIComponent(address)}`);
  }
}
