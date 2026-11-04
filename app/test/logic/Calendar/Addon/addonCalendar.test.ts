// app first, to resolve the import cycle around Addons
import { appGlobal } from "../../../../logic/app";
import type { Addon } from "../../../../logic/Addons/Addon";
import { AddonProtocol } from "../../../../logic/Addons/AddonProtocols";
import type { CalendarProtocol, EventData } from "../../../../logic/Addons/Sandbox/MustangAPI";
import { AddonCalendar } from "../../../../logic/Calendar/Addon/AddonCalendar";
import type { AddonEvent } from "../../../../logic/Calendar/Addon/AddonEvent";
import { newCalendarForProtocol } from "../../../../logic/Calendar/AccountsList/Calendars";
import { SQLCalendar } from "../../../../logic/Calendar/SQL/SQLCalendar";
import { getDatabase } from "../../../../logic/Calendar/SQL/SQLDatabase";
import { ChangeLog, FakeProtocolServer, newProtocolAddon, setUpBackend } from "../../Mail/Addon/protocolSandbox";
import sql from "../../../../../lib/rs-sqlite";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

// The real sandbox needs a browser
vi.mock("../../../../logic/Addons/AddonSandbox", async () => ({
  AddonSandbox: (await import("../../Mail/Addon/protocolSandbox")).ProtocolSandbox,
}));

// node has no DOMPurify. Marks what went through the sanitizer.
vi.mock("../../../../logic/util/convertHTML", async importOriginal => ({
  ...await importOriginal<object>(),
  sanitizeHTMLWithoutLoading: (html: string) => "sanitized without loading: " + html,
}));

/** An iCalendar with one event, and its changed occurrences */
function ical(uid: string, title: string, start = "20260714T100000Z", end = "20260714T110000Z", lines: string[] = [], occurrences: string[][] = []): string {
  let vevent = (eventLines: string[]) => ["BEGIN:VEVENT", `UID:${uid}`, "DTSTAMP:20260101T000000Z", ...eventLines, "END:VEVENT"];
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN",
    ...vevent([`DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${title}`, ...lines]),
    ...occurrences.flatMap(occurrence => vevent(occurrence)),
    "END:VCALENDAR",
  ].join("\r\n");
}

/** A calendar server, as the addon sees it */
class FakeCalendarServer extends FakeProtocolServer {
  events = new ChangeLog<EventData>();
  saved = new Map<string, string>();

  addEvents(count: number, first = 0): void {
    for (let i = first; i < first + count; i++) {
      this.events.add({ id: "e" + i, ical: ical("uid" + i, "Event " + i) });
    }
  }

  calendarProtocol(): CalendarProtocol {
    return this.protocol({
      listEvents: async (_account, syncState) => this.events.list("events", syncState),
      saveEvent: async (_account, id, ical) => {
        id ??= "new-" + (this.saved.size + 1);
        this.saved.set(id, ical);
        return id;
      },
      deleteEvent: async () => {},
    } as Partial<CalendarProtocol>) as CalendarProtocol;
  }
}

beforeAll(() => {
  setUpBackend();
});

let running: Addon[] = [];

afterEach(async () => {
  for (let addon of running) {
    await addon.disable();
    appGlobal.addons.installed.remove(addon);
  }
  running = [];
  appGlobal.calendars.clear();
});

async function newCalendar(server: FakeCalendarServer, name = "Fake Calendar"): Promise<AddonCalendar> {
  let addon = newProtocolAddon(name, ["test"], mustang => mustang.protocols.register("test", server.calendarProtocol()), "calendar");
  running.push(addon);
  await addon.enable();
  let calendar = newCalendarForProtocol(AddonProtocol.accountProtocol(addon.id, "test")) as AddonCalendar;
  calendar.name = "Test";
  calendar.username = "me";
  calendar.password = "secret";
  await calendar.save();
  appGlobal.calendars.add(calendar);
  await calendar.login(false);
  return calendar;
}

async function storedEvents(calendar: AddonCalendar): Promise<any[]> {
  return await (await getDatabase()).all(sql`SELECT pID, title FROM event WHERE calendarID = ${calendar.dbID} AND pID IS NOT NULL`) as any[];
}

function eventOf(calendar: AddonCalendar, id: string): AddonEvent {
  return calendar.events.find(event => event.pID == id);
}

describe("Round trip", () => {
  test("Syncs the events in chunks, parses and stores them, and continues at the stored sync state", async () => {
    let server = new FakeCalendarServer();
    server.addEvents(1500);
    server.events.add({ id: "weekly", ical: ical("weekly-uid", "Weekly", "20260706T090000Z", "20260706T100000Z", ["RRULE:FREQ=WEEKLY;COUNT=5", "EXDATE:20260720T090000Z"],
      [["RECURRENCE-ID:20260713T090000Z", "DTSTART:20260713T140000Z", "DTEND:20260713T150000Z", "SUMMARY:Weekly, moved"]]) });
    let calendar = await newCalendar(server);
    expect(calendar).toBeInstanceOf(AddonCalendar);

    await calendar.listEvents();

    expect(server.callsOf("listEvents").length).toBe(2);
    expect(server.callsOf("listEvents")[0][1]).toBeNull();
    let event = eventOf(calendar, "e7");
    expect(event.title).toBe("Event 7");
    expect(event.calUID).toBe("uid7");
    expect(event.startTime.toISOString()).toBe("2026-07-14T10:00:00.000Z");
    expect((await storedEvents(calendar)).length).toBe(1501);
    let weekly = eventOf(calendar, "weekly");
    expect(weekly.recurrenceRule).toBeTruthy();
    expect(weekly.exceptions.contents.map(exception => exception.title)).toEqual(["Weekly, moved"]);
    expect(weekly.exclusions.contents.map(date => date.toISOString())).toContain("2026-07-20T09:00:00.000Z");

    // Restart
    let calendars = await SQLCalendar.readAll();
    let restarted = calendars.find(loaded => loaded.id == calendar.id) as AddonCalendar;
    expect(restarted).toBeInstanceOf(AddonCalendar);
    expect(restarted.syncState).toBe(calendar.syncState);
    expect(typeof restarted.syncState).toBe("string");
    appGlobal.calendars.remove(calendar);
    appGlobal.calendars.add(restarted);
    server.calls = [];
    server.addEvents(1, 2000);
    server.events.add({ id: "e0", ical: ical("uid0", "Event 0, changed") });
    server.events.remove("e1");

    await restarted.login(false);
    await restarted.listEvents();

    expect(server.callsOf("listEvents")[0][1]).toBe(calendar.syncState);
    expect(eventOf(restarted, "e0").title).toBe("Event 0, changed");
    expect(eventOf(restarted, "e1")).toBeUndefined();
    expect(eventOf(restarted, "e2000")).toBeTruthy();
    let stored = await storedEvents(restarted);
    expect(stored.length).toBe(1501);
    expect(stored.find(row => row.pID == "e0").title).toBe("Event 0, changed");
  }, 60000);

  test("New, changed and deleted events go to the addon as iCalendar", async () => {
    let server = new FakeCalendarServer();
    let calendar = await newCalendar(server);
    let event = calendar.newEvent();
    event.title = "Planning";
    event.startTime = new Date("2026-07-14T10:00:00Z");
    event.endTime = new Date("2026-07-14T11:00:00Z");

    await event.save();

    let [account, id, sent] = server.callsOf("saveEvent")[0];
    expect(account.id).toBe(calendar.id);
    expect(id).toBeNull();
    expect(sent).toContain("BEGIN:VEVENT");
    expect(sent).toContain("SUMMARY:Planning");
    expect(event.pID).toBe("new-1");
    expect((await storedEvents(calendar)).map(row => row.pID)).toEqual(["new-1"]);

    event.title = "Planning, longer";
    await event.save();
    expect(server.callsOf("saveEvent")[1][1]).toBe("new-1");
    expect(server.callsOf("saveEvent")[1][2]).toContain("SUMMARY:Planning\\, longer");

    await event.deleteIt();
    expect(server.callsOf("deleteEvent")[0][1]).toBe("new-1");
    expect(await storedEvents(calendar)).toEqual([]);
  });
});

describe("Checks of the data from the addon", () => {
  test("Control characters, HTML descriptions, wrong types and too large events don't reach the app as they are", async () => {
    let server = new FakeCalendarServer();
    server.events.add({ id: "evil", ical: ical("evil-uid", "Evil‮gnp.exe\u0007", undefined, undefined, [
      "LOCATION:Room ‮1",
      "DESCRIPTION:Text",
      "X-ALT-DESC;FMTTYPE=text/html:<img src=\"https://tracker.example.com/x.png\">",
    ]) });
    server.events.add({ id: "huge", ical: ical("huge-uid", "x".repeat(1024 * 1024)) });
    server.events.add({ id: "number", ical: 42 as any });
    server.events.add({ id: { x: 1 } as any, ical: ical("wrong-id", "Wrong type of ID") });
    server.events.add({ id: "todo", ical: "BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:todo\r\nSUMMARY:Task\r\nEND:VTODO\r\nEND:VCALENDAR" });
    let calendar = await newCalendar(server);

    await calendar.listEvents();

    let evil = eventOf(calendar, "evil");
    expect(evil.title).toBe("Evil gnp.exe");
    expect(evil.location).toBe("Room  1");
    expect(evil.rawHTMLDangerous).toMatch(/^sanitized without loading: /);
    expect(calendar.events.contents.map(event => event.pID).sort()).toEqual(["evil"]);
    expect(calendar.dataErrors.hasItems).toBe(true);
  });

  test("Too many events per call, a sync state over 10 KB, and a sync without progress are stopped", async () => {
    let server = new FakeCalendarServer();
    server.events.chunkSize = 1001;
    server.addEvents(1001);
    let calendar = await newCalendar(server);
    await expect(calendar.listEvents()).rejects.toThrow(/more than 1000/);
    expect(calendar.events.isEmpty).toBe(true);

    let bigState = new FakeCalendarServer();
    let bigStateCalendar = await newCalendar(bigState, "Big state");
    (bigState as any).events.list = () => ({ events: [], syncState: "s".repeat(10 * 1024 + 1) });
    await expect(bigStateCalendar.listEvents()).rejects.toThrow(/10 KB/);

    let stuck = new FakeCalendarServer();
    stuck.events.isStuck = true;
    let stuckCalendar = await newCalendar(stuck, "Stuck");
    let errors: Error[] = [];
    stuckCalendar.errorCallback = ex => errors.push(ex);
    await stuckCalendar.listEvents();
    expect(errors.some(ex => ex.message.includes("keeps reporting more"))).toBe(true);
    expect(stuck.callsOf("listEvents").length).toBeLessThan(5);
  });
});
