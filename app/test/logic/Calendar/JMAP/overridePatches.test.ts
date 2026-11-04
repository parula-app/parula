// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPCalendar } from "../../../../logic/Calendar/JMAP/JMAPCalendar";
import { JSCalendarEvent } from "../../../../logic/Calendar/JMAP/JSCalendarEvent";
import type { TJMAPCalendarEvent } from "../../../../logic/Calendar/JMAP/TJSCalendar";
import { InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { applyPatch } from "./applyPatch";
import { afterEach, beforeAll, expect, test } from "vitest";

const kMe = "me@example.com";
const kOrganizer = "organizer@example.com";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
});

afterEach(() => {
  appGlobal.emailAccounts.clear();
});

/** A weekly meeting that I organize, in which an attendee declined one occurrence,
 * which also takes place in another room. Servers that store JSCalendar natively
 * write such overrides as patches into the properties (draft-ietf-jmap-calendars §5.9.1). */
function series(): TJMAPCalendarEvent {
  return {
    "@type": "Event",
    id: "x",
    uid: "8b2f4c1e-weekly",
    title: "Team meeting",
    start: "2026-11-02T10:00:00",
    timeZone: "Europe/Berlin",
    duration: "PT1H",
    recurrenceRule: { "@type": "RecurrenceRule", frequency: "weekly", count: 6 },
    locations: { l1: { "@type": "Location", name: "Room A" } },
    organizerCalendarAddress: "mailto:" + kMe,
    participants: {
      meID: { "@type": "Participant", calendarAddress: "mailto:" + kMe, roles: { owner: true }, participationStatus: "accepted" },
      tomID: { "@type": "Participant", calendarAddress: "mailto:tom@example.com", name: "Tom", participationStatus: "accepted" },
    },
    recurrenceOverrides: {
      "2026-11-09T10:00:00": {
        "participants/tomID/participationStatus": "declined",
        "locations/l1/name": "Room B",
      },
    },
    calendarIds: { b: true },
    isDraft: false,
    isOrigin: true,
  } as any as TJMAPCalendarEvent;
}

async function setup() {
  let account = new JMAPAccount();
  account.accountID = "u";
  let identity = new MailIdentity(account);
  identity.emailAddress = kMe;
  account.identities.add(identity);
  appGlobal.emailAccounts.add(account);
  let calendar = new JMAPCalendar();
  calendar.initFromMainAccount(account);
  calendar.jmapID = "b";
  calendar.storage = new DummyCalendarStorage();
  calendar.errorCallback = ex => { throw ex; };
  account.makeCombinedCall = async (calls: [string, Record<string, any>, string?][]) => {
    let { position = 0, limit = Infinity, calculateTotal } = calls[0][1];
    let page = [series()].slice(position, position + limit);
    return {
      list: { accountId: "u", queryState: "s1", canCalculateChanges: true, position, ids: page.map(event => event.id), total: calculateTotal ? 1 : undefined },
      events: { accountId: "u", state: "s1", list: page, notFound: [] },
    };
  };
  let sent: Record<string, any>[] = [];
  account.makeSingleCall = async (method: string, args: Record<string, any>) => {
    sent.push(args);
    return { updated: { x: null } };
  };
  await (calendar as any).listAllEvents();
  let master = calendar.events.find(event => !event.parentEvent);
  return { master, sent };
}

test("A patch inside a property of an occurrence is applied", async () => {
  let { master } = await setup();

  let occurrence = master.exceptions.first;
  expect(occurrence.startTime.toISOString()).toBe("2026-11-09T09:00:00.000Z");
  expect(occurrence.location).toBe("Room B");
  expect(occurrence.participants.find(p => p.emailAddress == "tom@example.com").response).toBe(InvitationResponse.Decline);
  // The series stays as it is
  expect(master.location).toBe("Room A");
  expect(master.participants.find(p => p.emailAddress == "tom@example.com").response).toBe(InvitationResponse.Accept);
});

/** The pointers in `override` that make it an invalid PatchObject
 * (draft-ietf-calext-jscalendarbis §1.5.9, §3.3.4) */
function invalidPatches(override: Record<string, any>): string[] {
  let tokens = (path: string) => path.split("/");
  let isPrefix = (a: string, b: string) => a != b && tokens(b).slice(0, tokens(a).length).join("/") == a;
  let forbidden = ["@type", "method", "organizerCalendarAddress", "privacy", "prodId", "recurrenceId", "recurrenceIdTimeZone", "sentBy", "uid"];
  return Object.keys(override).filter(path =>
    Object.keys(override).some(other => isPrefix(other, path)) ||
    forbidden.includes(path) ||
    /^participants\/[^/]+\/calendarAddress$/.test(path) ||
    ["recurrenceOverrides", "recurrenceRule"].includes(tokens(path)[0]));
}

test("A changed occurrence is a valid patch", async () => {
  let { master, sent } = await setup();

  let occurrence = master.exceptions.first;
  occurrence.title = "Team meeting, in room B";
  await occurrence.save();

  let stored = applyPatch(series(), sent[0].update.x);
  let override = stored.recurrenceOverrides["2026-11-09T10:00:00"];
  expect(invalidPatches(override)).toEqual([]);
  // The occurrence: the series with the override applied as PatchObject
  let read = structuredClone(stored);
  delete read.recurrenceRule;
  delete read.recurrenceOverrides;
  read.start = "2026-11-09T10:00:00";
  read = applyPatch(read, override);
  expect(read.title).toBe("Team meeting, in room B");
  expect(Object.values(read.locations).map(location => location.name)).toEqual(["Room B"]);
  expect(Object.values(read.participants).find(p => p.calendarAddress.toLowerCase() == "mailto:tom@example.com").participationStatus).toBe("declined");
});

test("A patch path with an escaped / or ~ applies to that key", () => {
  let json = series();
  json.keywords = { "a/b": true, "c~d": true };
  // RFC 6901 §4: "~01" is an escaped "~" followed by "1", so the key is "h~1", not "h/"
  let override = { "keywords/a~1b": null, "keywords/c~0d": null, "keywords/e~1f~0g": true, "keywords/h~01": true } as any as TJMAPCalendarEvent;

  let occurrence = JSCalendarEvent.applyOverride(json, "2026-11-09T10:00:00", override);

  expect(Object.keys(occurrence.keywords).sort()).toEqual(["e/f~g", "h~1"]);
});

test("A patch path through a property that the series doesn't have is not applied", () => {
  // RFC 8620 §5.3: All parts prior to the last must already exist
  let override = { "links/l1/href": "https://example.com/agenda" } as any as TJMAPCalendarEvent;

  let occurrence = JSCalendarEvent.applyOverride(series(), "2026-11-09T10:00:00", override);

  expect(occurrence.links).toBeUndefined();
});

test("A patch path into the prototype changes no other object", () => {
  let override = JSON.parse(`{
    "__proto__/polluted": true,
    "constructor/prototype/polluted": true,
    "participants/__proto__/polluted": true
  }`);
  try {
    JSCalendarEvent.applyOverride(series(), "2026-11-09T10:00:00", override);
    expect(({} as any).polluted).toBeUndefined();
  } finally {
    delete (Object.prototype as any).polluted;
  }
});

test("A patch of the key `__proto__` sets that key, not the prototype", () => {
  let override = JSON.parse(`{
    "__proto__": { "title": "Not from the series" },
    "participants/__proto__": { "polluted": true }
  }`);

  let occurrence = JSCalendarEvent.applyOverride(series(), "2026-11-09T10:00:00", override);

  expect(Object.getPrototypeOf(occurrence)).toBe(Object.prototype);
  expect(Object.getPrototypeOf(occurrence.participants)).toBe(Object.prototype);
  expect(Object.keys(occurrence.participants)).toContain("__proto__");
  expect(occurrence.title).toBe("Team meeting");
});

test("A patch path through a text is not applied", () => {
  let override = { "title/x": "y" } as any as TJMAPCalendarEvent;

  let occurrence = JSCalendarEvent.applyOverride(series(), "2026-11-09T10:00:00", override);

  expect(occurrence.title).toBe("Team meeting");
});
