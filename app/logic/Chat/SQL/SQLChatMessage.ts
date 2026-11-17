import { ChatMessage, type RoomMessage } from "../ChatMessage";
import { ChatRoomEvent, RoomEventKind } from "../RoomEvent";
import type { ChatRoom } from "../ChatRoom";
import type { ChatAccount } from "../ChatAccount";
import { ChatPersonUID } from "../ChatPersonUID";
import { PersonUID } from "../../Abstract/PersonUID";
import { Group } from "../../Abstract/Group";
import { Attachment, ContentDisposition } from "../../Abstract/Attachment";
import { getDatabase } from "./SQLDatabase";
import { appGlobal } from "../../app";
import { dataError } from "../../util/error";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import { ArrayColl } from "svelte-collections";
import sql from "../../../../lib/rs-sqlite";

export class SQLChatMessage {
  /**
   * Save only fully downloaded emails
   */
  static async save(msg: RoomMessage) {
    // Room members are deliberately not in the contacts DB.
    // Old messages might be from a former member that is no longer in the room.
    let from = (msg instanceof ChatMessage ? msg.from : null) ?? msg.contact;
    let fromPersonID = from instanceof ChatPersonUID ? from.person?.dbID ?? null : null;
    if (!msg.dbID) {
      let existing = await (await getDatabase()).get(sql`
        SELECT
          id
        FROM message
        WHERE
          idStr = ${msg.id} AND
          chatID = ${msg.to.dbID}
        `) as any;
      if (existing?.id) {
        msg.dbID = existing.id;
      }
    }
    // `ChatRoomEvent` is marked by its `kind` in the json column.
    // `ChatMessage` stores its sender's chat ID, to rebuild `ChatPersonID` on read.
    let jsonStr: string | null = null;
    if (msg instanceof ChatRoomEvent) {
      jsonStr = JSON.stringify(msg.toExtraJSON(), null, 2);
    } else {
      // Merge the sender (to rebuild ChatPersonUID on read) with any protocol-specific
      // message state (e.g. Signal's deleted/edited/sealedSender) so it round-trips.
      let json: any = msg instanceof ChatMessage ? msg.toExtraJSON() : {};
      if (from instanceof ChatPersonUID) {
        json.fromName = from.name;
        json.fromID = from.chatID;
      }
      jsonStr = Object.keys(json).length ? JSON.stringify(json, null, 2) : null;
    }
    let reactionsJSON = await SQLChatMessage.saveReactions(msg);
    if (!msg.dbID) {
      let insert = await (await getDatabase()).run(sql`
        INSERT INTO message (
          outgoing, fromPersonID, inReplyToIDStr,
          dateSent, dateReceived,
          plaintext, html, reactionsJSON,
          chatID, idStr, json
        ) VALUES (
          ${msg.outgoing ? 1 : 0}, ${fromPersonID}, ${msg.inReplyTo},
          ${msg.sent.getTime() / 1000}, ${msg.received.getTime() / 1000},
          ${msg.text}, ${msg.rawHTMLDangerous}, ${reactionsJSON},
          ${msg.to.dbID}, ${msg.id}, ${jsonStr}
        )`);
      msg.dbID = insert.lastInsertRowid;
    } else {
      await (await getDatabase()).run(sql`
        UPDATE message SET
          fromPersonID = ${fromPersonID},
          inReplyToIDStr = ${msg.inReplyTo},
          dateSent = ${msg.sent.getTime() / 1000},
          dateReceived = ${msg.received.getTime() / 1000},
          outgoing = ${msg.outgoing ? 1 : 0},
          plaintext = ${msg.text},
          html = ${msg.rawHTMLDangerous},
          reactionsJSON = ${reactionsJSON},
          chatID = ${msg.to.dbID},
          idStr = ${msg.id},
          json = ${jsonStr}
        WHERE id = ${msg.dbID}
        `);
    }
    await SQLChatMessage.saveAttachments(msg);
  }

  /** Rebuild the sender as `ChatPersonUID` from the chat ID in `json.fromID` */
  protected static readSender(chat: ChatRoom, json: any, fromPersonID: number | null): ChatPersonUID | undefined {
    let fromID = sanitize.nonemptystring(json?.fromID, null);
    let from = fromID
      ? chat.account.getPersonUID(fromID, sanitize.nonemptylabel(json?.fromName, null))
      : chat.contact instanceof ChatPersonUID ? chat.contact : undefined;
    if (from && fromPersonID) {
      from.person ??= appGlobal.persons.find(p => p.dbID == fromPersonID);
    }
    return from;
  }

  /** Creates the message or room event for this DB row,
   * based on the `kind` saved in the json column. */
  protected static newRoomMessage(chat: ChatRoom, jsonStr: string | null): RoomMessage {
    let json = sanitize.json(jsonStr, null) as any;
    let kind = sanitize.enum(json?.kind, Object.values(RoomEventKind), null);
    if (!kind) {
      return chat.newMessage();
    }
    let event = chat.newRoomEvent(kind);
    event.fromExtraJSON(json);
    return event;
  }

  protected static async saveAttachments(msg: RoomMessage) {
    for (let a of msg.attachments) {
      let jsonStr = JSON.stringify(a.toExtraJSON(), null, 2);
      let existing = await (await getDatabase()).get(sql`
        SELECT id FROM chatAttachment
        WHERE messageID = ${msg.dbID} AND filename = ${a.filename}
        `) as any;
      if (existing?.id) {
        await (await getDatabase()).run(sql`
          UPDATE chatAttachment SET
            filepathLocal = COALESCE(${a.filepathLocal}, filepathLocal),
            mimeType = ${a.mimeType},
            size = ${a.size},
            related = ${a.related ? 1 : 0},
            json = ${jsonStr}
          WHERE id = ${existing.id}
          `);
      } else {
        await (await getDatabase()).run(sql`
          INSERT INTO chatAttachment (
            messageID, filename, filepathLocal, mimeType, size, related, json
          ) VALUES (
            ${msg.dbID}, ${a.filename}, ${a.filepathLocal}, ${a.mimeType}, ${a.size},
            ${a.related ? 1 : 0}, ${jsonStr}
          )`);
      }
    }
  }

  /** After an attachment's file was written to disk (see RawFilesAttachment),
   * record its local path on the already-saved metadata row. */
  static async saveAttachmentFilename(msg: RoomMessage, a: Attachment): Promise<void> {
    await (await getDatabase()).run(sql`
      UPDATE chatAttachment SET
        filepathLocal = ${a.filepathLocal},
        json = ${JSON.stringify(a.toExtraJSON(), null, 2)}
      WHERE messageID = ${msg.dbID} AND filename = ${a.filename}
      `);
  }

  static async read(dbID: number, msg: RoomMessage, row?: any): Promise<void> {
    let readAttachments = !row;
    if (!row) {
      row = await (await getDatabase()).get(sql`
        SELECT
          outgoing, fromPersonID, inReplyToIDStr,
          dateSent, dateReceived,
          plaintext, html, reactionsJSON,
          chatID, idStr, json
        FROM message
        WHERE id = ${dbID}
        `) as any;
    }
    msg.dbID = sanitize.integer(dbID);
    msg.id = sanitize.nonemptystring(row.idStr);
    msg.outgoing = sanitize.boolean(row.outgoing, false);
    msg.inReplyTo = sanitize.string(row.inReplyToIDStr, null);
    msg.sent = sanitize.date(row.dateSent * 1000, new Date());
    msg.received = sanitize.date(row.dateReceived * 1000, new Date());
    msg.text = sanitize.string(row.plaintext, "");
    let html = sanitize.string(row.html, null);
    if (html) {
      msg.html = html;
    }
    SQLChatMessage.readReactions(msg, sanitize.string(row.reactionsJSON, null));
    let fromPersonID = sanitize.integer(row.fromPersonID, null);
    let chatID = sanitize.integer(row.chatID);
    if (msg.to) {
      assert(msg.to.dbID == chatID, "Wrong chat");
      let from = SQLChatMessage.readSender(msg.to, sanitize.json(row.json, null), fromPersonID);
      if (msg instanceof ChatMessage && from) {
        msg.from = from;
      }
      // In a group chat the incoming sender is also `contact`; a 1:1 keeps the partner.
      msg.contact = from && !msg.outgoing && msg.to.contact instanceof Group
        ? from
        : msg.to.contact;
    } else {
      // TODO msg.to = chat
    }
    // Restore protocol-specific message state (e.g. Signal's deleted/edited/sealedSender).
    if (msg instanceof ChatMessage) {
      msg.fromExtraJSON(sanitize.json(row.json, {}) as any);
    }
    if (readAttachments) {
      let attRows = await (await getDatabase()).all(sql`
        SELECT filename, filepathLocal, mimeType, size, related, json
        FROM chatAttachment
        WHERE messageID = ${msg.dbID}
        `) as any;
      msg.attachments.replaceAll(attRows.map(attRow => SQLChatMessage.readAttachment(attRow, msg.newAttachment())));
    }
  }

  protected static readAttachment(row: any, a: Attachment): Attachment {
    a.filename = sanitize.nonemptystring(row.filename);
    a.filepathLocal = sanitize.string(row.filepathLocal, null);
    a.mimeType = sanitize.nonemptystring(row.mimeType, "application/octet-stream");
    a.size = sanitize.integer(row.size, null);
    a.related = sanitize.boolean(row.related, false);
    a.disposition = a.related ? ContentDisposition.inline : ContentDisposition.attachment;
    a.fromExtraJSON(sanitize.json(row.json, {}) as any);
    return a;
  }

  protected static readReactions(msg: RoomMessage, reactionsJSONStr: string | null) {
    if (!reactionsJSONStr) {
      return;
    }
    let account = msg.to?.account as ChatAccount;
    let reactions = JSON.parse(reactionsJSONStr) as ReactionJSON[];
    for (let reaction of reactions) {
      try {
        let emoji = sanitize.string(reaction.emoji);
        let fromID = sanitize.nonemptystring(reaction.fromID, null);
        let personUID = account.getPersonUID(fromID);
        let personID = sanitize.integer(reaction.personID, null);
        if (personID) {
          personUID.person ??= appGlobal.persons.find(p => p.dbID == personID);
        }
        msg.reactions.set(personUID, emoji);
      } catch (ex) {
        dataError(ex);
      }
    }
  }

  protected static async saveReactions(msg: RoomMessage): Promise<string> {
    let reactions: ReactionJSON[] = [];
    msg.reactions.forEach((emoji: string, person: ChatPersonUID) => {
      reactions.push({
        emoji: emoji,
        fromID: person.chatID,
        personID: person.person?.dbID ?? null,
      } as ReactionJSON);
    });
    return JSON.stringify(reactions);
  }

  static async deleteIt(msg: RoomMessage) {
    assert(msg.dbID, "Need chat message DB ID to delete");
    await (await getDatabase()).run(sql`
      DELETE FROM message
      WHERE id = ${msg.dbID}
      `);
  }

  static async readAll(chat: ChatRoom): Promise<void> {
    let rows = await (await getDatabase()).all(sql`
      SELECT
        id,
        outgoing, fromPersonID, inReplyToIDStr,
        dateSent, dateReceived,
        plaintext, html, reactionsJSON,
        chatID, idStr, json
      FROM message
      WHERE chatID = ${chat.dbID}
      `) as any;
    // Read all attachments of this chat with a single query
    let attRows = await (await getDatabase()).all(sql`
      SELECT messageID, filename, filepathLocal, mimeType, size, related, json
      FROM chatAttachment
      WHERE messageID IN (SELECT id FROM message WHERE chatID = ${chat.dbID})
      `) as any;
    let attRowsByMessage = new Map<number, any[]>();
    for (let attRow of attRows) {
      try {
        let atts = attRowsByMessage.get(attRow.messageID);
        if (!atts) {
          attRowsByMessage.set(attRow.messageID, atts = []);
        }
        atts.push(attRow);
      } catch (ex) {
        chat.account.errorCallback(ex);
      }
    }
    let newMsgs = new ArrayColl<RoomMessage>();
    for (let row of rows) {
      try {
        let msg = chat.messages.find(msg => msg.dbID == row.id);
        if (msg) {
          await SQLChatMessage.read(row.id, msg as any as RoomMessage); // TODO needed?
        } else {
          msg = SQLChatMessage.newRoomMessage(chat, sanitize.string(row.json, null));
          await SQLChatMessage.read(row.id, msg as any as RoomMessage, row);
          if (msg instanceof ChatMessage) {
            let attRows = attRowsByMessage.get(row.id);
            if (attRows) {
              for (let attRow of attRows) {
                msg.attachments.add(SQLChatMessage.readAttachment(attRow, msg.newAttachment()));
              }
            }
          }
          newMsgs.add(msg);
        }
      } catch (ex) {
        chat.account.errorCallback(ex);
      }
    }
    chat.messages.addAll(newMsgs);
  }
}

class ReactionJSON {
  emoji: string;
  /** Reacter's protocol-specific user ID (e.g. JID) */
  fromID: string | null;
  /** Addressbook Person, if the reacter is linked to one */
  personID: number | null;
}
