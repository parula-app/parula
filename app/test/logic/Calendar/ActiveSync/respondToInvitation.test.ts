// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { ActiveSyncAccount } from "../../../../logic/Mail/ActiveSync/ActiveSyncAccount";
import type { ActiveSyncEMail } from "../../../../logic/Mail/ActiveSync/ActiveSyncEMail";
import { ActiveSyncCalendar } from "../../../../logic/Calendar/ActiveSync/ActiveSyncCalendar";
import type { Event } from "../../../../logic/Calendar/Event";
import { InvitationEvent } from "../../../../logic/Calendar/Invitation/InvitationEvent";
import { InvitationMessage, InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { Participant } from "../../../../logic/Calendar/Participant";
import type { EMail } from "../../../../logic/Mail/EMail";
import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { expect, test } from "vitest";

const kMe = "me@example.com";
const kOrganizer = "organizer@example.com";

/** An ActiveSync calendar whose account remembers the `MeetingResponse` requests and the sent mails */
function setup(protocolVersion: string) {
  let account = new ActiveSyncAccount();
  account.emailAddress = kMe;
  account.protocolVersion = protocolVersion;
  let identity = new MailIdentity(account);
  identity.emailAddress = kMe;
  account.identities.add(identity);
  let meetingResponses: any[] = [];
  account.callEAS = async (command: string, request: any) => {
    expect(command).toBe("MeetingResponse");
    meetingResponses.push(request.Request);
    return {};
  };
  let sent: EMail[] = [];
  account.send = async (email: EMail) => {
    sent.push(email);
  };
  let calendar = new ActiveSyncCalendar();
  calendar.mainAccount = account;
  calendar.serverID = "calendar-1";
  calendar.listEvents = async () => {};
  return { account, calendar, meetingResponses, sent };
}

function addParticipants(event: Event) {
  event.participants.add(new Participant(kOrganizer, "Organizer", InvitationResponse.Organizer));
  event.participants.add(new Participant(kMe, "Me", InvitationResponse.NoResponseReceived));
  event.myParticipation = InvitationResponse.NoResponseReceived;
  event.startTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // We reply only to future meetings
}

for (let protocolVersion of ["14.1", "16.1"]) {
  test(`Accepting an invitation in the mail without a reply sends nothing, ActiveSync ${protocolVersion}`, async () => {
    let { account, calendar, meetingResponses, sent } = setup(protocolVersion);
    let message = account.newFolder().newEMail() as ActiveSyncEMail;
    message.serverID = "mail-1";
    message.invitationMessage = InvitationMessage.Invitation;
    message.event = new InvitationEvent();
    addParticipants(message.event);
    message.deleteMessageLocally = async () => {};

    let invitation = calendar.getIncomingInvitationForEMail(message);
    await invitation.respondToInvitationFromMail(InvitationResponse.Accept, false);

    expect(meetingResponses.length).toBe(1);
    expect(meetingResponses[0].RequestId).toBe("mail-1");
    // With `SendResponse`, ActiveSync 16 sends the response to the organizer
    expect(meetingResponses[0].SendResponse ?? []).toEqual([]);
    // Before ActiveSync 16, we would send the response ourselves
    expect(sent.length).toBe(0);
  });

  test(`Declining a meeting in the calendar without a reply sends nothing, ActiveSync ${protocolVersion}`, async () => {
    let { calendar, meetingResponses, sent } = setup(protocolVersion);
    let event = calendar.newEvent();
    event.serverID = "event-1";
    addParticipants(event);

    await event.respondToInvitation(InvitationResponse.Decline, false);

    expect(meetingResponses.length).toBe(1);
    expect(meetingResponses[0].RequestId).toBe("event-1");
    expect(meetingResponses[0].SendResponse ?? []).toEqual([]);
    expect(sent.length).toBe(0);
  });
}
