import type { Transport } from '../transport.js';
import type { Balance, LedgerEntry } from '../models.js';

/** `client.billing` — prepaid credit, and where it went. */
export class Billing {
  constructor(private readonly transport: Transport) {}

  /**
   * Credit remaining.
   *
   * Every message is charged before it is sent. When the balance cannot cover one the send is
   * refused with a 402 rather than silently dropped, so a low balance surfaces as an error you can
   * act on instead of as messages quietly not arriving.
   */
  balance(): Promise<Balance> {
    return this.transport.get<Balance>('v1/balance');
  }

  /** Every credit and debit, with what caused it. */
  ledger(limit = 100): Promise<LedgerEntry[]> {
    return this.transport.get<LedgerEntry[]>(`v1/ledger?limit=${Number(limit)}`);
  }
}
