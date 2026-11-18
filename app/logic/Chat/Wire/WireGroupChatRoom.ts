import { WireChatRoom, kMemberRole } from "./WireChatRoom";
import type { WirePerson } from "./WirePerson";
import type { Group } from "../../Abstract/Group";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";

/**
 * A conversation with several people (Wire type 0), which Wire also calls a
 * channel or a meeting, depending on its `group_conv_type`.
 *
 * Membership works differently per transport: Proteus takes it from the
 * conversation on the server, MLS from the group's ratchet tree, so adding
 * somebody to an MLS group means committing an Add, not calling an endpoint.
 */
export class WireGroupChatRoom extends WireChatRoom {
  declare contact: Group;

  async rename(newName: string): Promise<void> {
    assert(this.isAdmin, gt`Only an administrator can rename this conversation`);
    await this.account.api.renameConversation(this.qualifiedID, newName);
    this.name = newName;
    this.contact.name = newName;
    await this.save();
  }

  async addMembers(persons: WirePerson[]): Promise<void> {
    if (this.isMLS) {
      await this.account.mls.addMembers(this, persons.map(person => person.qualifiedID));
    } else {
      await this.account.api.addMembers(this.qualifiedID,
        persons.map(person => person.qualifiedID), kMemberRole);
    }
    this.members.addAll(persons.filter(person => !this.members.includes(person)));
    await this.save();
  }

  async removeMembers(persons: WirePerson[]): Promise<void> {
    if (this.isMLS) {
      await this.account.mls.removeMembers(this, persons.map(person => person.qualifiedID));
    } else {
      for (let person of persons) {
        await this.account.api.removeMember(this.qualifiedID, person.qualifiedID);
      }
    }
    this.members.removeAll(persons);
    await this.save();
  }

  /** Wire has no leave endpoint: we remove ourselves, and for an MLS group the
   * backend commits the Remove for us. */
  async leave(): Promise<void> {
    await this.account.api.removeMember(this.qualifiedID, this.account.getOwnContact().qualifiedID);
    this.account.rooms.delete(this.contact);
  }
}
