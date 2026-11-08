// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPCalendar } from "../../../../logic/Calendar/JMAP/JMAPCalendar";
import type { TJMAPCalendarEvent } from "../../../../logic/Calendar/JMAP/TJSCalendar";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import { applyPatch } from "./applyPatch";
import { beforeAll, expect, test } from "vitest";

/* JSCalendar-bis reserves `Location.description` (draft-ietf-calext-jscalendarbis §A.2.2.4),
 * and an object that sets a reserved property is invalid (§1.7.3). */

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
});

function setup(events: TJMAPCalendarEvent[]) {
  let account = new JMAPAccount();
  account.accountID = "u";
  let calendar = new JMAPCalendar();
  calendar.initFromMainAccount(account);
  calendar.jmapID = "b";
  calendar.storage = new DummyCalendarStorage();
  account.makeCombinedCall = async () => ({
    list: { accountId: "u", queryState: "s", ids: events.map(event => event.id), position: 0, canCalculateChanges: true },
    events: { accountId: "u", state: "s", list: events, notFound: [] },
  });
  let sent: Record<string, any>[] = [];
  account.makeSingleCall = async (method: string, args: Record<string, any>) => {
    sent.push(args);
    return args.create
      ? { created: { [Object.keys(args.create)[0]]: { id: "e" } } }
      : { updated: { [Object.keys(args.update)[0]]: null } };
  };
  return { calendar, sent };
}

function serverEvent(location: Record<string, any>): TJMAPCalendarEvent {
  return {
    "@type": "Event", id: "x", uid: "uid", title: "Visit",
    start: "2026-11-21T10:00:00", timeZone: "Europe/Berlin", duration: "PT1H",
    locations: { l1: { "@type": "Location", ...location } },
    calendarIds: { b: true },
  } as any as TJMAPCalendarEvent;
}

test("A location with details is written into the name only", async () => {
  let { calendar, sent } = setup([]);
  let event = calendar.newEvent();
  event.title = "Visit";
  event.startTime = new Date("2026-11-21T09:00:00Z");
  event.endTime = new Date("2026-11-21T10:00:00Z");
  event.location = "Building A\n---\n2nd floor, room 7";
  calendar.events.add(event);

  await event.save();

  let locations = Object.values(sent[0].create[event.id].locations);
  expect(locations.length).toBe(1);
  expect(locations[0]).not.toHaveProperty("description");
  expect(locations[0].name).toContain("Building A");
  expect(locations[0].name).toContain("2nd floor, room 7");
});

test("A location with a description from older data is shown with it, and saved into the name", async () => {
  let { calendar, sent } = setup([serverEvent({ name: "Building A", description: "2nd floor" })]);
  await (calendar as any).listAllEvents();
  let event = calendar.events.first;
  expect(event.location).toContain("Building A");
  expect(event.location).toContain("2nd floor");

  // Our update sends the whole location, so a kept description would make the saved event invalid
  event.title = "Visit to the lab";
  await event.save();

  let stored = applyPatch(serverEvent({ name: "Building A", description: "2nd floor" }), sent[0].update.x);
  let locations = Object.values(stored.locations);
  expect(locations.length).toBe(1);
  expect(locations[0]).not.toHaveProperty("description");
  expect(locations[0].name).toContain("Building A");
  expect(locations[0].name).toContain("2nd floor");

  // Reads back as the same text
  let reread = calendar.newEvent();
  reread.fromJMAP(stored);
  expect(reread.location).toBe(event.location);
});

test("A changed location replaces the description of older data", async () => {
  let { calendar, sent } = setup([serverEvent({ name: "Building A", description: "2nd floor" })]);
  await (calendar as any).listAllEvents();
  let event = calendar.events.first;

  event.location = "Building B";
  await event.save();

  let stored = applyPatch(serverEvent({ name: "Building A", description: "2nd floor" }), sent[0].update.x);
  let locations = Object.values(stored.locations);
  expect(locations.length).toBe(1);
  expect(locations[0].name).toBe("Building B");
  expect(locations[0]).not.toHaveProperty("description");
});
