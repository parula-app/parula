/** Link-and-sync: request the primary's message-history transfer archive and import
 * it (Docs/02 §B.6, Docs/10). After this device is linked, the primary uploads an
 * encrypted message backup and announces it via `PUT /v1/devices/transfer_archive`;
 * we long-poll `GET /v1/devices/transfer_archive` for the location, download the
 * blob from the CDN, decrypt it with the one-time `ephemeralBackupKey`, and turn its
 * frames into rooms + messages — mirroring the live receive path.
 *
 * The transfer only happens if the user tapped "Transfer Message History" on their
 * phone (which is also what makes the primary include `ephemeralBackupKey` in the
 * ProvisionMessage). We surface that wait to the UI via `onStatus`. */
import type { SignalAccount } from "../SignalAccount";
import type { SignalChatRoom } from "../SignalChatRoom";
import type { SignalChatMessage } from "../SignalChatMessage";
import type { SignalContact } from "../SignalContact";
import { DeliveryStatus } from "../../ChatMessage";
import { ServiceId } from "../ServiceId";
import { decryptMessageBackup } from "../Encryption/MessageBackupCipher";
import { decode } from "../Proto/codec";
import { BackupInfo, Frame, type Contact, type Recipient, type Chat, type ChatItem, type FilePointer, type Reaction } from "../Proto/backup";
import { cdnHost } from "./SignalApi";
import { signalLog } from "../util";
import { gt } from "../../../../l10n/l10n";

export type BackupImportStatus = "awaiting-approval" | "downloading" | "importing" | "done" | "skipped";

/** Where the primary put the archive (`RemoteAttachment`); the error variant has
 * `error` set and no `cdn`/`key`. */
interface TransferArchiveResult {
  cdn?: number;
  key?: string;
  error?: string;
}

/** How long each long-poll asks the server to hold the request (seconds). The client
 * timeout is a bit longer so the server, not us, ends the poll. */
const POLL_SECONDS = 60;
/** Stop waiting for the user to approve on their phone after this long. */
const MAX_WAIT_MS = 15 * 60 * 1000;

export class MessageBackupImport {
  protected cancelled = false;

  constructor(readonly account: SignalAccount) {}

  /** Give up waiting for the archive (e.g. the user chose "Skip" in the dialog). */
  cancel(): void {
    this.cancelled = true;
  }

  /** Run the whole transfer: wait for the archive, download, decrypt, import.
   * Best-effort — never throws; logs and reports `skipped` on any failure so that
   * linking still completes. */
  async run(ephemeralBackupKey: Uint8Array, onStatus: (status: BackupImportStatus) => void): Promise<void> {
    try {
      onStatus("awaiting-approval");
      let archive = await this.waitForArchive();
      if (this.cancelled || !archive?.cdn || !archive.key) {
        onStatus("skipped");
        return;
      }
      onStatus("downloading");
      let blob = await this.download(archive.cdn, archive.key);
      onStatus("importing");
      let plaintext = await decryptMessageBackup(ephemeralBackupKey, this.account.aci!, blob);
      await this.importFrames(plaintext);
      onStatus("done");
    } catch (ex) {
      this.account.errorCallback(ex as Error);
      onStatus("skipped");
    }
  }

  /** Long-poll `GET /v1/devices/transfer_archive` until the primary uploads it (the
   * server holds each request open, returning 204 on its own timeout → we loop) or
   * we hit {@link MAX_WAIT_MS} / are cancelled. */
  protected async waitForArchive(): Promise<TransferArchiveResult | null> {
    let deadline = Date.now() + MAX_WAIT_MS;
    while (!this.cancelled && Date.now() < deadline) {
      let result = await this.account.api().jsonLongPoll<TransferArchiveResult | undefined>(
        `/v1/devices/transfer_archive?timeout=${POLL_SECONDS}`,
        this.account.authCredentials(),
        (POLL_SECONDS + 10) * 1000);
      if (!result) {
        continue; // 204: server-side poll timeout, ask again
      }
      if (result.error) {
        signalLog(`Signal: transfer archive not available (${result.error})`);
        return null;
      }
      return result;
    }
    return null;
  }

  /** Download the archive blob from the CDN. It is uploaded as a plain v4 attachment,
   * so the path is the same unauthenticated `attachments/{cdnKey}` as a normal
   * attachment download — but the bytes are the self-encrypting backup file. */
  protected async download(cdn: number, key: string): Promise<Uint8Array> {
    let url = `${cdnHost(cdn)}/attachments/${encodeURIComponent(key)}`;
    let res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      throw new Error(`Signal: transfer archive download failed: HTTP ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Parse the decompressed varint-delimited frame stream and import the chats. The
   * first frame is BackupInfo; the rest are Frames, with referenced Recipients/Chats
   * always preceding the ChatItems that use them (backup.proto ordering rule), so a
   * single forward pass works. */
  protected async importFrames(data: Uint8Array): Promise<void> {
    let frames = [...iterateDelimited(data)];
    if (!frames.length) {
      return;
    }
    decode(BackupInfo, frames[0]); // header — validated by decrypt; nothing to import

    let recipients = new Map<number, Recipient>();
    let chats = new Map<number, Chat>();
    let roomByChatId = new Map<number, RoomResolution | null>();
    let perRoom = new Map<SignalChatRoom, SignalChatMessage[]>();
    let stats = { messages: 0, attachments: 0, systemSkipped: 0, unresolved: 0 };

    for (let raw of frames.slice(1)) {
      let frame = decode(Frame, raw);
      // Exactly one oneof arm is set; ids default to 0 if proto3-omitted (Signal
      // generates them from 1, so 0 only happens for an absent field).
      if (frame.recipient) {
        recipients.set(frame.recipient.id ?? 0, frame.recipient);
      } else if (frame.chat) {
        chats.set(frame.chat.id ?? 0, frame.chat);
      } else if (frame.chatItem) {
        await this.importChatItem(frame.chatItem, recipients, chats, roomByChatId, perRoom, stats);
      }
    }

    for (let [room, messages] of perRoom) {
      if (!messages.length) {
        continue;
      }
      room.lastMessage = messages.reduce((a, b) => a.sent.getTime() > b.sent.getTime() ? a : b);
      await room.saveNewMessages(messages);
    }
    signalLog(`Signal: imported ${stats.messages} message(s) into ${perRoom.size} chat(s); ${stats.attachments} attachment(s) downloading; skipped ${stats.systemSkipped} system item(s), ${stats.unresolved} unresolved`);
  }

  protected async importChatItem(
    item: ChatItem,
    recipients: Map<number, Recipient>,
    chats: Map<number, Chat>,
    roomByChatId: Map<number, RoomResolution | null>,
    perRoom: Map<SignalChatRoom, SignalChatMessage[]>,
    stats: { messages: number, attachments: number, systemSkipped: number, unresolved: number },
  ): Promise<void> {
    let content = extractContent(item);
    if (!content) {
      stats.systemSkipped++; // updateMessage / poll / gift / payment / story reply (TODO)
      return;
    }
    if (!content.deleted && !content.text && !content.attachments.length) {
      return; // nothing to show (e.g. a body-less link-preview-only message)
    }
    let resolved = await this.resolveRoom(item.chatId ?? 0, chats, recipients, roomByChatId);
    if (!resolved) {
      stats.unresolved++;
      return;
    }
    let { room, partner } = resolved;

    let ms = Number(item.dateSent ?? 0n);
    if (room.findBySentTimestamp(ms)) {
      return; // a live message already delivered this one
    }
    let outgoing = !!item.outgoing;
    if (!outgoing && !item.incoming) {
      return; // directionless (not a user-visible message — e.g. a group update)
    }
    let from = this.resolveAuthor(item, recipients, outgoing, partner);
    if (!from) {
      stats.unresolved++;
      return; // an incoming message we can't attribute to anyone
    }

    let msg = room.newMessage();
    msg.setSentTimestamp(ms);
    msg.outgoing = outgoing;
    msg.from = from;
    msg.contact = room.contact;
    msg.sent = new Date(ms);
    msg.received = new Date(Number(item.incoming?.dateReceived ?? item.outgoing?.dateReceived ?? ms));
    msg.deliveryStatus = outgoing ? DeliveryStatus.Server
      : item.incoming?.read ? DeliveryStatus.Seen : DeliveryStatus.User;

    if (content.deleted) {
      msg.deleted = true;
      msg.text = gt`This message was deleted`;
    } else {
      msg.text = content.text;
      msg.edited = !!item.revisions?.length;
      if (content.quoteTarget) {
        msg.inReplyTo = String(Number(content.quoteTarget));
      }
      this.applyReactions(msg, content.reactions, recipients);
      for (let pointer of content.attachments) {
        stats.attachments++;
        // Genuine background work: download + decrypt media off the CDN, then persist.
        this.account.media.downloadFilePointer(msg, pointer)
          .then(downloaded => downloaded ? msg.save() : undefined)
          .catch(ex => this.account.errorCallback(ex));
      }
    }
    room.messages.add(msg);

    let list = perRoom.get(room) ?? [];
    list.push(msg);
    perRoom.set(room, list);
    stats.messages++;
  }

  /** Resolve (and cache) the room a chat's ChatItems belong to: a 1:1 contact room,
   * a group room (fetched by master key), or Note-to-Self. Also seeds the room's
   * disappearing-message timer from the Chat frame. */
  protected async resolveRoom(
    chatId: number,
    chats: Map<number, Chat>,
    recipients: Map<number, Recipient>,
    cache: Map<number, RoomResolution | null>,
  ): Promise<RoomResolution | null> {
    if (cache.has(chatId)) {
      return cache.get(chatId)!;
    }
    let resolved = await this.resolveRoomUncached(chats.get(chatId), recipients);
    cache.set(chatId, resolved);
    return resolved;
  }

  protected async resolveRoomUncached(chat: Chat | undefined, recipients: Map<number, Recipient>): Promise<RoomResolution | null> {
    let recipient = chat ? recipients.get(chat.recipientId ?? 0) : undefined;
    if (!recipient) {
      return null;
    }
    let room: SignalChatRoom | null = null;
    let partner: SignalContact | null = null;
    if (recipient.group?.masterKey?.length) {
      try {
        room = await this.account.getOrCreateGroupRoom(recipient.group.masterKey);
      } catch (ex) {
        this.account.errorCallback(ex as Error); // not a member anymore, or fetch failed
        return null;
      }
    } else if (recipient.contact?.aci?.length) {
      let serviceId = ServiceId.aci(recipient.contact.aci);
      room = await this.account.getOrCreateRoom(serviceId);
      partner = this.account.getContact(serviceId);
      this.applyContactName(partner, recipient.contact);
    } else if (recipient.self && this.account.aci) {
      room = await this.account.getOrCreateRoom(this.account.aci); // Note to Self
      partner = this.account.getOwnContact();
    } else {
      return null;
    }
    if (chat?.expirationTimerMs) {
      room.expireTimer = Math.round(Number(chat.expirationTimerMs) / 1000);
    }
    return { room, partner };
  }

  /** The author of a message: self for outgoing, else the ChatItem's authorId
   * recipient (the group member or 1:1 partner), falling back to the 1:1 partner. */
  protected resolveAuthor(item: ChatItem, recipients: Map<number, Recipient>, outgoing: boolean, partner: SignalContact | null): SignalContact | null {
    if (outgoing) {
      return this.account.getOwnContact();
    }
    return this.recipientToContact(recipients.get(item.authorId ?? 0)) ?? partner;
  }

  protected applyReactions(msg: SignalChatMessage, reactions: Reaction[], recipients: Map<number, Recipient>): void {
    for (let reaction of reactions) {
      let author = this.recipientToContact(recipients.get(reaction.authorId ?? 0));
      if (author && reaction.emoji) {
        msg.reactions.set(author, reaction.emoji);
      }
    }
  }

  /** Map a Recipient to its SignalContact (self → our own contact), or null for a
   * group / ACI-less recipient. Seeds the contact's name from the backup. */
  protected recipientToContact(recipient: Recipient | undefined): SignalContact | null {
    if (recipient?.self) {
      return this.account.getOwnContact();
    }
    let contact = recipient?.contact;
    if (!contact?.aci?.length) {
      return null;
    }
    let signalContact = this.account.getContact(ServiceId.aci(contact.aci));
    this.applyContactName(signalContact, contact);
    return signalContact;
  }

  /** Give a freshly imported contact a display name from the backup if it has none
   * yet (the live roster/profile sync would otherwise be the only source). */
  protected applyContactName(partner: SignalContact, contact: Contact): void {
    if (partner.name) {
      return;
    }
    let name = displayName(contact);
    if (name) {
      partner.name = name;
    }
  }
}

/** A resolved chat room plus its 1:1 partner contact (null for groups / Note-to-Self). */
interface RoomResolution {
  room: SignalChatRoom;
  partner: SignalContact | null;
}

/** The renderable content of a ChatItem, normalised across the message item types. */
interface ItemContent {
  text: string;
  attachments: FilePointer[];
  reactions: Reaction[];
  quoteTarget?: bigint;
  deleted?: boolean;
}

/** Pull the human content out of a ChatItem, or null for a non-message item (system
 * update, poll, gift badge, payment, story reply) we don't import. */
function extractContent(item: ChatItem): ItemContent | null {
  if (item.remoteDeletedMessage || item.adminDeletedMessage) {
    return { text: "", attachments: [], reactions: [], deleted: true };
  }
  let sm = item.standardMessage;
  if (sm) {
    return {
      text: sm.text?.body ?? "",
      attachments: (sm.attachments ?? []).map(a => a.pointer).filter((p): p is FilePointer => !!p),
      reactions: sm.reactions ?? [],
      quoteTarget: sm.quote?.targetSentTimestamp,
    };
  }
  let sticker = item.stickerMessage;
  if (sticker) {
    return {
      text: sticker.sticker?.emoji ?? "",
      attachments: sticker.sticker?.data ? [sticker.sticker.data] : [],
      reactions: sticker.reactions ?? [],
    };
  }
  let viewOnce = item.viewOnceMessage;
  if (viewOnce) {
    return {
      text: "",
      attachments: viewOnce.attachment?.pointer ? [viewOnce.attachment.pointer] : [],
      reactions: viewOnce.reactions ?? [],
    };
  }
  let contactMsg = item.contactMessage;
  if (contactMsg) {
    return { text: contactCardText(contactMsg), attachments: [], reactions: contactMsg.reactions ?? [] };
  }
  return null;
}

function contactCardText(contactMsg: NonNullable<ChatItem["contactMessage"]>): string {
  let name = contactMsg.contact?.name;
  let display = [name?.givenName, name?.familyName].filter(Boolean).join(" ").trim()
    || name?.nickname || contactMsg.contact?.organization || "";
  return display || gt`Shared contact`;
}

function displayName(contact: Contact): string {
  let parts = [
    [contact.nickname?.given, contact.nickname?.family],
    [contact.profileGivenName, contact.profileFamilyName],
    [contact.systemGivenName, contact.systemFamilyName],
  ];
  for (let [given, family] of parts) {
    let name = [given, family].filter(Boolean).join(" ").trim();
    if (name) {
      return name;
    }
  }
  return contact.username || (contact.e164 ? "+" + contact.e164 : "");
}

/** Iterate a stream of varint-length-delimited protobuf messages (Signal's backup
 * framing): each message is preceded by its byte length as a base-128 varint. */
function* iterateDelimited(data: Uint8Array): Iterable<Uint8Array> {
  let pos = 0;
  while (pos < data.length) {
    let length = 0, shift = 0;
    for (;;) {
      if (pos >= data.length) {
        throw new Error("Signal: truncated varint in backup frame stream");
      }
      let byte = data[pos++];
      length |= (byte & 0x7f) << shift;
      if ((byte & 0x80) == 0) {
        break;
      }
      shift += 7;
    }
    if (pos + length > data.length) {
      throw new Error("Signal: backup frame length exceeds stream");
    }
    yield data.subarray(pos, pos + length);
    pos += length;
  }
}
