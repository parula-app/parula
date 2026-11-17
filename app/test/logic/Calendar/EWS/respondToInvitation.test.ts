// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import type { EWSEMail } from "../../../../logic/Mail/EWS/EWSEMail";
import { EWSCalendar } from "../../../../logic/Calendar/EWS/EWSCalendar";
import type { Event } from "../../../../logic/Calendar/Event";
import { InvitationEvent } from "../../../../logic/Calendar/Invitation/InvitationEvent";
import { InvitationMessage, InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { Participant } from "../../../../logic/Calendar/Participant";
import { expect, test } from "vitest";

const kMe = "me@example.com";
const kOrganizer = "organizer@example.com";

/** An EWS calendar whose account remembers the `CreateItem` requests */
function setup() {
  let account = new EWSAccount();
  account.emailAddress = kMe;
  let createItems: any[] = [];
  account.callEWS = async (request: any) => {
    createItems.push(request.m$CreateItem);
    return {};
  };
  let calendar = new EWSCalendar();
  calendar.mainAccount = account;
  calendar.listEvents = async () => {};
  return { account, calendar, createItems };
}

function addParticipants(event: Event) {
  event.participants.add(new Participant(kOrganizer, "Organizer", InvitationResponse.Organizer));
  event.participants.add(new Participant(kMe, "Me", InvitationResponse.NoResponseReceived));
  event.myParticipation = InvitationResponse.NoResponseReceived;
}

test("Accepting an invitation in the mail without a reply does not send it", async () => {
  let { account, calendar, createItems } = setup();
  let message = account.newFolder().newEMail() as EWSEMail;
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
  expect(createItems[0].m$Items.t$AcceptItem.t$ReferenceItemId.Id).toBe("mail-1");
});

test("Declining a meeting in the calendar without a reply does not send it", async () => {
  let { calendar, createItems } = setup();
  let event = calendar.newEvent();
  event.itemID = "event-1";
  addParticipants(event);

  await event.respondToInvitation(InvitationResponse.Decline, false);

  expect(createItems.length).toBe(1);
  expect(createItems[0].MessageDisposition).toBe("SaveOnly");
  expect(createItems[0].m$Items.t$DeclineItem.t$ReferenceItemId.Id).toBe("event-1");
});

test("Responding to a meeting sends the response by default", async () => {
  let { calendar, createItems } = setup();
  let event = calendar.newEvent();
  event.itemID = "event-1";
  addParticipants(event);

  await event.respondToInvitation(InvitationResponse.Accept);

  expect(createItems[0].MessageDisposition).toMatch(/^Send/);
});
