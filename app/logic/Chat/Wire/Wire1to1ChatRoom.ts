import { WireChatRoom } from "./WireChatRoom";
import type { WirePerson } from "./WirePerson";

/**
 * A conversation with exactly one other person.
 *
 * Wire has two of these per peer: the Proteus 1:1, which the contact request
 * creates, and the MLS 1:1, which is a *different* conversation that either
 * backend conjures on demand. Which one we use follows from what both sides
 * support; once the MLS one is established we never go back to the other.
 *
 * Type 3 is the same conversation before the contact request was accepted.
 */
export class Wire1to1ChatRoom extends WireChatRoom {
  declare contact: WirePerson;

  /** A contact request that nobody accepted yet, not a chat */
  get isPendingInvite(): boolean {
    return this.type == 3;
  }

  async listMembers(): Promise<void> {
    await this.listMembers1to1();
  }
}
