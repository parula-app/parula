import { WhatsAppChatRoom } from "./WhatsAppChatRoom";
import { WhatsAppContact } from "./WhatsAppContact";
import { Group } from "../../Abstract/Group";
import type { Person } from "../../Abstract/Person";
import { JID, kServerLid } from "./Binary/JID";
import { WANode } from "./Binary/WANode";
import type { MessageKey } from "./Proto/schema";
import { waLog } from "./util";

/** One member of a group. `jid` is the primary address to send to (LID in a LID
 * group, the phone number in a PN group); the other address is carried across. */
export interface GroupParticipant {
  jid: JID;
  phoneNumber?: JID;
  lid?: JID;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

/** A WhatsApp group chat. Holds the group's metadata (subject, description,
 * addressing mode, participants) and everything group-specific: fetching the
 * `w:g2` metadata, applying `w:gp2` change notifications, group-member sender
 * attribution, and the member list. Group SENDING (sender keys) is driven by
 * {@link WhatsAppSender}, which reads the addressing mode and participants from
 * here.
 *
 * The metadata is re-fetched on demand (it is not persisted in the config); the
 * durable, user-visible parts — messages, the member list, and the group name —
 * persist through the standard DB tables (messages, chatContact, the Group). */
export class WhatsAppGroupChatRoom extends WhatsAppChatRoom {
  subject = "";
  description = "";
  /** Which namespace the group addresses its members in — governs our own sender
   * identity and the wire `addressing_mode` on a send. */
  addressingMode: "lid" | "pn" = "lid";
  participants: GroupParticipant[] = [];

  /** Whether we've fetched the live metadata this session; and the in-flight
   * fetch, so concurrent callers (every listMembers / send) share one `w:g2`
   * query rather than each firing its own. */
  protected metadataLoaded = false;
  protected metadataFetch: Promise<void> | null = null;

  get group(): Group | null {
    return this.contact instanceof Group ? this.contact : null;
  }

  // --- members & sender attribution ---

  async listMembers(): Promise<void> {
    // Online and no members yet: fetch the metadata and resolve each participant
    // to a contact. Offline (or if that yields nothing), fall back to the
    // address-book Persons we already have (e.g. from a backup import).
    if (this.account.connection && !this.group?.participants.hasItems) {
      await this.ensureMetadata().catch(ex => console.error("WhatsApp: group metadata fetch failed:", ex));
      let members = this.participants.map(p => this.account.getContact(p.jid)).filter(Boolean);
      if (members.length) {
        this.members.replaceAll(members);
        await this.save(); // persist the member list so it survives a restart
        return;
      }
    }
    let group = this.group;
    if (group) {
      this.members.replaceAll(group.participants.contents
        .map(person => this.contactForPerson(person))
        .filter(Boolean));
    }
  }

  /** Who a message is from: the group member who sent it. */
  protected contactForSender(sender: JID): WhatsAppContact {
    return this.account.getContact(sender);
  }

  /** The member a stored message is from (its `participant`), else the group. */
  protected historySender(key: MessageKey): WhatsAppContact | Group {
    return key.participant ? this.account.getContact(JID.parse(key.participant)) : this.contact;
  }

  /** Group admins may delete the messages of any member for everyone. */
  protected async isAdminJID(sender: JID): Promise<boolean> {
    await this.ensureMetadata().catch(ex => console.error("WhatsApp: group metadata fetch failed:", ex));
    return this.participants.some(p => p.isAdmin && p.jid.user == sender.user);
  }

  // --- metadata fetch (w:g2) ---

  /** Fetches the group metadata once (coalescing concurrent callers), applies it
   * to the Group contact, and caches it on this room. Re-fetched after
   * {@link invalidateMetadata}. */
  async ensureMetadata(): Promise<void> {
    if (this.metadataLoaded) {
      return;
    }
    this.metadataFetch ??= this.fetchMetadata()
      .then(() => {
        this.metadataLoaded = true;
        this.applyToContact();
      })
      .finally(() => this.metadataFetch = null);
    await this.metadataFetch;
  }

  /** Marks the cached metadata stale (e.g. the server's send-ack reported a
   * different participant hash), so the next {@link ensureMetadata} re-fetches. */
  invalidateMetadata(): void {
    this.metadataLoaded = false;
  }

  /** Sends the `w:g2` info query for this group (to the group JID itself, not a
   * server) and parses the `<group>` result onto this room. */
  protected async fetchMetadata(): Promise<void> {
    let connection = this.account.connection;
    if (!connection) {
      throw new Error("WhatsApp: not connected");
    }
    let response = await connection.sendIQ(new WANode("iq",
      { to: JID.parse(this.id).toString(), type: "get", xmlns: "w:g2" },
      [new WANode("query", { request: "interactive" })]));
    let groupNode = response.child("group");
    if (!groupNode) {
      throw new Error("WhatsApp: group metadata response has no <group>");
    }
    this.parseMetadata(groupNode);
  }

  /** Parses a `<group>` element (from a `w:g2` result or a `create` notification)
   * onto this room's metadata fields. */
  parseMetadata(groupNode: WANode): void {
    this.subject = groupNode.attrs.subject ?? this.subject;
    this.addressingMode = groupNode.attrs.addressing_mode == "pn" ? "pn" : "lid";
    this.participants = [];
    for (let child of groupNode.children()) {
      if (child.tag == "participant") {
        this.participants.push(parseParticipant(child));
      } else if (child.tag == "description") {
        this.description = textOf(child.child("body")) ?? "";
      } else if (child.tag == "announcement" || child.tag == "locked") {
        // settings flags — no UI surface yet
      }
    }
    // We may delete others' messages (`deleteForOthers`) if we're a group admin.
    this.isAdmin = this.participants.some(p => p.isAdmin && this.account.isOwnJID(p.jid));
  }

  /** Writes the subject, description and resolved participants onto the
   * address-book Group, so they persist and show. Participants resolve through the
   * account's contact cache; a contact with no linked Person yet is skipped. */
  protected applyToContact(): void {
    let group = this.group;
    if (!group) {
      return;
    }
    if (this.subject) {
      group.name = this.subject;
      this.name = this.subject;
    }
    group.description = this.description;
    group.participants.clear();
    for (let participant of this.participants) {
      let person = this.personFor(participant.jid);
      if (person) {
        group.participants.add(person);
      }
    }
    void group.save();
  }

  // --- w:gp2 change notifications ---

  /** A `w:gp2` group-change notification (subject/description/membership/settings
   * change, or a group created while we're running). Patches this room's metadata
   * and the Group in place. Unknown action children are ignored. */
  async handleNotification(node: WANode): Promise<void> {
    let group = this.group;
    if (!group) {
      return;
    }
    for (let child of node.children()) {
      if (child.tag == "create") {
        let groupNode = child.child("group");
        if (groupNode) {
          this.parseMetadata(groupNode);
          this.metadataLoaded = true;
          this.applyToContact();
        }
      } else if (child.tag == "subject") {
        let subject = child.attrs.subject;
        if (subject) {
          this.subject = subject;
          group.name = subject;
          this.name = subject;
          await group.save();
        }
      } else if (child.tag == "description") {
        this.description = textOf(child.child("body")) ?? "";
        group.description = this.description;
        await group.save();
      } else if (child.tag == "add") {
        for (let participant of child.children("participant")) {
          this.addParticipant(JID.parse(participant.attrs.jid));
        }
        await group.save();
      } else if (child.tag == "remove") {
        for (let participant of child.children("participant")) {
          let jid = JID.parse(participant.attrs.jid);
          this.removeParticipant(jid);
          if (this.account.isOwnJID(jid)) {
            waLog("group: we were removed from", this.id);
          }
        }
        // Forward secrecy: drop our own group sender key so the next send mints a
        // fresh chain that the removed member can't follow.
        this.resetSenderKey();
        await group.save();
      } else if (child.tag == "announcement" || child.tag == "not_announcement"
        || child.tag == "locked" || child.tag == "unlocked") {
        // settings flags — no UI surface yet
      }
    }
  }

  protected addParticipant(jid: JID): void {
    if (!this.participants.some(p => p.jid.user == jid.user)) {
      this.participants.push({ jid, isAdmin: false, isSuperAdmin: false });
    }
    let group = this.group;
    let person = this.personFor(jid);
    if (group && person) {
      group.participants.add(person);
    }
  }

  protected removeParticipant(jid: JID): void {
    this.participants = this.participants.filter(p => p.jid.user != jid.user);
    let group = this.group;
    let person = this.personFor(jid);
    if (group && person) {
      group.participants.remove(person);
    }
  }

  /** Discards our own sender key for this group so the next send rotates the
   * chain, and clears the sender's per-group distribution memory. */
  protected resetSenderKey(): void {
    let store = this.account.signalStore;
    if (store) {
      let prefix = `${this.id}|`;
      for (let key of [...store.senderKeys.keys()]) {
        if (key.startsWith(prefix)) {
          store.senderKeys.delete(key);
        }
      }
    }
    this.account.sender.resetGroupSenderKey(JID.parse(this.id));
  }

  /** A group participant (an address-book `Person`) as a `WhatsAppContact`, reused
   * from the account cache and linked back to the `Person`.
   * @returns null if the person has no WhatsApp ID */
  protected contactForPerson(person: Person): WhatsAppContact | null {
    let jid = person.chatAccounts.find(e => e.protocol == "whatsapp")?.value;
    if (!jid) {
      return null;
    }
    let contact = this.account.getPersonUID(jid, person.name);
    contact.person = person;
    contact.picture ??= person.picture;
    return contact;
  }

  /** The already-linked Person for a participant JID, if any (linking is lazy,
   * UI-driven), so we can add it to the Group's participant list. */
  protected personFor(jid: JID): Person | null {
    let contact = this.account.getContact(jid);
    return contact.person ?? contact.findPerson();
  }
}

/** One `<participant jid type=… [phone_number] [lid]>`. The cross-address is
 * keyed by the server of `jid`: a LID jid carries `phone_number`, a PN jid `lid`. */
function parseParticipant(node: WANode): GroupParticipant {
  let jid = JID.parse(node.attrs.jid);
  let type = node.attrs.type;
  let participant: GroupParticipant = {
    jid,
    isAdmin: type == "admin" || type == "superadmin",
    isSuperAdmin: type == "superadmin",
  };
  if (jid.server == kServerLid) {
    if (node.attrs.phone_number) {
      participant.phoneNumber = JID.parse(node.attrs.phone_number);
    }
  } else if (node.attrs.lid) {
    participant.lid = JID.parse(node.attrs.lid);
  }
  return participant;
}

/** The text content of a node — the wire delivers it as bytes; a locally built
 * node may hold a string. */
function textOf(node: WANode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }
  if (typeof node.content == "string") {
    return node.content || undefined;
  }
  let bytes = node.contentBytes;
  return bytes ? new TextDecoder().decode(bytes) || undefined : undefined;
}
