import { ChatRoom } from "../ChatRoom";
import { getBareJID, type XMPPAccount } from "./XMPPAccount";
import { XMPPChatMessage } from "./XMPPChatMessage";
import { XMPPRoomEvent } from "./XMPPRoomEvent";
import { type ChatRoomEvent, RoomEventKind } from "../RoomEvent";
import type { XMPPPerson } from "./XMPPPerson";
import { ChatMessage, DeliveryStatus, type RoomMessage } from "../ChatMessage";
import { SQLChatMessage } from "../SQL/SQLChatMessage";
import { isFileURL } from "./XMPPMedia";
import type { Group } from "../../Abstract/Group";
import { Lock } from "../../util/flow/Lock";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { notifyChangedProperty } from "../../util/Observable";
import { NS_OMEMO_AXOLOTL } from "stanza/Namespaces";
import { ArrayColl } from "svelte-collections";
import type { Message, Forward, MAMResult, MAMFin, Paging } from "stanza/protocol";

const kBatchSize = 200;

/** How a chat room encrypts the messages our user sends.
 * Incoming OMEMO is always decrypted, regardless of this. */
export enum Encryption {
  /** Plaintext (the server, and for groups the room service, can read it) */
  None = "none",
  /** OMEMO end-to-end encryption (XEP-0384) */
  OMEMO = "omemo",
}

export class XMPPChat extends ChatRoom {
  declare account: XMPPAccount;
  declare readonly members: ArrayColl<XMPPPerson>;
  declare contact: XMPPPerson | Group;

  /** XMPP wire type of the messages in this chat */
  messageType: "chat" | "groupchat" = "chat";
  @notifyChangedProperty
  encryption = Encryption.None;
  /** The other side is currently typing (XEP-0085) */
  @notifyChangedProperty
  contactIsTyping = false;
  /** Serializes DB-load + server-sync, so the login background sync and a UI call
   * can't both insert the same messages */
  protected readonly syncLock = new Lock();

  /** Sets the sender (`from`) and `outgoing` on the message. `contact` stays the
   * conversation (the chat partner here; the `Group` for XMPPGroupChat, which
   * resolves the actual occupant). */
  fillSender(msg: XMPPChatMessage, from: string): void {
    let bare = getBareJID(from);
    msg.outgoing = bare && bare == this.account.jid;
    // 1:1: the sender is the chat partner, the same `XMPPPerson` as `this.contact`.
    // XMPPGroupChat overrides this.
    msg.from = msg.outgoing
      ? this.account.getOwnContact()
      : this.account.getPersonUID(bare);
  }

  // --- Receiving ---

  /** Interprets one incoming message stanza: decrypts OMEMO, then either applies
   * it to an existing message (reaction, receipt, read marker, edit, retraction,
   * typing) or returns it as a new message for the caller to store.
   * @param wrapper the MAM/carbon envelope, if from the archive
   * @param archiveID the MAM archive ID, if from the archive */
  async addMessage(json: Message, wrapper?: Forward, archiveID?: string): Promise<XMPPChatMessage | null> {
    let encrypted = false;
    if (json.omemo) {
      let plaintext = await this.decryptOMEMO(json);
      if (plaintext == null && !this.hasContent(json)) {
        return null; // key-transport / not for us, and nothing else to show
      }
      if (plaintext != null) {
        json.body = plaintext;
        encrypted = true;
      }
    }

    if (json.retract) {
      this.receiveRetraction(json, encrypted);
      return null;
    }
    if (json.reactions) {
      this.receiveReactions(json);
      return null;
    }
    if (json.receipt?.type == "received" && json.receipt.id) {
      this.updateDeliveryStatus(json.receipt.id, DeliveryStatus.User);
      return null;
    }
    if (json.marker?.type == "displayed" && json.marker.id) {
      this.updateDeliveryStatus(json.marker.id, DeliveryStatus.Seen, true);
      return null;
    }
    if (json.replace && this.receiveCorrection(json, encrypted)) {
      return null;
    }
    if (json.chatState && !this.hasContent(json)) {
      this.contactIsTyping = json.chatState == "composing";
      return null;
    }
    if (!this.hasContent(json)) {
      return null;
    }

    let id = sanitize.nonemptystring(json.id, null) ?? sanitize.nonemptystring(archiveID, null);
    if (id && this.messages.some(msg => msg.id == id)) {
      return null; // already known (our own reflection, a carbon, or re-sync)
    }
    let msg = this.newMessage();
    msg.fromStanzaJS(json, wrapper, archiveID);
    msg.encrypted = encrypted;
    this.addMediaAttachments(msg, json);
    this.messages.add(msg);
    this.contactIsTyping = false;
    await msg.save();
    return msg;
  }

  /** Turns shared-file URLs (in the body, or OOB per XEP-0066) into attachments,
   * downloading and decrypting them (aesgcm://) in the background. */
  protected addMediaAttachments(msg: XMPPChatMessage, json: Message): void {
    let urls = new Set<string>();
    for (let link of json.links ?? []) {
      if (link.url) {
        urls.add(link.url);
      }
    }
    if (msg.text && isFileURL(msg.text)) {
      urls.add(msg.text.trim());
      msg.text = ""; // the body is only the file URL; show the attachment, not the raw URL
    }
    for (let url of urls) {
      msg.addMediaFromURL(url);
    }
  }

  /** Has anything the user should see (a body or an attachment)? */
  protected hasContent(json: Message): boolean {
    return !!json.body || !!json.html?.body || !!json.links?.length;
  }

  /** Decrypts an OMEMO message. @returns the plaintext body, or null if it's a
   * key-transport message or not addressed to our device; logs and returns null
   * on a decryption failure rather than throwing away the whole sync. */
  protected async decryptOMEMO(json: Message): Promise<string | null> {
    try {
      let plaintext = await this.account.omemo.decrypt(json.omemo!, this.senderJID(json));
      this.encryption = Encryption.OMEMO; // the peer uses OMEMO, so we will too
      return plaintext ? new TextDecoder().decode(plaintext) : null;
    } catch (ex) {
      this.account.errorCallback(ex);
      return null;
    }
  }

  /** Bare JID of who sent `json`, for OMEMO session lookup.
   * XMPPGroupChat resolves the MUC occupant's real JID. */
  protected senderJID(json: Message): string {
    return getBareJID(json.from);
  }

  protected receiveReactions(json: Message): void {
    let target = this.findMessage(json.reactions!.id);
    if (!(target instanceof ChatMessage)) {
      return; // reacting to a message we don't have
    }
    let sender = this.messageSender(json);
    if (json.reactions!.emojis.length) {
      target.reactions.set(sender, json.reactions!.emojis.join(""));
    } else {
      target.reactions.delete(sender);
    }
    target.save()
      .catch(this.account.errorCallback);
  }

  /** Applies a XEP-0424 retraction (delete) to the message it references.
   * Only from its author, and for an OMEMO message only encrypted, as in Conversations. */
  protected receiveRetraction(json: Message, encrypted: boolean): void {
    let target = this.findMessage(json.retract!.id);
    if (!(target instanceof XMPPChatMessage) ||
        target.from != this.messageSender(json) || target.encrypted && !encrypted) {
      return;
    }
    target.retracted = true;
    target.text = gt`This message was deleted`;
    target.save()
      .catch(this.account.errorCallback);
  }

  /** Applies a XEP-0308 correction (edit) to the message it replaces.
   * Only from its author, and for an OMEMO message only encrypted, as in Conversations,
   * so that other room members or the server can't change what somebody wrote.
   * @returns false if we don't have the original, or the correction may not change it
   *   (caller shows it as new) */
  protected receiveCorrection(json: Message, encrypted: boolean): boolean {
    let target = this.findMessage(json.replace!);
    if (!(target instanceof XMPPChatMessage) ||
        target.from != this.messageSender(json) || target.encrypted && !encrypted) {
      return false;
    }
    target.text = sanitize.string(json.body, "");
    if (json.html?.body) {
      target.fromHTML(json.html.body);
    }
    target.edited = true;
    target.save()
      .catch(this.account.errorCallback);
    return true;
  }

  /** A delivery receipt or read marker arrived for one of our sent messages.
   * @param alsoEarlier mark all earlier outgoing messages too (read markers
   * are cumulative: "displayed" implies everything before it was seen) */
  protected updateDeliveryStatus(messageID: string, status: DeliveryStatus, alsoEarlier = false): void {
    let target = this.findMessage(messageID);
    if (!(target instanceof ChatMessage)) {
      return;
    }
    target.deliveryStatus = status;
    if (alsoEarlier) {
      for (let msg of this.messages) {
        if (msg instanceof ChatMessage && msg.outgoing && msg.sent <= target.sent &&
            msg.deliveryStatus != DeliveryStatus.Seen) {
          msg.deliveryStatus = status;
        }
      }
    }
  }

  findMessage(id: string): RoomMessage | undefined {
    return this.messages.find(msg =>
      msg.id == id ||
      (msg instanceof XMPPChatMessage && (msg.stanzaID == id || msg.originID == id)));
  }

  /** The contact who sent `json`, as the key for the reaction map.
   * 1:1: our own user or the chat partner; XMPPGroupChat resolves the occupant. */
  protected messageSender(json: Message): XMPPPerson {
    let from = getBareJID(json.from);
    return from == this.account.jid
      ? this.account.getOwnContact()
      : this.account.getPersonUID(from);
  }

  // --- Sending ---

  /** Our user wants to send this message out.
   * Data like recipient etc. is in the message object. */
  async sendMessage(message: XMPPChatMessage): Promise<void> {
    assert(this.account.isLoggedIn, "Chat account is not logged in");
    if (message.isEdit) {
      await message.sendEdit();
      return;
    }
    assert(!message.attachments.some(att => !att.content), gt`Attachment is empty`);
    message.deliveryStatus = DeliveryStatus.Sending;
    message.id ??= crypto.randomUUID();
    message.from ??= this.account.getOwnContact();
    if (!this.messages.contents.includes(message)) {
      this.messages.add(message);
    }
    // Upload each attachment `content` blob as a file message: HTTP File Upload (XEP-0363),
    // or, when encrypted, via OMEMO media sharing (aesgcm://).
    // XMPP carries one file per message (its URL + OOB).
    for (let attachment of message.attachments) {
      let data = new Uint8Array(await attachment.content.arrayBuffer());
      let url = this.encryption == Encryption.OMEMO
        ? await this.account.media.uploadEncrypted(attachment.filename, data, attachment.mimeType)
        : await this.account.media.upload(attachment.filename, data, attachment.mimeType);
      await this.sendStanza({ body: url, links: [ url ] }); // OOB (XEP-0066), so clients show the file
    }
    if (message.text) {
      await this.sendStanza({
        id: message.id,
        body: message.text,
        html: message.hasHTML ? { body: message.html } : undefined,
        reply: message.inReplyTo,
      });
    }
    message.sent = new Date();
    message.received = new Date();
    message.deliveryStatus = DeliveryStatus.Server;
    this.lastMessage = message;
    await this.saveNewMessages([message]);
  }

  /** Builds and sends one outgoing message stanza, applying our delivery-receipt
   * decorations and OMEMO encryption (or an OOB link for an unencrypted file). */
  protected async sendStanza(parts: { id?: string, body: string, html?: any, reply?: string, links?: string[] }): Promise<void> {
    let stanza: Message = {
      type: this.messageType,
      to: this.id,
      id: parts.id ?? crypto.randomUUID(),
      body: parts.body,
      html: parts.html, // stanza lib wraps a string body in XHTML-IM and sanitizes it
    };
    this.decorateOutgoing(stanza);
    if (parts.reply) {
      stanza.reply = { id: parts.reply };
    }
    if (this.encryption == Encryption.OMEMO) {
      await this.encryptOutgoing(stanza, parts.body);
    } else if (parts.links) {
      stanza.links = parts.links.map(link => ({
        url: link,
      }));
    }
    this.account.client.sendMessage(stanza);
  }

  /** Adds the 1:1-only delivery receipt + read-marker requests to an outgoing
   * message, plus a stable origin-id. XMPPGroupChat overrides this. */
  protected decorateOutgoing(stanza: Message): void {
    // XEP-0359 origin-id: the stable id the recipient indexes this message by, so a
    // later edit (XEP-0308 `replace`) or retraction (XEP-0424 `retract`) we send —
    // which reference this id — can be matched back to it. Without it, Conversations
    // can't find the original and renders our edit/deletion as a new message. It
    // equals the stanza id, which is also what `referenceID()` uses.
    stanza.originId = stanza.id;
    stanza.receipt = { type: "request" };
    stanza.marker = { type: "markable" };
  }

  /** The message ID that reactions/receipts/corrections from peers reference.
   * 1:1 uses the message ID
   * MUC uses the server-assigned stanza ID. */
  referenceID(message: XMPPChatMessage): string {
    return message.id;
  }

  /** Bare JIDs to OMEMO-encrypt a message to. 1:1: the chat partner;
   * XMPPGroupChat: every occupant's real JID. */
  protected omemoRecipientJIDs(): string[] {
    return [this.id];
  }

  /** Replaces the plaintext of an outgoing stanza with the OMEMO `<encrypted>`
   * element, encrypted for every device of every recipient and our own. */
  protected async encryptOutgoing(stanza: Message, text: string): Promise<void> {
    stanza.omemo = await this.account.omemo.encrypt(this.omemoRecipientJIDs(), new TextEncoder().encode(text ?? ""));
    stanza.encryptionMethod = { id: NS_OMEMO_AXOLOTL, name: "OMEMO" };
    stanza.processingHints = { store: true }; // so the server's MAM keeps it
    delete stanza.html;
    // A short fallback body (no plaintext) so clients that can't decrypt — or
    // don't support OMEMO — still show that an encrypted message arrived. The
    // recipient overwrites it with the decrypted text. Mirrors Conversations.
    stanza.body = gt`This message is encrypted with OMEMO.`;
  }

  /** OMEMO-encrypts `stanza` in place when this room is encrypted; otherwise
   * leaves it plaintext. Lets a message encrypt its own outgoing stanza (edits)
   * without reaching into the room's OMEMO internals. */
  async encryptIfEnabled(stanza: Message, body: string): Promise<void> {
    if (this.encryption == Encryption.OMEMO) {
      await this.encryptOutgoing(stanza, body);
    }
  }

  /** Sends a typing notification (XEP-0085). */
  sendChatState(state: "composing" | "paused" | "active"): void {
    if (!this.account.isLoggedIn) {
      return;
    }
    this.account.client.sendMessage({ type: this.messageType, to: this.id, chatState: state });
  }

  /** Saves new messages to our DB */
  async saveNewMessages(messages: RoomMessage[]): Promise<void> {
    if (!this.dbID) {
      await this.save();
    }
    for (let msg of messages) {
      try {
        await msg.save();
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }
  }

  // --- History (Message Archive Management, XEP-0313) ---

  /** Shows the messages from our DB, then gets new messages from the server
   * archive (XEP-0313), skipping those already in our DB. */
  async listMessages(): Promise<void> {
    let lock = await this.syncLock.lock();
    try {
      await this.readMessagesFromDB();
      if (!this.account.isLoggedIn || !this.account.hasMAM) {
        return;
      }
      if (this.syncState) {
        await this.listNewMessages();
      } else {
        await this.listAllMessages();
      }
    } finally {
      lock.release();
    }
  }

  protected historyLoaded = false;

  protected async readMessagesFromDB(): Promise<void> {
    if (this.historyLoaded || !this.dbID) {
      return;
    }
    this.historyLoaded = true;
    await SQLChatMessage.readAll(this);
    this.lastMessage = this.messages.contents
      .filter((msg): msg is ChatMessage => msg instanceof ChatMessage)
      .reduce((last, msg) => !last || msg.sent > last.sent ? msg : last, null);
  }

  /** First sync: Gets all messages of this chat from the server archive,
   * oldest first, in batches. */
  protected async listAllMessages(): Promise<void> {
    await this.listMessagesAfter(null);
  }

  /** Gets only the messages that are newer than the newest one in our DB. */
  protected async listNewMessages(): Promise<void> {
    await this.listMessagesAfter(this.syncState);
  }

  /** Pages forward through the server archive, in batches: after the given
   * archive ID, or from the start of the archive. Saves each batch and updates
   * `syncState` at the end. */
  protected async listMessagesAfter(after: string | null): Promise<void> {
    while (true) {
      let result = await this.searchArchive({ max: kBatchSize, after: after || undefined });
      if (!result) { // `after` is too old: the server forgot that message
        if (!after) {
          break;
        }
        this.syncState = null;
        after = null; // restart from the beginning; dedup skips what we have
        continue;
      }
      let newMessages = await this.parseMessages(result.results);
      await this.saveNewMessages(newMessages.contents);
      after = sanitize.nonemptystring(result.paging?.last, null) ?? after;
      if (sanitize.boolean(result.complete, false) || !result.results?.length) {
        break;
      }
    }
    if (after && after != this.syncState) {
      this.syncState = after;
      await this.save();
    }
  }

  /** Asks the server archive about this 1:1 chat.
   * Group chats ask the room instead (XMPPGroupChat). */
  protected async queryArchive(paging: Paging): Promise<MAMFin> {
    return await this.account.client.searchHistory({ with: this.id, paging });
  }

  /** @returns null, if the paging window is gone on the server */
  protected async searchArchive(paging: Paging): Promise<MAMFin | null> {
    try {
      return await this.queryArchive(paging);
    } catch (errIQ) {
      let condition = sanitize.alphanumdash((errIQ as any)?.error?.condition, "");
      if (condition == "item-not-found") {
        return null;
      }
      if (condition == "service-unavailable" || condition == "feature-not-implemented") {
        this.account.hasMAM = false;
      }
      if (errIQ instanceof Error) {
        throw errIQ;
      }
      throw new Error(gt`Failed to get the chat history of ${this.name}: ${condition || JSON.stringify(errIQ)}`);
    }
  }

  protected async parseMessages(results: MAMResult[] = []): Promise<ArrayColl<XMPPChatMessage>> {
    let newMessages = new ArrayColl<XMPPChatMessage>();
    for (let result of results) {
      try {
        let msg = await this.addMessage(result.item?.message, result.item, result.id);
        if (msg) {
          newMessages.add(msg);
        }
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }
    // results within a MAM page are in chronological order
    let newest = newMessages.last;
    if (newest && (!this.lastMessage || newest.sent >= this.lastMessage.sent)) {
      this.lastMessage = newest;
    }
    return newMessages;
  }

  newMessage(): XMPPChatMessage {
    return new XMPPChatMessage(this);
  }

  newRoomEvent(kind?: RoomEventKind): ChatRoomEvent {
    if (kind && kind != RoomEventKind.Generic) {
      return super.newRoomEvent(kind);
    }
    return new XMPPRoomEvent(this);
  }
}
