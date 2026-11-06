import { ICalParser } from "./ICalParser";
import type { EMail } from "../../Mail/EMail";
import { InvitationMessage } from "../Invitation/InvitationStatus";
import { EMailProcessor, ProcessingStartOn } from "../../Mail/EMailProcessor";
import { convertICalContainerToEvent } from "./ICalToEvent";

export class ICalEMailProcessor extends EMailProcessor {
  runOn = ProcessingStartOn.Parse;
  async process(email: EMail) {
    let invitationBlob = email.attachments.find(a => a.mimeType == "text/calendar")?.content;
    if (!invitationBlob) {
      return;
    }
    let invitationStr = await invitationBlob.text();
    let ics = new ICalParser(invitationStr);
    email.invitationMessage = iTIPMethod(ics);
    const { InvitationEvent } = await import("../Invitation/InvitationEvent"); // avoid circular import: InvitationEvent extends Event
    let event = new InvitationEvent();
    let vevent = ics.containers.vcalendar?.[0].containers.vevent?.[0];
    if (!vevent) {
      return;
    }
    convertICalContainerToEvent(vevent, event);
    if (event.attachments.isEmpty) {
      // Exchange and Google send the files that the organizer attached to the
      // event as attachments of the email, instead of inline in the iCal.
      await event.adoptAttachmentsFrom(email);
    }
    event.isCancelled = email.invitationMessage == InvitationMessage.CancelledEvent;
    if (email.hasHTML) {
      event.rawHTMLDangerous = email.rawHTMLDangerous;
    }
    email.event = event;

    if (email.invitationMessage == InvitationMessage.Invitation ||
        email.invitationMessage == InvitationMessage.ParticipantReply ||
        email.invitationMessage == InvitationMessage.CancelledEvent) {
      let foundEventInCalendars = email.folder.account.calendarsAvailable.filterOnce(cal => cal.hasMatchingEvent(event));
      for (let calendar of foundEventInCalendars) {
        let incomingInvitation = calendar.getIncomingInvitationForEMail(email);
        await incomingInvitation.updateFromOtherInvitationMessage();
      }
    }
  }
}

/* Find the iTIP method from a parsed vcalendar part */
function iTIPMethod(ics: any): InvitationMessage {
  switch (ics.containers.vcalendar?.[0].entries.method?.[0].value) {
  case "CANCEL":
    return InvitationMessage.CancelledEvent;
  case "REQUEST":
    return InvitationMessage.Invitation;
  case "REPLY":
    return InvitationMessage.ParticipantReply;
  }
  return InvitationMessage.None;
}
