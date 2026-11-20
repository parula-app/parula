// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { OWACalendar } from "../../../../logic/Calendar/OWA/OWACalendar";
import type { OWAEvent } from "../../../../logic/Calendar/OWA/OWAEvent";
import { OWAIncomingInvitation } from "../../../../logic/Calendar/OWA/OWAIncomingInvitation";
import { InvitationEvent } from "../../../../logic/Calendar/Invitation/InvitationEvent";
import { InvitationMessage } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { Frequency } from "../../../../logic/Calendar/RecurrenceRule";
import type { OWAEMail } from "../../../../logic/Mail/OWA/OWAEMail";
import { expect, test } from "vitest";

/* Exchange processes a cancellation of one occurrence of a series by itself.
 * We then fetch the changed meeting from the server. In our calendar, the
 * occurrence is often still a generated instance, which has no item on the server. */

const k1Day = 24 * 60 * 60 * 1000;

test("A cancellation of one occurrence fetches the series from the server", async () => {
  let calendar = new OWACalendar();
  let master = calendar.newEvent() as OWAEvent;
  master.calUID = "series@example.com";
  master.itemID = "AAMkAGMaster=";
  master.startTime = new Date("2026-11-02T10:00:00Z");
  master.endTime = new Date("2026-11-02T11:00:00Z");
  master.newRecurrenceRule(Frequency.Daily);
  calendar.events.add(master);
  let fetched: string[] = [];
  calendar.getEventFromServerByID = async (itemID: string) => {
    fetched.push(itemID);
  };

  let cancelled = new InvitationEvent();
  cancelled.calUID = master.calUID;
  cancelled.recurrenceStartTime = new Date(master.startTime.getTime() + 2 * k1Day);
  let message = {
    invitationMessage: InvitationMessage.CancelledEvent,
    event: cancelled,
    folder: { account: { isMyEMailAddress: () => false } },
  } as any as OWAEMail;
  let invitation = new OWAIncomingInvitation(calendar, message);
  expect(invitation.calEvent()?.parentEvent).toBe(master);

  await invitation.updateFromOtherInvitationMessage();

  expect(fetched).toEqual([master.itemID]);
});
