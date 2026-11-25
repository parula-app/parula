// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { Calendar } from "../../../logic/Calendar/Calendar";
import type { Event } from "../../../logic/Calendar/Event";
import { Frequency, RecurrenceRule } from "../../../logic/Calendar/RecurrenceRule";
import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
import { DummyCalendarStorage } from "../../../logic/Calendar/SQL/DummyCalendarStorage";
import { EWSCalendar } from "../../../logic/Calendar/EWS/EWSCalendar";
import { EWSEvent } from "../../../logic/Calendar/EWS/EWSEvent";
import { EWSAccount } from "../../../logic/Mail/EWS/EWSAccount";
import { OWACalendar } from "../../../logic/Calendar/OWA/OWACalendar";
import { OWAEvent } from "../../../logic/Calendar/OWA/OWAEvent";
import { OWAAccount } from "../../../logic/Mail/OWA/OWAAccount";
import { ActiveSyncEvent } from "../../../logic/Calendar/ActiveSync/ActiveSyncEvent";
import { JSCalendarEvent } from "../../../logic/Calendar/JMAP/JSCalendarEvent";
import type { TJMAPCalendarEvent } from "../../../logic/Calendar/JMAP/TJSCalendar";
import { getTagByName } from "../../../logic/Abstract/Tag";
import { expect, test } from "vitest";

const kCustomer = getTagByName("Customer");
const kTravel = getTagByName("Travel");

function tagNames(event: Event): string[] {
  return event.tags.contents.map(tag => tag.name);
}

/** A calendar on this computer, which counts how often it saved an event */
function newCalendar() {
  let calendar = new Calendar();
  calendar.name = "Test";
  let saved = { count: 0 };
  calendar.storage = new DummyCalendarStorage();
  calendar.storage.saveEvent = async () => { saved.count++; };
  return { calendar, saved };
}

function newEvent(calendar: Calendar): Event {
  let event = calendar.newEvent();
  event.title = "Planning";
  event.startTime = new Date("2026-07-14T10:00:00Z");
  event.endTime = new Date("2026-07-14T11:00:00Z");
  return event;
}

// Model

test("A new tag is a change of the event, and cancelling the editing removes it again", () => {
  let event = newEvent(newCalendar().calendar);
  event.tags.add(kCustomer);
  event.startEditing();

  event.tags.add(kTravel);
  expect(event.hasChanged()).toBe(true);

  event.cancelEditing();
  expect(tagNames(event)).toEqual(["Customer"]);
});

test("The occurrences of a series have the tags of the series", () => {
  let event = newEvent(newCalendar().calendar);
  event.tags.add(kCustomer);
  event.recurrenceRule = new RecurrenceRule({ masterDuration: 3600, seriesStartTime: event.startTime, frequency: Frequency.Daily, count: 3 });

  expect(tagNames(event.instances.get(1))).toEqual(["Customer"]);
});

test("While the user edits the event, a new tag is saved only with the other changes", async () => {
  let { calendar, saved } = newCalendar();
  let event = newEvent(calendar);
  event.startEditing();

  await event.addTag(kCustomer);

  expect(saved.count).toBe(0);
  expect(tagNames(event)).toEqual(["Customer"]);
});

test("The tags of an invitation are saved right away, and closing the invitation keeps them", async () => {
  let { calendar, saved } = newCalendar();
  let event = newEvent(calendar);
  event.myParticipation = InvitationResponse.Accept;
  event.startEditing(); // Lookout opens the invitation in its event form

  await event.addTag(kCustomer);
  expect(saved.count).toBe(1);

  event.cancelEditing();
  expect(tagNames(event)).toEqual(["Customer"]);
});

// EWS

function newEWSCalendar(requests: any[]): EWSCalendar {
  let account = new EWSAccount();
  account.callEWS = async (request: any) => {
    requests.push(request);
    return { Items: { CalendarItem: { ItemId: { Id: "item" } } } };
  };
  let calendar = new EWSCalendar();
  calendar.name = "Test";
  calendar.folderID = "calendar-folder";
  calendar.mainAccount = account;
  return calendar;
}

test("EWS: Read the tags", () => {
  let event = new EWSEvent(new Calendar() as any);
  event.fromXML({
    ItemId: { Id: "item" },
    Subject: "Planning",
    Start: "2026-07-14T10:00:00Z",
    End: "2026-07-14T11:00:00Z",
    Categories: { String: ["Customer", "Travel"] },
  });

  expect(tagNames(event)).toEqual(["Customer", "Travel"]);
});

test("EWS: Save the tags of a new event, where the schema wants them", async () => {
  let requests = [];
  let event = newEvent(newEWSCalendar(requests)) as EWSEvent;
  event.calUID = "uid";
  event.tags.addAll([kCustomer, kTravel]);

  await event.saveCalendarItemToServer();

  let item = requests[0].m$CreateItem.m$Items.t$CalendarItem;
  expect(item.t$Categories.t$String).toEqual(["Customer", "Travel"]);
  // EWS rejects elements in the wrong order: `Categories` is after `Body` and before `ReminderIsSet`
  let fields = Object.keys(item);
  expect(fields.indexOf("t$Categories")).toBeGreaterThan(fields.indexOf("t$Body"));
  expect(fields.indexOf("t$Categories")).toBeLessThan(fields.indexOf("t$ReminderIsSet"));
});

test("EWS: Removing the last tag removes the categories on the server", async () => {
  let requests = [];
  let event = newEvent(newEWSCalendar(requests)) as EWSEvent;
  event.calUID = "uid";
  event.itemID = "item";

  await event.saveCalendarItemToServer();

  let deleted = requests[0].m$UpdateItem.m$ItemChanges.t$ItemChange.t$Updates.t$DeleteItemField;
  expect(deleted.map(field => field.t$FieldURI.FieldURI)).toContain("item:Categories");
});

test("EWS: Save the tags of an invitation", async () => {
  let requests = [];
  let event = newEvent(newEWSCalendar(requests)) as EWSEvent;
  event.itemID = "item";
  event.myParticipation = InvitationResponse.Accept;
  event.tags.add(kCustomer);

  await event.saveCalendarItemToServer();

  let set = requests[0].m$UpdateItem.m$ItemChanges.t$ItemChange.t$Updates.t$SetItemField;
  let categories = set.find(field => field.t$FieldURI.FieldURI == "item:Categories");
  expect(categories.t$CalendarItem.t$Categories.t$String).toEqual(["Customer"]);
});

// OWA

test("OWA: Read the tags", () => {
  let event = new OWAEvent();
  event.fromJSON({
    ItemId: { Id: "AAMkAGItem=" },
    Subject: "Planning",
    Start: "2026-07-14T10:00:00Z",
    End: "2026-07-14T11:00:00Z",
    Categories: ["Customer", "Travel"],
  });

  expect(tagNames(event)).toEqual(["Customer", "Travel"]);
});

test("OWA: Save the tags", async () => {
  appGlobal.remoteApp ??= { OWA: {} } as any;
  let requests = [];
  let account = new OWAAccount();
  account.callOWA = async (request: any) => {
    requests.push(request);
    return { Items: [{ ItemId: { Id: "AAMkAGItem=" } }] };
  };
  let calendar = new OWACalendar();
  calendar.name = "Test";
  calendar.folderID = "calendar-folder";
  calendar.mainAccount = account;
  let event = newEvent(calendar) as OWAEvent;
  event.calUID = "uid";
  event.tags.addAll([kCustomer, kTravel]);

  await event.saveCalendarItem();

  expect(requests[0].Body.Items[0].Categories).toEqual(["Customer", "Travel"]);
});

// ActiveSync

function newActiveSyncEvent(master?: ActiveSyncEvent): ActiveSyncEvent {
  let calendar = new Calendar() as any;
  calendar.account = { protocolVersion: "16.1" };
  return new ActiveSyncEvent(calendar, master);
}

test("ActiveSync: Read the tags", () => {
  let event = newActiveSyncEvent();
  event.fromWBXML({ Subject: "Planning", Categories: { Category: ["Customer", "Travel"] } });

  expect(tagNames(event)).toEqual(["Customer", "Travel"]);
});

test("ActiveSync: A modified occurrence without categories has the tags of the series", () => {
  // MS-ASCAL: An `Exception` has only the properties that differ from the series
  let master = newActiveSyncEvent();
  master.fromWBXML({ Subject: "Planning", Categories: { Category: "Customer" } });
  let occurrence = newActiveSyncEvent(master);
  occurrence.fromWBXML({ Subject: "Planning, moved" });
  expect(tagNames(occurrence)).toEqual(["Customer"]);

  occurrence.fromWBXML({ Categories: { Category: "Travel" } });
  expect(tagNames(occurrence)).toEqual(["Travel"]);
});

test("ActiveSync: Save the tags", () => {
  let event = newActiveSyncEvent();
  event.startTime = new Date("2026-07-14T10:00:00Z");
  event.endTime = new Date("2026-07-14T11:00:00Z");
  event.tags.addAll([kCustomer, kTravel]);

  expect(event.toFields().Categories.Category).toEqual(["Customer", "Travel"]);
});

// JMAP

function jmapEvent(): TJMAPCalendarEvent {
  return {
    "@type": "Event",
    id: "eventID",
    uid: "server-uid",
    title: "Planning",
    start: "2026-07-14T10:00:00",
    timeZone: "Europe/Berlin",
    duration: "PT1H",
    keywords: { Customer: true, Travel: true },
  } as any as TJMAPCalendarEvent;
}

test("JMAP: Read the tags", () => {
  let event = newCalendar().calendar.newEvent();
  JSCalendarEvent.toEvent(jmapEvent(), event);

  expect(tagNames(event)).toEqual(["Customer", "Travel"]);
});

test("JMAP: Save the tags, also when the user removed all", () => {
  let event = newCalendar().calendar.newEvent();
  JSCalendarEvent.toEvent(jmapEvent(), event);
  event.tags.remove(kTravel);

  let jmap = {} as TJMAPCalendarEvent;
  JSCalendarEvent.fromEvent(event, jmap);
  expect(jmap.keywords).toEqual({ Customer: true });

  event.tags.clear();
  JSCalendarEvent.fromEvent(event, jmap);
  // `null` removes them on the server, also in the override of an occurrence, where a missing property means: like the series
  expect(jmap.keywords).toBe(null);
});
