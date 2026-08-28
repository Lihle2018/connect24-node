import type { Transport } from '../transport.js';
import type { AccountInfo, ChannelStatus } from '../models.js';

/** `client.account` — who you are, and what can send right now. */
export class Account {
  constructor(private readonly transport: Transport) {}

  /** Your account, including the sending address assigned to it. */
  get(): Promise<AccountInfo> {
    return this.transport.get<AccountInfo>('v1/account');
  }

  /**
   * Which channels can send, and for those that cannot, what is missing.
   *
   * Worth calling at start-up in a deployment you did not configure yourself: it answers "why is
   * nothing sending" without waiting for a failed message to tell you.
   */
  channels(): Promise<ChannelStatus[]> {
    return this.transport.get<ChannelStatus[]>('v1/channels');
  }
}
