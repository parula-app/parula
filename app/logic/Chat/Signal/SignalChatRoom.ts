/** Base class for Signal chat rooms (1:1 and group). Mirrors the IMAP `Folder`: it
 * loads history (DB then server) and lets a `SignalChatMessage` parse a decrypted
 * `Content` (`SignalChatMessage.fromSignal`) and send itself. The per-message wire
 * parsing and sending live on `SignalChatMessage`; the wire encryption + transport
 * live on `SignalAccount`; the room is crypto-free. */
import { ChatRoom } from "../ChatRoom";
import { ChatMessage, type RoomMessage } from "../ChatMessage";
import { SignalChatMessage } from "./SignalChatMessage";
import type { SignalContact } from "./SignalContact";
import type { SignalAccount } from "./SignalAccount";
import type { ServiceId } from "./ServiceId";
import { SQLChatMessage } from "../SQL/SQLChatMessage";
import { Lock } from "../../util/flow/Lock";
import type { DataMessage } from "./Proto/signalService";
import { TypingAction } from "./Proto/signalService";
import { ArrayColl } from "svelte-collections";

export class SignalChatRoom extends ChatRoom {
  declare account: SignalAccount;
  declare readonly members: ArrayColl<SignalContact>;

  /** The other side is currently typing (TypingMessage). */
  contactIsTyping = false;
  /** Disappearing-message timer in seconds (0 = off), and its version. */
  expireTimer = 0;
  expireTimerVersion = 1;
  /** Serializes DB-load and server history sync. */
  protected readonly syncLock = new Lock();

  /** The recipients a message to this room must be sent to (their ServiceIds).
   * 1:1 → the partner; group → every member. Subclasses implement. */
  recipients(): ServiceId[] {
    throw new Error("abstract");
  }

  newMessage(): SignalChatMessage {
    return new SignalChatMessage(this);
  }

  // --- receiving + sending: delegated to SignalChatMessage ---

  /** Find the message in this room with the given Signal send-timestamp (the message
   * key that reactions/edits/deletes/receipts reference). */
  findBySentTimestamp(timestamp: number): SignalChatMessage | undefined {
    return this.messages.contents.find(
      (m): m is SignalChatMessage => m instanceof SignalChatMessage && m.sentTimestamp == timestamp);
  }

  async sendMessage(message: SignalChatMessage): Promise<void> {
    await message.send();
  }

  sendTyping(started: boolean): void {
    this.account.sendContent(this.recipients(), {
      typingMessage: { timestamp: Date.now(), action: started ? TypingAction.Started : TypingAction.Stopped, groupId: this.typingGroupId() },
    }, Date.now()).catch(() => undefined);
  }

  /** The groupV2 context to attach to outgoing messages (group rooms override). */
  groupContext(): DataMessage["groupV2"] {
    return undefined;
  }

  /** The group id for TypingMessage (group rooms override). */
  protected typingGroupId(): Uint8Array | undefined {
    return undefined;
  }

  // --- persistence + history ---

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

  async listMessages(): Promise<void> {
    let lock = await this.syncLock.lock();
    try {
      await this.readMessagesFromDB();
    } finally {
      lock.release();
    }
  }

  /** Whether the persisted history has been loaded this session (load once). NOT
   * `messages.hasItems`: a live message can arrive before the room is opened, and
   * keying on "has any message" would then skip the DB load and hide the older
   * persisted history (the "after restart only new messages appear" bug). */
  protected historyLoaded = false;

  protected async readMessagesFromDB(): Promise<void> {
    if (this.historyLoaded || !this.dbID) {
      return;
    }
    this.historyLoaded = true;
    // readAll dedups by dbID, so any live message already in memory is not duplicated.
    await SQLChatMessage.readAll(this);
    this.lastMessage = this.messages.contents
      .filter((m): m is ChatMessage => m instanceof ChatMessage)
      .reduce((last, m) => !last || m.sent.getTime() > last.sent.getTime() ? m : last, null as ChatMessage | null);
  }
}
