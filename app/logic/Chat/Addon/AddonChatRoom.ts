import { ChatRoom } from "../ChatRoom";
import { ChatMessage, DeliveryStatus } from "../ChatMessage";
import { AddonChatMessage } from "./AddonChatMessage";
import type { AddonChatAccount } from "./AddonChatAccount";
import type { ChatPersonUID } from "../ChatPersonUID";
import { SQLChatMessage } from "../SQL/SQLChatMessage";
import { Group } from "../../Abstract/Group";
import { Lock } from "../../util/flow/Lock";
import { RunAgain } from "../../util/flow/RunAgain";
import { NotSupported } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { ArrayColl } from "svelte-collections";

export class AddonChatRoom extends ChatRoom {
  /** id: of the server */
  declare account: AddonChatAccount;
  /** Opaque, from the addon */
  declare syncState: string | null;
  protected readonly syncLock = new Lock();
  protected newMessagesRunAgain = new RunAgain(100);
  protected haveReadMessagesFromDB = false;

  constructor(account: AddonChatAccount) {
    super(account);
  }

  /** @param json `RoomData` from the addon, unchecked */
  fromAddon(json: any) {
    const kMaxMembers = 10000;
    const kMaxLength = 1000;
    let account = this.account;
    let connection = account.connection;
    let id = connection.checkID(json.id);
    let members = new ArrayColl<ChatPersonUID>();
    for (let member of connection.checkList(json.members ?? [], kMaxMembers, "members")) {
      try {
        members.add(account.getPersonUID(connection.checkID(member?.id), connection.checkText(member?.name, kMaxLength, null) ?? undefined));
      } catch (ex) {
        account.dataError(ex);
      }
    }
    let name = connection.checkText(json.name, kMaxLength, null);
    if (json.isGroup === true) {
      let group = this.contact instanceof Group ? this.contact : new Group();
      group.name = name ?? id;
      this.contact = group;
      this.name = group.name;
    } else {
      if (members.isEmpty) {
        throw new Error(`${account.name}: The addon gave a chat with nobody`);
      }
      this.contact = members.first;
      if (!account.roster.includes(members.first)) {
        account.roster.add(members.first);
      }
    }
    this.id = id;
    this.members.replaceAll(members.contents);
  }

  /** Shows the messages that we have, then gets the new, changed and removed messages from the addon, in chunks */
  async listMessages(): Promise<void> {
    let lock = await this.syncLock.lock();
    try {
      await this.readMessagesFromDB();
      await this.account.connection.listChanges("listMessages", [this.id], this.syncState, "messages",
        async (messages, removed, syncState) => await this.applyMessageList(messages, removed, syncState));
    } finally {
      lock.release();
    }
  }

  protected async readMessagesFromDB(): Promise<void> {
    if (this.haveReadMessagesFromDB || !this.dbID) {
      return;
    }
    this.haveReadMessagesFromDB = true;
    await SQLChatMessage.readAll(this);
    this.updateLastMessage();
  }

  /** Stores one checked chunk from the addon */
  protected async applyMessageList(messages: any[], removed: unknown[], syncState: string): Promise<void> {
    let account = this.account;
    let byID = new Map<string, AddonChatMessage>();
    for (let message of this.messages) {
      if (message instanceof AddonChatMessage) {
        byID.set(message.id, message);
      }
    }
    let added = new ArrayColl<AddonChatMessage>();
    let changed = new ArrayColl<AddonChatMessage>();
    for (let json of messages) {
      try {
        let id = account.connection.checkID(json?.id);
        let message = byID.get(id) ?? this.newMessage();
        message.fromAddon(json);
        if (!byID.has(id)) {
          byID.set(id, message);
          added.add(message);
        }
        changed.add(message);
      } catch (ex) {
        account.dataError(ex);
      }
    }
    let gone = new ArrayColl<AddonChatMessage>();
    for (let id of removed) {
      let message = typeof id == "string" ? byID.get(id) : undefined;
      if (message) {
        gone.add(message);
      }
    }

    this.messages.addAll(added);
    this.messages.removeAll(gone);
    changed.removeAll(gone);
    if (!this.dbID) {
      await this.save();
    }
    for (let message of gone) {
      if (message.dbID) {
        await account.storage.deleteMessage(message);
      }
    }
    for (let message of changed) {
      await message.save();
    }
    this.syncState = syncState;
    this.updateLastMessage();
    await this.save();
  }

  protected updateLastMessage(): void {
    this.lastMessage = this.messages.contents
      .filter((message): message is ChatMessage => message instanceof ChatMessage)
      .reduce((last, message) => !last || message.sent > last.sent ? message : last, null);
  }

  /** The addon says that the server has new messages.
   * While a sync runs, more of these result in one more sync. */
  newMessagesOnServer(): void {
    this.newMessagesRunAgain.run(async () => {
      await this.listMessages();
    }).catch(this.account.errorCallback);
  }

  async sendMessage(message: AddonChatMessage): Promise<void> {
    let connection = this.account.connection;
    if (message.attachments.hasItems) {
      throw new NotSupported(gt`The addon ${connection.addonName} can't send files`);
    }
    message.deliveryStatus = DeliveryStatus.Sending;
    if (!this.messages.contains(message)) {
      this.messages.add(message);
    }
    let id = await connection.call("sendMessage", this.id, {
      text: message.text,
      html: message.hasHTML ? message.html : null,
      inReplyTo: message.inReplyTo ?? null,
    });
    message.id = connection.checkID(id);
    message.sent ??= new Date();
    message.received ??= new Date();
    message.deliveryStatus = DeliveryStatus.Server;
    this.lastMessage = message;
    if (!this.dbID) {
      await this.save();
    }
    await message.save();
  }

  newMessage(): AddonChatMessage {
    return new AddonChatMessage(this);
  }
}
