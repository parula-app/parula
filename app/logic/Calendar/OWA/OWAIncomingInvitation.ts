import { IncomingInvitation } from "../Invitation/IncomingInvitation";
import { InvitationMessage, InvitationResponse, type InvitationResponseInMessage } from "../Invitation/InvitationStatus";
import type { OWACalendar } from "./OWACalendar";
import type { OWAEvent } from "./OWAEvent";
import type { OWAEMail } from "../../Mail/OWA/OWAEMail";
import { OWACreateItemRequest } from "../../Mail/OWA/Request/OWACreateItemRequest";
import { assert } from "../../util/util";

const ResponseTypes: Record<InvitationResponseInMessage, string> = {
  [InvitationResponse.Accept]: "AcceptItem",
  [InvitationResponse.Tentative]: "TentativelyAcceptItem",
  [InvitationResponse.Decline]: "DeclineItem",
};

export class OWAIncomingInvitation extends IncomingInvitation {
  declare readonly calendar: OWACalendar;
  declare readonly message: OWAEMail;
  readonly itemID: string | undefined;

  constructor(calendar: OWACalendar, message: OWAEMail) {
    super(calendar, message);
    let event = this.calEvent() as OWAEvent;
    this.itemID = event?.itemID;
  }

  async respondToInvitationFromMail(response: InvitationResponseInMessage, sendReply = true) {
    assert(this.invitationMessage == InvitationMessage.Invitation, "Only invitations can be responded to");
    let request = new OWACreateItemRequest({MessageDisposition: sendReply ? "SendAndSaveCopy" : "SaveOnly"});
    request.addField(ResponseTypes[response], "ReferenceItemId", {
      __type: "ItemId:#Exchange",
      Id: this.message.itemID,
    });
    let result = await this.calendar.account.callOWA(request);
    await this.message.deleteMessageLocally(); // Exchange deletes the message from the inbox
    // Exchange will have created a calendar item if there wasn't one already
    let itemID = result.Items.find(item => item?.__type == "CalendarItem:#Exchange")?.ItemId?.Id;
    if (itemID) {
      await this.calendar.getEventFromServerByID(itemID);
    }
  }

  async updateCancelled() {
    await this.updateFromOtherInvitationMessage();
  }
  async updateParticipantReply() {
    await this.updateFromOtherInvitationMessage();
  }
  async updateChangedMeeting() {
    await this.updateFromOtherInvitationMessage();
  }
  /** Exchange server auto-processes these */
  async updateFromOtherInvitationMessage() {
    assert(this.itemID, "UI should have been disabled");
    await this.calendar.getEventFromServerByID(this.itemID);
  }
}
