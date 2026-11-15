/** History sync — the chat list and old messages the user's phone sends to a
 * freshly linked companion.
 *
 * After login (and on demand for older messages) the phone posts
 * `<message>`s whose payload is a `protocolMessage.historySyncNotification`:
 * a pointer to an encrypted, gzipped `HistorySync` blob on the media servers.
 * We download it, decrypt it (media crypto, "WhatsApp History Keys"), unzip it,
 * and turn its conversations + messages into our rooms + messages.
 *
 * The parsing (importHistory) is the substantive part and is unit-tested. The
 * download path (media_conn host + URL) can only be validated against the live
 * servers, so it is kept small and isolated here. */
import type { WhatsAppAccount } from "./WhatsAppAccount";
import { JID, kServerUser, kServerLid } from "./Binary/JID";
import { decryptMedia, MediaType } from "./Crypto/mediaCrypto";
import { concatBytes } from "../Signal/Crypto/primitives";
import { mediaURL, httpGet } from "./WhatsAppMedia";
import { waLog } from "./util";
import {
  decodeHistorySync, HistorySyncType, ProtocolMessageType, PeerDataOperationRequestType,
  type HistorySync, type HistorySyncNotification, type Conversation, type WAMessage,
} from "./Proto/schema";
import type { WhatsAppChatRoom } from "./WhatsAppChatRoom";
import { appGlobal } from "../../app";

/** The most messages the server will return for one on-demand request. */
const kOnDemandPageSize = 50;

export class WhatsAppHistorySync {
  constructor(protected account: WhatsAppAccount) {
  }

  /** Page back through messages OLDER than the bootstrap/full blob via on-demand
   * requests (see {@link pageOlderMessages}), so each chat fills its full history
   * rather than only the recent slice the phone pushes. Best-effort: the server may
   * silently drop on-demand requests for companion devices. */
  pageOnDemand = true;

  /** Chat JIDs with an on-demand paging loop in flight, so the import of the
   * resulting ON_DEMAND blob knows to request the next page (and stop on an
   * empty/short page). */
  protected paging = new Set<string>();

  /** Downloads the blob a notification points at, decrypts it, and imports the
   * chats and messages it contains. */
  async handleNotification(notification: HistorySyncNotification): Promise<void> {
    let syncType = notification.syncType ?? HistorySyncType.InitialBootstrap;
    // NO_HISTORY carries no blob — there is nothing (more) to fetch. Clean
    // terminal/no-op (also the server's terminal answer to on-demand paging).
    if (syncType == HistorySyncType.NoHistory) {
      waLog("history: no (more) history to sync");
      return;
    }
    try {
      let blob = await this.download(notification);
      let history = decodeHistorySync(blob);
      let result = await this.importHistory(history, syncType);
      waLog("history:", kSyncTypeName[syncType] ?? syncType, "imported",
        result.chats, "chats,", result.messages, "messages",
        syncType == HistorySyncType.Full ? "(full dump)" : "");
      // The bootstrap/full blob only carries each chat's recent slice. Page back
      // through every chat to pull the rest of its history (older than that slice).
      if (syncType == HistorySyncType.InitialBootstrap || syncType == HistorySyncType.Full) {
        await this.pageAllRooms();
      }
    } catch (ex) {
      // One bad blob shouldn't break the message stream; log and move on.
      console.error("WhatsApp: history sync failed:", (ex as any)?.message ?? ex);
    }
  }

  /** Creates rooms and back-fills messages from a decoded HistorySync. This is
   * what fills the chat list and the old messages in each chat. `syncType` lets
   * the on-demand paging loop continue when an ON_DEMAND blob arrives.
   * @returns how many chats and messages were added. */
  async importHistory(history: HistorySync, syncType = HistorySyncType.Full): Promise<{ chats: number, messages: number }> {
    // Contact display names. These can come in a dedicated sync, so apply them before
    // (and independently of) the conversations they name. Push names first; saved
    // address-book names (inlineContacts) applied after, so the saved one wins.
    for (let pushname of history.pushnames ?? []) {
      this.account.rememberContactName(pushname.id, pushname.pushname);
    }
    for (let contact of history.inlineContacts ?? []) {
      this.account.rememberContactName(contact.pnJID || contact.lidJID, contact.fullName || contact.firstName);
    }
    let chats = 0;
    let messages = 0;
    for (let conversation of history.conversations ?? []) {
      try {
        let added = await this.importConversation(conversation);
        if (added >= 0) {
          chats++;
          messages += added;
          if (syncType == HistorySyncType.OnDemand) {
            await this.continuePaging(conversation, added);
          }
        }
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }
    return { chats, messages };
  }

  protected async importConversation(conversation: Conversation): Promise<number> {
    let chat = conversation.id ? JID.parse(conversation.id) : null;
    let importable = !!chat && (chat.server == kServerUser || chat.server == kServerLid || chat.isGroup);
    if (!chat || !importable) {
      return -1; // status@broadcast, newsletters, malformed, …
    }
    if (chat.server == kServerUser && chat.user == "0") {
      return -1; // the official "WhatsApp" account: company notices, not a chat (else shows as "0")
    }
    let room = await this.account.getOrCreateRoom(chat, this.nameFor(conversation, chat));
    let added = 0;
    for (let stored of conversation.messages ?? []) {
      try {
        if (stored.message && await room.addHistoryMessage(stored.message)) {
          added++;
        }
      } catch (ex) {
        // One unparseable message must not abort the rest of the conversation.
        console.error("WhatsApp: history message import failed:", (ex as any)?.message ?? ex);
      }
    }
    return added;
  }

  /** A display name for the chat: a group's subject, or a 1:1 partner's name —
   * the conversation's resolved `displayName`, else a saved/push name we know for
   * the JID, else a push name off one of their messages. */
  protected nameFor(conversation: Conversation, chat: JID): string | undefined {
    let mapName = this.account.contactNames.get(chat.toNonDevice().toString());
    let incoming = (conversation.messages ?? []).find(stored => stored.message && !stored.message.key?.fromMe);
    let messagePushName = incoming?.message?.pushName;
    return chat.isGroup
      ? (conversation.name || conversation.displayName || undefined)
      : (conversation.displayName || mapName || messagePushName || undefined);
  }

  // --- on-demand paging: messages OLDER than the FULL dump (secondary, opt-in) ---
  //
  // requireFullSync already brings the phone's entire RETAINED history; this
  // pages back further still, for chats whose tail predates that retention. It
  // works by asking our own account, as a peer message, for the page of messages
  // immediately before the oldest one we hold, then repeating when that
  // ON_DEMAND blob imports — stopping on NO_HISTORY or a short/empty page.
  //
  // Best-effort: the server may silently drop on-demand requests for companion
  // devices, so this never replaces requireFullSync; it is gated
  // behind {@link pageOnDemand} and verifiable only against a live phone.

  /** Kick off backward paging for every chat that isn't already paging, to pull the
   * messages older than the recent slice the bootstrap/full blob carried. Each chat's
   * loop then continues (continuePaging) until the server returns a short/empty page. */
  protected async pageAllRooms(): Promise<void> {
    for (let room of this.account.rooms.contents) {
      if (!this.paging.has(room.id)) {
        await this.pageOlderMessages(room as WhatsAppChatRoom);
      }
    }
  }

  /** Requests the page of messages just before this room's oldest stored one.
   * No-op unless {@link pageOnDemand} is on, the room has a message to page from,
   * and the account can send peer messages. */
  async pageOlderMessages(room: WhatsAppChatRoom): Promise<void> {
    if (!this.pageOnDemand) {
      return;
    }
    let oldest = oldestMessage(room);
    if (!oldest?.id) {
      return; // nothing to anchor a request on yet
    }
    let payload = this.buildOnDemandRequest(room.id, oldest);
    this.paging.add(room.id);
    try {
      // Encrypts `payload` to our own account (the self-session) and sends it as
      // a `category="peer"` message; the phone replies with an ON_DEMAND blob.
      await this.account.sendPeerMessage(payload);
    } catch (ex) {
      this.paging.delete(room.id);
      console.error("WhatsApp: on-demand history request failed:", (ex as any)?.message ?? ex);
    }
  }

  /** The on-demand request `Message`: a peer protocolMessage asking for
   * `onDemandMsgCount` messages before `oldest` in `chatJID`. */
  protected buildOnDemandRequest(chatJID: string, oldest: { id: string, sent: Date, outgoing: boolean }): WAMessage {
    return {
      protocolMessage: {
        type: ProtocolMessageType.PeerDataOperationRequest,
        peerDataOperationRequestMessage: {
          peerDataOperationRequestType: PeerDataOperationRequestType.HistorySyncOnDemand,
          historySyncOnDemandRequest: {
            chatJID,
            oldestMsgID: oldest.id,
            oldestMsgFromMe: oldest.outgoing,
            onDemandMsgCount: kOnDemandPageSize,
            // SECONDS despite the upstream *MS name
            oldestMsgTimestampSec: Math.floor(oldest.sent.getTime() / 1000),
          },
        },
      },
    };
  }

  /** After an ON_DEMAND blob imported into a chat we are paging: if it filled a
   * page, ask for the next; otherwise (short/empty page) the chat is exhausted. */
  protected async continuePaging(conversation: Conversation, added: number): Promise<void> {
    if (!conversation.id) {
      return;
    }
    let id = JID.parse(conversation.id).toNonDevice().toString(); // same key pageOlderMessages used
    if (!this.paging.has(id)) {
      return;
    }
    // Stop when the chat is exhausted. Gauge that by the RAW page size, not the
    // post-dedup `added`: the response can re-include the anchor message we paged
    // from, so a full 50-message page can yield added=49 and would wrongly look
    // "short". Also stop when nothing new arrived (added=0) — no progress, so the
    // next request would just re-fetch the same page (and loop).
    let fullPage = (conversation.messages?.length ?? 0) >= kOnDemandPageSize;
    if (added == 0 || !fullPage) {
      this.paging.delete(id); // reached the start of this chat's history
      return;
    }
    let room = this.account.rooms.contents.find(r => r.id == id) as WhatsAppChatRoom | undefined;
    if (room) {
      await this.pageOlderMessages(room);
    }
  }

  /** Downloads and decrypts the gzipped HistorySync blob. Needs the live
   * connection (for the media host) and HTTP backend. */
  protected async download(notification: HistorySyncNotification): Promise<Uint8Array> {
    let url = await mediaURL(this.account.connection, notification.directPath!);
    let encrypted = await httpGet(url);
    let decrypted = await decryptMedia(encrypted, notification.mediaKey!, MediaType.History, notification.fileEncSHA256);
    return await inflate(decrypted);
  }
}

/** The chat's oldest stored message — the anchor an on-demand request pages
 * before. Picks the earliest by sent time; null for an empty room. */
function oldestMessage(room: WhatsAppChatRoom): { id: string, sent: Date, outgoing: boolean } | null {
  let oldest = room.messages.contents.reduce(
    (earliest, msg) => !earliest || msg.sent.getTime() < earliest.sent.getTime() ? msg : earliest,
    null as { id: string, sent: Date, outgoing: boolean } | null);
  return oldest?.id ? oldest : null;
}

/** HistorySyncType → a short name for the import log line. */
const kSyncTypeName: Record<number, string> = {
  [HistorySyncType.InitialBootstrap]: "bootstrap",
  [HistorySyncType.InitialStatusV3]: "status",
  [HistorySyncType.Full]: "FULL",
  [HistorySyncType.Recent]: "recent",
  [HistorySyncType.PushName]: "push-name",
  [HistorySyncType.NonBlockingData]: "non-blocking",
  [HistorySyncType.OnDemand]: "on-demand",
  [HistorySyncType.NoHistory]: "no-history",
};

/** Decompresses the history blob. Prefers the backend's Node zlib (reliable);
 * falls back to the renderer's DecompressionStream (trying gzip, then deflate,
 * then raw deflate) if the backend doesn't expose it (e.g. web build). */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  let backendGunzip = (appGlobal.remoteApp as any)?.gunzip;
  if (backendGunzip) {
    try {
      return new Uint8Array(await backendGunzip(data));
    } catch (ex) {
      console.warn("WhatsApp: backend gunzip failed, falling back:", (ex as any)?.message ?? ex);
    }
  }
  return await inflateMaybeGzip(data);
}

async function inflateMaybeGzip(data: Uint8Array): Promise<Uint8Array> {
  let formats: CompressionFormat[] = ["gzip", "deflate", "deflate-raw"];
  for (let format of formats) {
    try {
      return await decompress(data, format);
    } catch (ex) {
      // not this format — try the next
    }
  }
  throw new Error("history: blob is not gzip/deflate (decrypt may be wrong)");
}

async function decompress(data: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
  let stream = new DecompressionStream(format);
  let writer = stream.writable.getWriter();
  void writer.write(data as BufferSource);
  void writer.close();
  let reader = stream.readable.getReader();
  let chunks: Uint8Array[] = [];
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    chunks.push(chunk.value);
  }
  return concatBytes(...chunks);
}
