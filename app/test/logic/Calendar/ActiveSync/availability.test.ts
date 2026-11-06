// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { ActiveSyncCalendar } from "../../../../logic/Calendar/ActiveSync/ActiveSyncCalendar";
import { Participant } from "../../../../logic/Calendar/Participant";
import { InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { FreeBusyStatus } from "../../../../logic/Calendar/FreeBusyEvent";
import { expect, test } from "vitest";

function at(hours: number, minutes = 0): Date {
  return new Date(2026, 9, 15, hours, minutes);
}

/** A calendar whose server answers `ResolveRecipients` with the `MergedFreeBusy` string,
 * one digit per half hour from 8:00 on: 0 = free, 1 = tentative, 2 = busy, 3 = out of office, 4 = no data */
async function availability(mergedFreeBusy: string) {
  let calendar = new ActiveSyncCalendar();
  calendar.mainAccount = {
    async callEAS(command: string, query: any) {
      expect(command).toBe("ResolveRecipients");
      expect(query.Options.Availability.StartTime).toBe(at(8).toISOString());
      return { Response: { Status: "1", Recipient: { Availability: { MergedFreeBusy: mergedFreeBusy } } } };
    },
  } as any;
  let participant = new Participant("anna@example.com", "Anna", InvitationResponse.NoResponseReceived);
  let [result] = await calendar.arePersonsFree([participant], at(8), at(12));
  expect(result.participant).toBe(participant);
  return result.availability?.map(event => [event.startTime, event.endTime, event.busyStatus]);
}

test("Half hours with the same status become one appointment", async () => {
  expect(await availability("00221130")).toEqual([
    [at(8), at(9), FreeBusyStatus.Free],
    [at(9), at(10), FreeBusyStatus.Busy],
    [at(10), at(11), FreeBusyStatus.Tentative],
    [at(11), at(11, 30), FreeBusyStatus.OutOfOffice],
    [at(11, 30), at(12), FreeBusyStatus.Free],
  ]);
});

test("No data is neither free nor busy", async () => {
  expect(await availability("44402242")).toEqual([
    [at(9, 30), at(10), FreeBusyStatus.Free],
    [at(10), at(11), FreeBusyStatus.Busy],
    [at(11, 30), at(12), FreeBusyStatus.Busy],
  ]);
});

test("Only no data means that the availability is unknown", async () => {
  expect(await availability("44444444")).toBeUndefined();
});
