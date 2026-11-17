// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import type { OWAEMail } from "../../../../logic/Mail/OWA/OWAEMail";
import { OWACalendar } from "../../../../logic/Calendar/OWA/OWACalendar";
import type { Event } from "../../../../logic/Calendar/Event";
import { InvitationEvent } from "../../../../logic/Calendar/Invitation/InvitationEvent";
import { InvitationMessage, InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { Participant } from "../../../../logic/Calendar/Participant";
import { beforeAll, expect, test } from "vitest";

const kMe = "me@example.com";
const kOrganizer = "organizer@example.com";

beforeAll(() => {
  appGlobal.remoteApp ??= { OWA: {} } as any;
});

/** An OWA calendar whose account remembers the `CreateItem` requests */
function setup() {
  let account = new OWAAccount();
  account.emailAddress = kMe;
  let createItems: any[] = [];
  account.callOWA = async (request: any) => {
    createItems.push(request.Body);
    return { Items: [] };
  };
  let calendar = new OWACalendar();
  calendar.mainAccount = account;
  calendar.getEventFromServerByID = async () => null;
  return { account, calendar, createItems };
}

function addParticipants(event: Event) {
  event.participants.add(new Participant(kOrganizer, "Organizer", InvitationResponse.Organizer));
  event.participants.add(new Participant(kMe, "Me", InvitationResponse.NoResponseReceived));
  event.myParticipation = InvitationResponse.NoResponseReceived;
}

test("Accepting an invitation in the mail without a reply does not send it", async () => {
  let { account, calendar, createItems } = setup();
  let message = account.newFolder().newEMail() as OWAEMail;
  message.itemID = "mail-1";
  message.invitationMessage = InvitationMessage.Invitation;
  message.event = new InvitationEvent();
  addParticipants(message.event);
  message.deleteMessageLocally = async () => {};

  let invitation = calendar.getIncomingInvitationForEMail(message);
  await invitation.respondToInvitationFromMail(InvitationResponse.Accept, false);

  expect(createItems.length).toBe(1);
  // `SendOnly` and `SendAndSaveCopy` would send the response to the organizer
  expect(createItems[0].MessageDisposition).toBe("SaveOnly");
  expect(createItems[0].Items[0].__type).toBe("AcceptItem:#Exchange");
  expect(createItems[0].Items[0].ReferenceItemId.Id).toBe("mail-1");
});

test("Declining a meeting in the calendar without a reply does not send it", async () => {
  let { calendar, createItems } = setup();
  let event = calendar.newEvent();
  event.itemID = "event-1";
  addParticipants(event);

  await event.respondToInvitation(InvitationResponse.Decline, false);

  expect(createItems.length).toBe(1);
  expect(createItems[0].MessageDisposition).toBe("SaveOnly");
  expect(createItems[0].Items[0].__type).toBe("DeclineItem:#Exchange");
  expect(createItems[0].Items[0].ReferenceItemId.Id).toBe("event-1");
});
