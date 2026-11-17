import type { WhatsAppAccount } from "../WhatsAppAccount";
import type { ChatRoom } from "../../ChatRoom";
import { ChatMessage, type RoomMessage } from "../../ChatMessage";
import { SQLChatMessage } from "../../SQL/SQLChatMessage";
import { getDatabase } from "../../SQL/SQLDatabase";
import { ContactEntry, Person } from "../../../Abstract/Person";
import { WhatsAppContact } from "../WhatsAppContact";
import { JID } from "../Binary/JID";
import { Group } from "../../../Abstract/Group";
import { Attachment, ContentDisposition } from "../../../Abstract/Attachment";
import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";
import { getSQLiteDatabase } from "../../../util/backend-wrapper";
import { appGlobal } from "../../../app";
import { UserError, assert } from "../../../util/util";
import { gt } from "../../../../l10n/l10n";
import type { Database } from "../../../../../lib/rs-sqlite";
import sql from "../../../../../lib/rs-sqlite";

/**
 * Imports chats, messages and contacts from a decrypted WhatsApp Android backup
 * (msgstore.db and wa.db) into a `WhatsAppAccount` and our local database.
 *
 * Importing the same or a newer backup again will not duplicate anything:
 * Chats are matched by their JID, messages by WhatsApp's stable message key,
 * and contacts by WhatsApp ID, phone number or full name.
 */
export class WhatsAppBackupImport {
  account: WhatsAppAccount;
  onProgress: ((progress: ImportProgress) => void) | null;
  readonly progress = new ImportProgress();
  protected msgstore: Database;
  /** jid._id -> raw JID string, with @lid aliases resolved to phone number JIDs */
  protected jidByRowID = new Map<number, string>();
  /** raw JID string -> contact display name, from wa.db */
  protected nameByJID = new Map<string, string>();
  protected personByJID = new Map<string, Person>();
  /** msgstore message._id -> imported message, for attaching reactions */
  protected messageByRowID = new Map<number, RoomMessage>();

  constructor(account: WhatsAppAccount, onProgress?: (progress: ImportProgress) => void) {
    this.account = account;
    this.onProgress = onProgress;
  }

  /**
   * @param msgstoreDB Decrypted contents of msgstore.db (the messages)
   * @param waDB Decrypted contents of wa.db (the contact names), optional
   */
  async importBackup(msgstoreDB: Uint8Array, waDB?: Uint8Array): Promise<ImportProgress> {
    this.msgstore = await openDatabase(msgstoreDB);
    try {
      await this.checkMsgstore();
      if (waDB) {
        await this.readContactNames(waDB);
      }
      await this.readJIDs();
      await this.account.readFromDB(); // load previously imported chats, to avoid duplication
      let chats = await this.msgstore.all(sql`
        SELECT _id as rowID, jid_row_id as jidRowID, subject, created_timestamp as createdTime
        FROM chat
        `) as any[];
      chats = chats.filter(chat => this.shouldImportChat(chat));
      this.progress.chatsTotal = chats.length;
      this.progress.messagesTotal = await this.countImportableMessages(chats.map(chat => chat.rowID));
      this.notifyProgress();
      for (let chat of chats) {
        try {
          await this.importChat(chat);
        } catch (ex) {
          this.account.errorCallback(ex);
        }
        this.progress.chatsDone++;
        this.notifyProgress();
      }
      await this.importReactions();
      return this.progress;
    } finally {
      (this.msgstore as any).close();
      this.msgstore = null;
    }
  }

  protected async checkMsgstore(): Promise<void> {
    assert(await this.tableExists("chat") && await this.tableExists("jid"),
      gt`This file is not a WhatsApp message backup (msgstore.db)`);
    if (!await this.tableExists("message")) {
      throw new UserError(gt`This backup is from a WhatsApp version that is too old. Please make a fresh backup with a current WhatsApp version.`);
    }
  }

  protected async tableExists(name: string, db: Database = this.msgstore): Promise<boolean> {
    let row = await db.get(sql`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${name}
      `) as any;
    return !!row;
  }

  /** Reads the JID table, and resolves WhatsApp's privacy aliases (@lid)
   * to the corresponding phone number JIDs, so that imports of older and newer
   * backups of the same account identify chats and people the same way. */
  protected async readJIDs(): Promise<void> {
    let rows = await this.msgstore.all(sql`
      SELECT _id as rowID, raw_string as jid FROM jid
      `) as any[];
    for (let row of rows) {
      if (row.jid) {
        this.jidByRowID.set(row.rowID, row.jid);
      }
    }
    if (await this.tableExists("jid_map")) {
      let maps = await this.msgstore.all(sql`
        SELECT lid_row_id as lidRowID, jid_row_id as jidRowID FROM jid_map
        `) as any[];
      for (let map of maps) {
        let phoneJID = this.jidByRowID.get(map.jidRowID);
        if (phoneJID) {
          this.jidByRowID.set(map.lidRowID, phoneJID);
        }
      }
    }
  }

  /** Reads contact names from wa.db */
  protected async readContactNames(waDB: Uint8Array): Promise<void> {
    let db = await openDatabase(waDB);
    try {
      assert(await this.tableExists("wa_contacts", db),
        gt`This file is not a WhatsApp contacts backup (wa.db)`);
      let rows = await db.all(sql`
        SELECT jid, display_name as displayName, wa_name as waName FROM wa_contacts
        `) as any[];
      for (let row of rows) {
        let name = row.displayName ?? row.waName;
        if (row.jid && name) {
          this.nameByJID.set(row.jid, name);
        }
      }
    } finally {
      (db as any).close();
    }
  }

  protected shouldImportChat(chat: any): boolean {
    let jid = this.jidByRowID.get(chat.jidRowID);
    if (!jid) {
      return false;
    }
    let server = jid.split("@")[1];
    // Skip the status feed, broadcast lists (their messages are also in the
    // 1:1 chats) and channels. Import 1:1 chats, groups, and lid 1:1 chats
    // of contacts who hide their phone number.
    return server == "s.whatsapp.net" || server == "g.us" || server == "lid";
  }

  protected async importChat(chat: any): Promise<void> {
    let jid = this.jidByRowID.get(chat.jidRowID);
    let isGroup = jid.endsWith("@g.us");
    this.progress.currentChat = isGroup ? chat.subject : this.displayName(jid);
    this.notifyProgress();
    // Match (and create) the room with the same id the live account uses, so an
    // import on top of a live account re-uses its rooms and its messages dedup.
    let roomID = JID.parse(jid).toNonDevice().toString();
    let room = this.account.rooms.contents.find(r => r.id == roomID);
    // WhatsApp has chat rows for many contacts without any conversation,
    // e.g. when our user merely opened the chat screen, or for groups with
    // only system events. Don't create rooms (and contacts) for those.
    if (!room && !await this.countImportableMessages([chat.rowID])) {
      return;
    }
    if (isGroup) {
      let group = room?.contact instanceof Group ? room.contact : null;
      group = await this.importGroup(chat, jid, group);
      if (!room) {
        room = this.account.newRoom();
        room.id = roomID;
        room.contact = group;
        this.account.rooms.set(group, room);
      }
      room.name = group.name;
      room.members.replaceAll(group.participants.contents.map(person => this.contactForPerson(person)));
    } else if (!room) {
      let contact = await this.getOrCreateContact(jid);
      room = this.account.newRoom();
      room.id = jid;
      room.contact = contact;
      room.members.replaceAll([contact]);
      if (!this.account.roster.includes(contact)) {
        this.account.roster.add(contact);
      }
      this.account.rooms.set(contact, room);
    }
    await room.save();
    await this.importMessages(room, chat.rowID, isGroup);
  }

  /** Counts the messages that `importMessages()` will process,
   * using the same filter */
  protected async countImportableMessages(chatRowIDs: number[]): Promise<number> {
    let row = await this.msgstore.get(sql`
      SELECT COUNT(*) as count FROM message
      WHERE chat_row_id IN ${chatRowIDs}
        AND IFNULL(status, 0) <> 6 AND IFNULL(message_type, 0) <> 7
        AND IFNULL(key_id, '') <> ''
      `) as any;
    return row.count;
  }

  protected async importGroup(chat: any, jid: string, existing: Group | null): Promise<Group> {
    let group = existing ?? appGlobal.personalAddressbook.newGroup();
    group.name = chat.subject || gt`WhatsApp group`;
    let members = await this.msgstore.all(sql`
      SELECT user_jid_row_id as userJidRowID FROM group_participant_user
      WHERE group_jid_row_id = ${chat.jidRowID}
      `) as any[];
    for (let member of members) {
      let memberJID = this.jidByRowID.get(member.userJidRowID);
      if (!memberJID || !memberJID.includes("@")) { // skip empty self entry
        continue;
      }
      let person = await this.getOrCreatePerson(memberJID);
      group.participants.add(person);
    }
    if (!existing) {
      appGlobal.personalAddressbook.groups.add(group);
    }
    await group.save();
    return group;
  }

  /** Finds the contact for this WhatsApp user, first by WhatsApp ID,
   * then by phone number, then by full name. Creates the contact in the
   * personal address book, if not found. */
  protected async getOrCreatePerson(jid: string): Promise<Person> {
    let person = this.personByJID.get(jid);
    if (person) {
      return person;
    }
    let name = this.displayName(jid);
    let phone = jid.endsWith("@s.whatsapp.net") ? "+" + jid.split("@")[0] : null;
    let jidLower = jid.toLowerCase();
    person = appGlobal.persons.find(p =>
      p.chatAccounts.some(e => e.protocol == "whatsapp" && e.value?.toLowerCase() == jidLower));
    if (!person && phone) {
      person = appGlobal.persons.find(p =>
        p.phoneNumbers.some(e => phoneNumbersMatch(e.value, phone)));
    }
    if (!person && this.nameByJID.has(jid)) {
      person = appGlobal.persons.find(p => p.name == name);
    }
    let changed = false;
    if (!person) {
      person = appGlobal.personalAddressbook.newPerson();
      person.name = name;
      appGlobal.personalAddressbook.persons.add(person);
      changed = true;
    }
    if (!person.chatAccounts.some(e => e.protocol == "whatsapp" && e.value?.toLowerCase() == jidLower)) {
      person.chatAccounts.add(new ContactEntry(jid, "WhatsApp", "whatsapp"));
      changed = true;
    }
    if (phone && !person.phoneNumbers.some(e => phoneNumbersMatch(e.value, phone))) {
      person.phoneNumbers.add(new ContactEntry(phone, "mobile", "tel"));
      changed = true;
    }
    if (changed) {
      await person.save();
    }
    this.personByJID.set(jid, person);
    return person;
  }

  /** The chat contact (`WhatsAppContact`) for a JID
   * Linked to the addressbook `Person` that the import creates or reuses. */
  protected async getOrCreateContact(jid: string): Promise<WhatsAppContact> {
    let person = await this.getOrCreatePerson(jid);
    return this.contactForPerson(person, jid);
  }

  /** @returns an addressbook `Person` as a `WhatsAppContact` */
  protected contactForPerson(person: Person, jid?: string): WhatsAppContact {
    jid ??= person.chatAccounts.find(e => e.protocol == "whatsapp")?.value;
    if (!jid) {
      return null;
    }
    let contact = this.account.getPersonUID(jid, person.name);
    contact.person = person;
    contact.picture ??= person.picture;
    return contact;
  }

  protected displayName(jid: string): string {
    return this.nameByJID.get(jid) ??
      (jid.endsWith("@s.whatsapp.net") ? "+" + jid.split("@")[0] : jid.split("@")[0]);
  }

  protected async importMessages(room: ChatRoom, chatRowID: number, isGroup: boolean): Promise<void> {
    // IDs of messages that a previous import already saved
    let existing = await (await getDatabase()).all(sql`
      SELECT idStr FROM message WHERE chatID = ${room.dbID}
      `) as any[];
    let known = new Set(existing.map(row => row.idStr));

    let media = await this.tableExists("message_media");
    let quoted = await this.tableExists("message_quoted");
    let location = await this.tableExists("message_location");
    let rows = await this.msgstore.all(sql`
      SELECT
        message._id as rowID, message.key_id as keyID, message.from_me as fromMe,
        message.sender_jid_row_id as senderJidRowID,
        message.timestamp as sentTime, message.received_timestamp as receivedTime,
        message.status as status, message.message_type as type,
        message.text_data as text, message.starred as starred
        $${media ? sql`,
        message_media.file_path as filePath, message_media.mime_type as mimeType,
        message_media.file_length as fileSize, message_media.media_name as mediaName,
        message_media.media_caption as mediaCaption` : sql``}
        $${quoted ? sql`,
        message_quoted.key_id as quotedKeyID, message_quoted.from_me as quotedFromMe,
        message_quoted.sender_jid_row_id as quotedSenderJidRowID` : sql``}
        $${location ? sql`,
        message_location.latitude as latitude, message_location.longitude as longitude` : sql``}
      FROM message
        $${media ? sql`
        LEFT JOIN message_media ON message_media.message_row_id = message._id` : sql``}
        $${quoted ? sql`
        LEFT JOIN message_quoted ON message_quoted.message_row_id = message._id` : sql``}
        $${location ? sql`
        LEFT JOIN message_location ON message_location.message_row_id = message._id` : sql``}
      WHERE message.chat_row_id = ${chatRowID}
      ORDER BY message._id
      `) as any[];

    let newMessages: RoomMessage[] = [];
    for (let row of rows) {
      try {
        if (row.status == 6 || row.type == kMessageType.System || !row.keyID) {
          continue; // system messages about the chat itself, e.g. group renames
        }
        this.progress.messagesDone++;
        if (this.progress.messagesDone % 100 == 0) {
          this.notifyProgress();
        }
        if (known.has(row.keyID)) {
          this.progress.knownMessages++;
          continue;
        }
        let msg = await this.convertMessage(room, row, isGroup);
        if (!msg) {
          continue;
        }
        msg.id = row.keyID; // the bare WhatsApp key id, same as live history sync
        await SQLChatMessage.save(msg);
        known.add(row.keyID);
        newMessages.push(msg);
        this.messageByRowID.set(row.rowID, msg);
        this.progress.newMessages++;
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }
    room.messages.addAll(newMessages);
    let last = room.messages.contents
      .filter((msg): msg is ChatMessage => msg instanceof ChatMessage)
      .reduce((last, msg) => !last || msg.sent > last.sent ? msg : last, null);
    if (last) {
      room.lastMessage = last;
    }
  }

  protected async convertMessage(room: ChatRoom, row: any, isGroup: boolean): Promise<RoomMessage | null> {
    let revoked = row.type == kMessageType.Revoked;
    let msg = revoked ? room.newRoomEvent() : room.newMessage();
    msg.outgoing = !!row.fromMe;
    if (!row.fromMe && isGroup && row.senderJidRowID) {
      let senderJID = this.jidByRowID.get(row.senderJidRowID);
      if (senderJID) {
        msg.contact = await this.getOrCreateContact(senderJID);
      }
    }
    msg.sent = new Date(row.sentTime || row.receivedTime || Date.now());
    msg.received = new Date(row.receivedTime || row.sentTime || Date.now());
    msg.isRead = true;
    msg.isStarred = !!row.starred;

    if (revoked) {
      msg.text = gt`This message was deleted`;
      return msg;
    }
    let text = row.text ?? row.mediaCaption ?? "";
    if (row.latitude || row.longitude) {
      text = (text ? text + "\n" : "") +
        `https://www.openstreetmap.org/?mlat=${row.latitude}&mlon=${row.longitude}`;
    }
    msg.text = text;
    if (row.filePath || row.mimeType) {
      // The media files themselves are not part of the backup,
      // so we import only the metadata.
      let attachment = msg.newAttachment();
      attachment.filename = sanitize.filename(
        row.mediaName || row.filePath?.split("/").pop(), "attachment-" + row.rowID);
      attachment.mimeType = row.mimeType || "application/octet-stream";
      attachment.size = row.fileSize ?? null;
      attachment.disposition = ContentDisposition.attachment;
      msg.attachments.add(attachment);
    } else if (!text) {
      return null; // e.g. calls, polls, and other types that we cannot show
    }
    if (row.quotedKeyID) {
      msg.inReplyTo = row.quotedKeyID;
    }
    return msg;
  }

  /** Emoji reactions are separate rows in the backup. Attach them to the
   * messages imported in this run. */
  protected async importReactions(): Promise<void> {
    if (!await this.tableExists("message_add_on") ||
        !await this.tableExists("message_add_on_reaction")) {
      return;
    }
    let rows = await this.msgstore.all(sql`
      SELECT
        message_add_on.parent_message_row_id as parentRowID,
        message_add_on.from_me as fromMe,
        message_add_on.sender_jid_row_id as senderJidRowID,
        message_add_on_reaction.reaction as reaction
      FROM message_add_on
        INNER JOIN message_add_on_reaction
          ON message_add_on_reaction.message_add_on_row_id = message_add_on._id
      `) as any[];
    let changed = new Set<RoomMessage>();
    for (let row of rows) {
      try {
        let msg = this.messageByRowID.get(row.parentRowID);
        if (!msg || !row.reaction) {
          continue;
        }
        let person: WhatsAppContact;
        let jid = this.jidByRowID.get(row.senderJidRowID);
        if (row.fromMe) {
          person = await this.account.getOwnContact();
        } else if (jid) {
          person = await this.getOrCreateContact(jid);
        } else if (msg.to.contact instanceof WhatsAppContact) {
          person = msg.to.contact; // 1:1 chats omit the sender
        } else {
          continue;
        }
        msg.reactions.set(person, row.reaction);
        changed.add(msg);
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }
    for (let msg of changed) {
      await SQLChatMessage.save(msg);
    }
  }

  protected notifyProgress() {
    this.onProgress?.(this.progress);
  }
}

export class ImportProgress {
  chatsDone = 0;
  chatsTotal = 0;
  /** Name of the chat currently being imported */
  currentChat: string | null = null;
  /** Messages processed so far, including already known ones */
  messagesDone = 0;
  /** Messages in all chats that will be imported */
  messagesTotal = 0;
  newMessages = 0;
  /** Messages skipped, because a previous import already got them */
  knownMessages = 0;
}

/** message.message_type values in msgstore.db */
const kMessageType = {
  Text: 0,
  Image: 1,
  Audio: 2,
  Video: 3,
  ContactCard: 4,
  Location: 5,
  System: 7,
  Document: 9,
  GIF: 13,
  Revoked: 15,
  LiveLocation: 16,
  Sticker: 20,
};

/** Opens the decrypted database file contents as an in-memory database. */
async function openDatabase(dbFile: Uint8Array): Promise<Database> {
  /** If the database was in WAL mode (e.g. wa.db), flips it to legacy journal
   * mode first: The backup contains no -wal file, so the image is already
   * checkpointed, but SQLite refuses to use in-memory databases in WAL mode
   * "unable to open database file", because there can be no -shm file. */
  if (dbFile[18] == 2 || dbFile[19] == 2) {
    dbFile[18] = 1; // file format write version, offset 18: 2 = WAL, 1 = legacy
    dbFile[19] = 1; // file format read version
  }
  return await getSQLiteDatabase(null, { readonly: true }, dbFile);
}

/** Matches phone numbers ignoring formatting, and national vs.
 * international format, e.g. "0176 1234567" matches "+49 176 1234567". */
export function phoneNumbersMatch(a: string, b: string): boolean {
  let digitsA = normalizePhoneNumber(a);
  let digitsB = normalizePhoneNumber(b);
  if (!digitsA || !digitsB) {
    return false;
  }
  if (digitsA == digitsB) {
    return true;
  }
  let [shorter, longer] = digitsA.length < digitsB.length
    ? [digitsA, digitsB] : [digitsB, digitsA];
  return shorter.startsWith("0") && shorter.length >= 8 &&
    longer.endsWith(shorter.substring(1));
}

/** Reduces a phone number to its digits, dropping formatting
 * and the international call prefix */
export function normalizePhoneNumber(phone: string): string {
  let digits = phone?.replace(/[^0-9]/g, "") ?? "";
  if (digits.startsWith("00")) {
    digits = digits.substring(2);
  }
  return digits;
}
