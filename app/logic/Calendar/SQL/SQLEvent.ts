import { Event, RecurrenceCase } from "../Event";
import { Participant } from "../Participant";
import { RecurrenceRule } from "../RecurrenceRule";
import type { Calendar } from "../Calendar";
import { type Attachment, ContentDisposition } from "../../Abstract/Attachment";
import { getDatabase } from "./SQLDatabase";
import { appGlobal } from "../../app";
import { getFilesDir } from "../../util/backend-wrapper";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { dataError } from "../../util/error";
import { assert, fileExtensionForMIMEType } from "../../util/util";
import { ArrayColl, Collection } from "svelte-collections";
import sql from "../../../../lib/rs-sqlite";

let filesDir: string = null;

/** The files dir differs between installations, so save the path relative to it */
async function relativeFilepath(a: Attachment): Promise<string | null> {
  if (!a.filepathLocal) {
    return null;
  }
  filesDir ??= await getFilesDir();
  return a.filepathLocal.replace(filesDir + "/", "");
}

async function absoluteFilepath(filepath: string | null): Promise<string | null> {
  if (!filepath) {
    return null;
  }
  filesDir ??= await getFilesDir();
  return filesDir + "/" + filepath;
}

export class SQLEvent extends Event {
  static async save(event: Event) {
    assert(event.calendar?.dbID, "Need calendar DB ID to save the event");
    let jsonStr = JSON.stringify(event.toExtraJSON(), null, 2);
    let original = typeof (event.original) == "string" ? event.original : JSON.stringify(event.original, null, 2);
    let lock = await event.storageLock.lock();
    try {
      if (!event.dbID) {
        let insert = await (await getDatabase()).run(sql`
          INSERT INTO event (
            title, descriptionText, descriptionHTML,
            startTime, endTime, allDay, startTimeTZ,
            calUID, responseToOrganizer, pID, calendarID,
            recurrenceRule, recurrenceMasterEventID,
            recurrenceStartTime, recurrenceIsException, source, json
          ) VALUES (
            ${event.title}, ${event.rawText}, ${event.rawHTMLDangerous},
            ${event.startTime.toISOString()}, ${event.endTime.toISOString()}, ${event.allDay ? 1 : 0}, ${event.timezone},
            ${event.calUID}, ${event.myParticipation}, ${event.pID}, ${event.calendar?.dbID},
            ${event.recurrenceRule?.getCalString(event.allDay)}, ${event.parentEvent?.dbID},
            ${event.recurrenceStartTime?.toISOString()},
            ${+!!event.parentEvent?.dbID},
            ${original}, ${jsonStr}
          )`);
        event.dbID = insert.lastInsertRowid;
      } else {
        await (await getDatabase()).run(sql`
          UPDATE event SET
            title = ${event.title},
            descriptionText = ${event.rawText},
            descriptionHTML = ${event.rawHTMLDangerous},
            startTime = ${event.startTime.toISOString()},
            endTime = ${event.endTime.toISOString()},
            allDay = ${event.allDay ? 1 : 0},
            startTimeTZ = ${event.timezone},
            calUID = ${event.calUID},
            responseToOrganizer = ${event.myParticipation},
            pID = ${event.pID},
            calendarID = ${event.calendar?.dbID},
            recurrenceRule = ${event.recurrenceRule?.getCalString(event.allDay)},
            recurrenceMasterEventID = ${event.parentEvent?.dbID},
            recurrenceStartTime = ${event.recurrenceStartTime?.toISOString()},
            recurrenceIsException = ${+!!event.parentEvent?.dbID},
            source = ${original},
            json = ${jsonStr}
          WHERE id = ${event.dbID}
          `);
      }

      await this.saveExclusions(event);
      await this.saveParticipants(event);
      await this.saveAttachments(event);
    } finally {
      lock.release();
    }
  }

  protected static async saveExclusions(event: Event) {
    await (await getDatabase()).run(sql`
      DELETE FROM eventExclusion
      WHERE recurrenceMasterEventID = ${event.dbID}
      `);

    for (let exclusion of event.exclusions) {
      let index = event.recurrenceRule.getIndexOfOccurrence(exclusion);
      if (index < 0) {
        continue; // the rule has no occurrence then, so nothing to exclude
      }
      await (await getDatabase()).run(sql`
        INSERT INTO eventExclusion (
          recurrenceMasterEventID, recurrenceIndex
        ) VALUES (
          ${event.dbID}, ${index}
        )`);
    }
  }

  protected static async saveParticipants(event: Event) {
    await (await getDatabase()).run(sql`
      DELETE FROM eventParticipant
      WHERE eventID = ${event.dbID}
      `);

    for (let personUID of event.participants) {
      await this.saveParticipant(event, personUID);
    }
  }

  protected static async saveParticipant(event: Event, participant: Participant) {
    let json = {} as any;
    json.lastUpdateTime = participant.lastUpdateTime;
    await (await getDatabase()).run(sql`
      INSERT INTO eventParticipant (
        eventID, emailAddress, name, confirmed, json
      ) VALUES (
        ${event.dbID}, ${participant.emailAddress}, ${participant.name}, ${participant.response},
        ${JSON.stringify(json, null, 2)}
      )`);
  }

  /** Updates the existing rows, keeping `filepathLocal`, and deletes only
   * the rows of attachments that the user removed from the event.
   * @see SQLEMail.saveAttachments() */
  protected static async saveAttachments(event: Event) {
    let db = await getDatabase();
    let existingRows = await db.all(sql`
      SELECT
        id, filename, filepathLocal
      FROM eventAttachment
      WHERE eventID = ${event.dbID}
      `) as any[];
    for (let attachment of event.attachments) {
      let row = existingRows.find(row => row.filename == attachment.filename);
      if (row) {
        existingRows = existingRows.filter(r => r != row);
        // A sync replaces the attachment objects, so restore the file we already have
        attachment.filepathLocal ??= await absoluteFilepath(sanitize.string(row.filepathLocal, null));
        await this.updateAttachment(attachment, row.id);
      } else {
        await this.saveAttachment(event, attachment);
      }
    }
    for (let row of existingRows) {
      await db.run(sql`
        DELETE FROM eventAttachment
        WHERE id = ${row.id}
        `);
    }
  }

  protected static async saveAttachment(event: Event, a: Attachment) {
    assert(event.dbID, "Need to save event before attachment");
    await (await getDatabase()).run(sql`
      INSERT OR IGNORE INTO eventAttachment (
        eventID, filename, filepathLocal, mimeType, size, pID, json
      ) VALUES (
        ${event.dbID}, ${a.filename}, ${await relativeFilepath(a)}, ${a.mimeType}, ${a.size},
        ${a.pID}, ${JSON.stringify(a.toExtraJSON(), null, 2)}
      )`);
  }

  protected static async updateAttachment(a: Attachment, rowID: number) {
    await (await getDatabase()).run(sql`
      UPDATE eventAttachment SET
        mimeType = ${a.mimeType},
        size = ${a.size},
        pID = COALESCE(${a.pID}, pID),
        json = ${JSON.stringify(a.toExtraJSON(), null, 2)},
        filepathLocal = COALESCE(${await relativeFilepath(a)}, filepathLocal)
      WHERE id = ${rowID}
      `);
  }

  /** After downloading and saving the attachment file locally, or moving it on disk,
   * save its local disk location. */
  static async saveAttachmentFilename(event: Event, a: Attachment) {
    assert(event.dbID, "Need to save event before attachment");
    await (await getDatabase()).run(sql`
      UPDATE eventAttachment SET
        filepathLocal = ${await relativeFilepath(a)},
        json = ${JSON.stringify(a.toExtraJSON(), null, 2)}
      WHERE eventID = ${event.dbID}
        AND filename = ${a.filename}
      `);
  }

  /** Will also delete all event participant entries, but not the persons itself */
  static async deleteIt(event: Event) {
    assert(event.dbID, "Need Event DB ID to delete");
    let lock = await event.storageLock.lock();
    try {
      let dbID = event.dbID;
      event.dbID = null;
      await (await getDatabase()).run(sql`
        DELETE FROM event
        WHERE id = ${dbID}
        `);
    } finally {
      lock.release();
    }
  }

  static async read(dbID: number, event: Event, row?: any, events?: Collection<Event>): Promise<Event> {
    if (!row) {
      // <copied to="readAll()" />
      row = await (await getDatabase()).get(sql`
        SELECT
          title, descriptionText, descriptionHTML,
          startTime, endTime, allDay, startTimeTZ,
          calUID, responseToOrganizer, pID, calendarID,
          recurrenceRule, recurrenceMasterEventID, recurrenceStartTime, source, json
        FROM event
        WHERE id = ${dbID}
        `) as any;
    }
    event.dbID = sanitize.integer(dbID);
    event.title = sanitize.label(row.title, "Meeting");
    event.rawText = sanitize.label(row.descriptionText, "");
    let html = sanitize.string(row.descriptionHTML, null);
    if (html) {
      event.rawHTMLDangerous = html;
    }
    event.startTime = sanitize.date(row.startTime);
    event.endTime = sanitize.date(row.endTime, event.startTime);
    event.allDay = sanitize.boolean(row.allDay, false);
    event.timezone = sanitize.string(row.startTimeTZ, null);
    event.calUID = row.calUID;
    event.myParticipation = sanitize.integerRange(row.responseToOrganizer, 0, 5);
    event.pID = row.pID;
    event.fromExtraJSON(sanitize.json(row.json, {}));
    if (row.source?.[0] == "{") {
      event.original = sanitize.json(row.source, undefined);
    } else if (row.source) {
      event.original = sanitize.nonemptystring(row.source, undefined);
    } else {
      delete event.original;
    }
    if (row.calendarID) {
      let calendarID = sanitize.integer(row.calendarID, null);
      if (event.calendar) {
        assert(event.calendar.dbID == calendarID, "Wrong calendar");
      } else {
        event.calendar = appGlobal.calendars.find(cal => cal.dbID == calendarID);
      }
    }
    if (row.recurrenceMasterEventID && row.recurrenceStartTime) {
      let masterID = sanitize.integer(row.recurrenceMasterEventID);
      // TODO assumes that the master is read before the exception
      let parentEvent = events?.find(event => event.dbID == masterID);
      if (parentEvent?.recurrenceRule) {
        event.recurrenceCase = RecurrenceCase.Exception;
        event.parentEvent = parentEvent;
        event.recurrenceStartTime = sanitize.date(row.recurrenceStartTime);
        parentEvent.exceptions.add(event);
        parentEvent.generateRecurringInstances(); // TODO the exception should keep the parent in sync automatically
      }
    }
    if (row.recurrenceRule) {
      event.recurrenceRule = RecurrenceRule.fromCalString(event.duration, event.timezone, event.startTime, row.recurrenceRule);
      await SQLEvent.readExclusions(event);
      event.generateRecurringInstances(); // TODO the exclusion should keep the parent in sync automatically
    }

    await SQLEvent.readParticipants(event);
    await SQLEvent.readAttachments(event);
    return event;
  }

  protected static async readExclusions(event: Event) {
    let rows = await (await getDatabase()).all(sql`
      SELECT
        recurrenceIndex
      FROM eventExclusion
      WHERE recurrenceMasterEventID = ${event.dbID}
      `) as any;
    for (let row of rows) {
      let index = row.recurrenceIndex;
      let normalTime = event.recurrenceRule.getOccurrenceByIndex(index);
      if (!normalTime) {
        // TODO fillOccurences()?
        event.calendar.errorCallback(new Error("Occurrence not filled"));
        continue;
      }
      event.exclusions.add(normalTime);
    }
  }

  protected static async readParticipants(event: Event) {
    let rows = await (await getDatabase()).all(sql`
      SELECT
        emailAddress, name, confirmed, json
      FROM eventParticipant
      WHERE eventID = ${event.dbID}
      `) as any;
    for (let row of rows) {
      try {
        let participant = new Participant(row.emailAddress, row.name, row.confirmed);
        let json = sanitize.json(row.json, {});
        participant.lastUpdateTime = sanitize.date(json.lastUpdateTime, null);
        event.participants.add(participant);
      } catch (ex) {
        dataError(ex);
      }
    }
  }

  protected static async readAttachments(event: Event) {
    let rows = await (await getDatabase()).all(sql`
      SELECT
        filename, filepathLocal, mimeType, size, pID, json
      FROM eventAttachment
      WHERE eventID = ${event.dbID}
      `) as any;
    let attachments: Attachment[] = [];
    for (let row of rows) {
      try {
        let a = event.newAttachment();
        a.mimeType = sanitize.nonemptystring(row.mimeType, "application/octet-stream");
        a.filename = sanitize.nonemptystring(row.filename, "attachment-" + (attachments.length + 1) + "." + fileExtensionForMIMEType(a.mimeType));
        a.filepathLocal = await absoluteFilepath(sanitize.string(row.filepathLocal, null));
        a.size = sanitize.integer(row.size, null);
        a.pID = sanitize.string(row.pID, null);
        a.disposition = ContentDisposition.attachment;
        a.fromExtraJSON(sanitize.json(row.json, {}) as any);
        attachments.push(a);
      } catch (ex) {
        dataError(ex);
      }
    }
    event.attachments.replaceAll(attachments);
  }

  /**
   * Also first reads the persons from DB.
   * @returns all groups with their members
   */
  static async readAll(calendar: Calendar): Promise<void> {
    assert(calendar.dbID, "Need calendar ID to read events from SQL database");

    // <copied from="read()" />
    let rows = await (await getDatabase()).all(sql`
      SELECT
        title, descriptionText, descriptionHTML,
        startTime, endTime, allDay, startTimeTZ,
        calUID, responseToOrganizer, pID, id,
        recurrenceRule, recurrenceMasterEventID, recurrenceStartTime, source, json
      FROM event
      WHERE calendarID = ${calendar.dbID}
      ORDER BY id
      `) as any;
    let newEvents = new ArrayColl<Event>();
    for (let row of rows) {
      try {
        let event = calendar.events.find(event => event.dbID == row.id);
        if (!event) {
          event = calendar.newEvent();
          newEvents.add(event);
        }
        event.calendar = calendar;
        await SQLEvent.read(row.id, event, row, newEvents);
      } catch (ex) {
        calendar.errorCallback(ex);
      }
    }
    calendar.events.addAll(newEvents);
  }
}
