// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { Calendar } from "../../../logic/Calendar/Calendar";
import type { Event } from "../../../logic/Calendar/Event";
import { Participant } from "../../../logic/Calendar/Participant";
import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
import { SQLCalendar } from "../../../logic/Calendar/SQL/SQLCalendar";
import { SQLCalendarStorage } from "../../../logic/Calendar/SQL/SQLCalendarStorage";
import { SQLEvent } from "../../../logic/Calendar/SQL/SQLEvent";
import { getDatabase } from "../../../logic/Calendar/SQL/SQLDatabase";
import { calendarDatabaseSchema } from "../../../logic/Calendar/SQL/createDatabase";
import { addEventAttachmentTable } from "../../../logic/Calendar/SQL/SQLEventMigrate";
import { getICal } from "../../../logic/Calendar/ICal/ICalGenerator";
import { convertICalToEvent } from "../../../logic/Calendar/ICal/ICalToEvent";
import { ICalEMailProcessor } from "../../../logic/Calendar/ICal/ICalEMailProcessor";
import { IMAPAccount } from "../../../logic/Mail/IMAP/IMAPAccount";
import { MailIdentity } from "../../../logic/Mail/MailIdentity";
import { SpecialFolder } from "../../../logic/Mail/Folder";
import { Attachment, ContentDisposition } from "../../../logic/Abstract/Attachment";
import type { EMail } from "../../../logic/Mail/EMail";
import { InProcessSQLiteDatabase } from "../util/inProcessSQLite";
import { InMemoryFileReader } from "../util/fileReader";
import { mkdtempSync } from "node:fs";
import fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, expect, test } from "vitest";
import { ArrayColl } from "svelte-collections";
import sql from "../../../../lib/rs-sqlite";

let calendar: Calendar;
let tempDir: string;
const kContent = new Uint8Array([1, 2, 3, 4]);

beforeAll(async () => {
  globalThis.FileReader ??= InMemoryFileReader as any; // for the iCal attachments

  tempDir = mkdtempSync(path.join(tmpdir(), "calendar-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
    getFilesDir: () => path.join(tempDir, "files"),
    // <copied from="desktop/backend/backend.ts">
    async writeFile(filepath: string, permissions: number, contents: Uint8Array): Promise<void> {
      await fsPromises.rm(filepath, { force: true });
      let fileHandle = await fsPromises.open(filepath, "w", permissions);
      await fileHandle.write(contents);
      await fileHandle.close();
    },
    readFile: (filepath: string) => fsPromises.readFile(filepath),
    fs: fsPromises,
    createIMAPFlowConnection: () => {
      throw new Error("The test should not talk to a server");
    },
  } as any;

  calendar = new Calendar();
  calendar.name = "Test";
  calendar.storage = new SQLCalendarStorage();
  await SQLCalendar.save(calendar);
  appGlobal.calendars.add(calendar);
});

function newTestEvent(title: string): Event {
  let event = calendar.newEvent();
  event.title = title;
  event.startTime = new Date("2026-07-14T10:00:00Z");
  event.endTime = new Date("2026-07-14T11:00:00Z");
  event.participants.add(new Participant("alice@example.com", "Alice", InvitationResponse.Organizer));
  let attachment = event.newAttachment();
  attachment.filename = "agenda.pdf";
  attachment.mimeType = "application/pdf";
  attachment.content = new File([kContent as BlobPart], "agenda.pdf", { type: "application/pdf" });
  attachment.size = kContent.length;
  event.attachments.add(attachment);
  return event;
}

test("Event attachment is written to disk, sorted by organizer, and read back from the DB", async () => {
  let event = newTestEvent("Planning");
  await event.saveLocally();

  let filepath = event.attachments.first.filepathLocal;
  expect(filepath).toBeTruthy();
  expect(filepath).toContain("/files/calendar/alice-example.com/");
  expect(filepath).toContain("Planning");
  expect(new Uint8Array(await fsPromises.readFile(filepath))).toEqual(kContent);

  // Read back, as on the next app start
  let readEvent = calendar.newEvent();
  await SQLEvent.read(event.dbID, readEvent);
  expect(readEvent.attachments.length).toBe(1);
  let read = readEvent.attachments.first;
  expect(read.filename).toBe("agenda.pdf");
  expect(read.mimeType).toBe("application/pdf");
  expect(read.size).toBe(kContent.length);
  expect(read.filepathLocal).toBe(filepath);
  expect(read.content).toBeFalsy(); // contents are loaded on demand

  await readEvent.loadAttachments();
  expect(new Uint8Array(await read.content.arrayBuffer())).toEqual(kContent);
});

test("Removing an attachment deletes its DB row, and deleting the event removes the files", async () => {
  let event = newTestEvent("Retro");
  await event.saveLocally();
  let dir = path.dirname(event.attachments.first.filepathLocal);

  event.attachments.clear();
  await event.saveLocally();
  let rows = await (await getDatabase()).all(sql`
    SELECT filename FROM eventAttachment WHERE eventID = ${event.dbID}`) as any[];
  expect(rows.length).toBe(0);

  await event.deleteLocally();
  await expect(fsPromises.stat(dir)).rejects.toThrow();
});

test("Attachments round-trip through iCal as inline BINARY", async () => {
  let event = newTestEvent("Standup");
  event.calUID = "test-uid@example.com";
  let ics = await getICal(event);
  expect(ics).toContain("ATTACH;VALUE=BINARY;ENCODING=BASE64;FMTTYPE=application/pdf");
  expect(ics).toContain("agenda.pdf");

  let readEvent = calendar.newEvent();
  expect(convertICalToEvent(ics, readEvent)).toBe(true);
  expect(readEvent.attachments.length).toBe(1);
  let read = readEvent.attachments.first;
  expect(read.filename).toBe("agenda.pdf");
  expect(read.mimeType).toBe("application/pdf");
  expect(new Uint8Array(await read.content.arrayBuffer())).toEqual(kContent);
});

function newEMailAttachment(filename: string, mimeType: string, disposition: ContentDisposition, related: boolean): Attachment {
  let attachment = new Attachment();
  attachment.filename = filename;
  attachment.mimeType = mimeType;
  attachment.disposition = disposition;
  attachment.related = related;
  attachment.content = new File([kContent as BlobPart], filename, { type: mimeType });
  attachment.size = kContent.length;
  return attachment;
}

/** An invitation email as Exchange sends it: the attachments are MIME parts of the
 * email and the iCal has no `ATTACH` at all. Because the body is HTML, Exchange puts
 * everything in a `multipart/related` and gives every part a `Content-ID`, so
 * postal-mime reports `related` for the real attachments too, not only for the logo. */
async function newInvitationEMail(): Promise<EMail> {
  let organizerEvent = newTestEvent("Kickoff");
  organizerEvent.calUID = "kickoff@example.com";
  organizerEvent.attachments.clear();
  let ics = await getICal(organizerEvent, "REQUEST");

  let email = {
    attachments: new ArrayColl<Attachment>(),
    hasHTML: false,
    // Without calendars, so that nothing updates a calendar event
    folder: { account: { calendarsAvailable: new ArrayColl() } },
  } as any as EMail;
  let invitation = new Attachment();
  invitation.filename = "invite.ics";
  invitation.mimeType = "text/calendar";
  invitation.content = new File([ics], invitation.filename, { type: invitation.mimeType });
  email.attachments.addAll([
    invitation,
    newEMailAttachment("logo.png", "image/png", ContentDisposition.inline, true),
    newEMailAttachment("agenda.pdf", "application/pdf", ContentDisposition.attachment, true),
    newEMailAttachment("budget.xls", "application/vnd.ms-excel", ContentDisposition.attachment, true),
  ]);
  return email;
}

test("Attachments of an invitation email become attachments of the event", async () => {
  let email = await newInvitationEMail();
  await new ICalEMailProcessor().process(email);

  // Neither the .ics itself nor the logo shown in the description
  expect(email.event.attachments.contents.map(a => a.filename)).toEqual(["agenda.pdf", "budget.xls"]);
  let attachment = email.event.attachments.first;
  expect(attachment.mimeType).toBe("application/pdf");
  expect(new Uint8Array(await attachment.content.arrayBuffer())).toEqual(kContent);
});

test("Confirming an invitation saves its attachments in the calendar", async () => {
  let email = await newInvitationEMail();
  await new ICalEMailProcessor().process(email);

  // What `ICalIncomingInvitation.respondToInvitationFromMail()` does
  let event = calendar.newEvent();
  event.copyFrom(email.event);
  await event.adoptAttachmentsFrom(email.event);
  await event.saveLocally();

  expect(event.attachments.length).toBe(2);
  let attachment = event.attachments.first;
  expect(attachment.message).toBe(event); // and not the invitation event
  expect(attachment.filepathLocal).toContain("/files/calendar/alice-example.com/");
  expect(new Uint8Array(await fsPromises.readFile(attachment.filepathLocal))).toEqual(kContent);
});

test("Migration adds the attachment table to a pre-existing database", async () => {
  let database = new InProcessSQLiteDatabase(path.join(tempDir, "old-calendar.db")) as any;
  // The schema as it was before attachments existed
  let oldSchema = {
    ...calendarDatabaseSchema,
    sourceParts: calendarDatabaseSchema.sourceParts.map(part =>
      part.replace(/CREATE TABLE "eventAttachment"[^;]*;/s, "")),
  };
  await database.migrate(oldSchema);
  let before = await database.get(sql`
    SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'eventAttachment'`);
  expect(before).toBeFalsy();

  await addEventAttachmentTable(database);
  let after = await database.get(sql`
    SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'eventAttachment'`);
  expect(after).toBeTruthy();

  // Running it again on an up-to-date database is a no-op
  await addEventAttachmentTable(database);
});

/** The mail account of the organizer, with the sent emails captured */
function setupOrganizerAccount(): EMail[] {
  let account = new IMAPAccount();
  account.emailAddress = "alice@example.com";
  account.realname = "Alice";
  account.contentStorage.clear();
  let identity = new MailIdentity(account);
  identity.emailAddress = account.emailAddress;
  identity.realname = account.realname;
  account.identities.add(identity);
  let sentFolder = account.newFolder();
  sentFolder.specialFolder = SpecialFolder.Sent;
  account.rootFolders.add(sentFolder);
  let sent: EMail[] = [];
  account.send = async (email: EMail) => {
    sent.push(email);
  };
  appGlobal.emailAccounts.add(account);
  return sent;
}

test("The invitation email carries the files, and the iCal in it does not", async () => {
  let sent = setupOrganizerAccount();
  let event = newTestEvent("Kickoff");
  event.startTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // we don't invite to past meetings
  event.endTime = new Date(event.startTime.getTime() + 60 * 60 * 1000);
  await event.saveLocally();

  event.startEditing();
  event.participants.add(new Participant("bob@example.com", "Bob", InvitationResponse.NoResponseReceived));
  await event.save();

  expect(sent.length).toBe(1);
  let email = sent[0];
  expect(email.iCalMethod).toBe("REQUEST");
  expect(email.attachments.contents.map(a => a.filename)).toEqual(["agenda.pdf"]);
  let attachment = email.attachments.first;
  expect(attachment.mimeType).toBe("application/pdf");
  expect(new Uint8Array(await attachment.content.arrayBuffer())).toEqual(kContent);
  // The file must not be in the iCal as well, @see OutgoingInvitation.addAttachments()
  expect(await getICal(email.event, email.iCalMethod)).not.toContain("ATTACH");
});
