import { IncomingInvitation } from "../Invitation/IncomingInvitation";
import { InvitationMessage, InvitationResponse, type InvitationResponseInMessage } from "../Invitation/InvitationStatus";
import type { EWSCalendar } from "./EWSCalendar";
import type { EWSEMail } from "../../Mail/EWS/EWSEMail";
import { EWSCreateItemRequest } from "../../Mail/EWS/Request/EWSCreateItemRequest";
import { assert } from "../../util/util";

const ResponseTypes: Record<InvitationResponseInMessage, string> = {
  [InvitationResponse.Accept]: "AcceptItem",
  [InvitationResponse.Tentative]: "TentativelyAcceptItem",
  [InvitationResponse.Decline]: "DeclineItem",
};

export class EWSIncomingInvitation extends IncomingInvitation {
  declare readonly calendar: EWSCalendar;
  declare readonly message: EWSEMail;

  async respondToInvitationFromMail(response: InvitationResponseInMessage, sendReply = true) {
    assert(this.invitationMessage == InvitationMessage.Invitation, "Only invitations can be responded to");
    let request = new EWSCreateItemRequest({MessageDisposition: sendReply ? "SendAndSaveCopy" : "SaveOnly"});
    request.addField(ResponseTypes[response], "ReferenceItemId", { Id: this.message.itemID });
    await this.calendar.account.callEWS(request);
    await this.message.deleteMessageLocally(); // Exchange deletes the message from the inbox
    await this.calendar.listEvents(); // Exchange will have created a calendar item if there wasn't one already
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
    await this.calendar.listEvents();
  }
}
