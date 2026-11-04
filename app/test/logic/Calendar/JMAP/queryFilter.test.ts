// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPCalendar } from "../../../../logic/Calendar/JMAP/JMAPCalendar";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import { beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
});

test("The listing asks for events after a local date-time, as the spec defines the filter", async () => {
  // draft-ietf-jmap-calendars §5.11.1: `after: LocalDateTime`, in the `timeZone` argument, which defaults to UTC.
  // A LocalDateTime has no "Z" (draft-ietf-calext-jscalendarbis §1.5.5), and a strict server rejects it.
  let account = new JMAPAccount();
  account.accountID = "u";
  let calendar = new JMAPCalendar();
  calendar.initFromMainAccount(account);
  calendar.jmapID = "b";
  calendar.storage = new DummyCalendarStorage();
  let queries: Record<string, any>[] = [];
  account.makeCombinedCall = async (calls: [string, Record<string, any>, string?][]) => {
    queries.push(calls[0][1]);
    return {
      list: { accountId: "u", queryState: "s1", canCalculateChanges: true, position: 0, ids: [] },
      events: { accountId: "u", state: "s1", list: [], notFound: [] },
    };
  };

  await (calendar as any).listAllEvents();

  let after = queries[0].filter.after;
  expect(after).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
  // In the past, in whatever time zone the query names
  expect(new Date(after + "Z").getTime()).toBeLessThan(Date.now() - 24 * 60 * 60 * 1000);
});
