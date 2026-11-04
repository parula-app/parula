// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { ActiveSyncAccount } from "../../../../logic/Mail/ActiveSync/ActiveSyncAccount";
import { ActiveSyncCalendar } from "../../../../logic/Calendar/ActiveSync/ActiveSyncCalendar";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import { expect, test } from "vitest";

/* When the organizer changes a series, Exchange drops its modified and deleted
 * occurrences, and the next `Change` of the series comes without them. */

// Weekly on Monday, 5 times from 2026-11-02 10:00 UTC
const kMaster = {
  Subject: "Weekly",
  StartTime: "20261102T100000Z",
  EndTime: "20261102T110000Z",
  Recurrence: { Type: "1", Interval: "1", DayOfWeek: String(1 << 1), Occurrences: "5" },
};
// The occurrence of 2026-11-09 moved to 15:00, the one of 2026-11-16 deleted
const kMasterWithOverrides = {
  ...kMaster,
  Exceptions: {
    Exception: [
      { ExceptionStartTime: "20261109T100000Z", StartTime: "20261109T150000Z", EndTime: "20261109T160000Z", Subject: "Weekly" },
      { ExceptionStartTime: "20261116T100000Z", Deleted: "1" },
    ],
  },
};

/** An ActiveSync calendar that gets `item` from the server on each sync */
async function setup(protocolVersion: string) {
  let account = new ActiveSyncAccount();
  account.protocolVersion = protocolVersion;
  account.addPingable = () => {};
  let calendar = new ActiveSyncCalendar();
  calendar.mainAccount = account;
  calendar.serverID = "calendar-1";
  calendar.storage = new DummyCalendarStorage();
  calendar.errorCallback = ex => { throw ex; };
  account.errorCallback = ex => { throw ex; };
  let command = "Add";
  let item: any = kMasterWithOverrides;
  calendar.makeSyncRequest = async (data: any, responseFunc: (response: any) => Promise<void>) => {
    await responseFunc({ Commands: { [command]: { ServerId: "series", ApplicationData: item } } });
  };
  await (calendar as any).listEventsFromServer();
  let master = calendar.getEventByServerID("series");
  expect(master.exceptions.length).toBe(1);
  expect(master.exclusions.length).toBe(1);
  command = "Change";
  return { calendar, master, serverSends: (newItem: any) => { item = newItem; } };
}

for (let protocolVersion of ["14.1", "16.1"]) {
  test(`Modified and deleted occurrences that the server dropped are back to normal, ActiveSync ${protocolVersion}`, async () => {
    let { calendar, master, serverSends } = await setup(protocolVersion);

    serverSends(kMaster);
    await (calendar as any).listEventsFromServer();

    expect(master.exceptions.length).toBe(0);
    expect(master.exclusions.length).toBe(0);
    expect(calendar.events.contents).toEqual([master]);
    expect(master.instances.contents.map(event => event.startTime.toISOString()).sort()).toEqual([
      "2026-11-02T10:00:00.000Z", "2026-11-09T10:00:00.000Z", "2026-11-16T10:00:00.000Z",
      "2026-11-23T10:00:00.000Z", "2026-11-30T10:00:00.000Z",
    ]);
  });

  test(`Modified and deleted occurrences that are still on the server stay, ActiveSync ${protocolVersion}`, async () => {
    let { calendar, master } = await setup(protocolVersion);
    let exception = master.exceptions.first;

    await (calendar as any).listEventsFromServer();

    expect(master.exceptions.contents).toEqual([exception]);
    expect(exception.startTime.toISOString()).toBe("2026-11-09T15:00:00.000Z");
    expect(master.exclusions.contents.map(exclusion => exclusion.toISOString())).toEqual(["2026-11-16T10:00:00.000Z"]);
  });
}
