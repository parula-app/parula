import { IncomingInvitation } from "../Invitation/IncomingInvitation";
import { InvitationMessage, InvitationResponse, type InvitationResponseInMessage } from "../Invitation/InvitationStatus";
import type { ActiveSyncCalendar } from "./ActiveSyncCalendar";
import type { ActiveSyncEMail } from "../../Mail/ActiveSync/ActiveSyncEMail";
import { assert } from "../../util/util";

const ActiveSyncResponse: Record<InvitationResponseInMessage, number> = {
  [InvitationResponse.Accept]: 1,
  [InvitationResponse.Tentative]: 2,
  [InvitationResponse.Decline]: 3,
};

export class ActiveSyncIncomingInvitation extends IncomingInvitation {
  declare readonly calendar: ActiveSyncCalendar;
  declare readonly message: ActiveSyncEMail;

  async respondToInvitationFromMail(response: InvitationResponseInMessage, sendReply = true) {
    assert(this.invitationMessage == InvitationMessage.Invitation, "Only invitations can be responded to");
    let request = {
      Request: {
        UserResponse: ActiveSyncResponse[response],
        CollectionId: this.message.folder.id,
        RequestId: this.message.serverID,
        // `{}` sends an empty element, and the server sends the reply, `[]` sends nothing
        // In < 16.1, we send the reply ourselves, see below
        SendResponse: sendReply && this.calendar.account.protocolVersion == "16.1" ? {} : [],
      },
    };
    await this.calendar.account.callEAS("MeetingResponse", request);
    this.event.myParticipation = response;
    // We asked ActiveSync 16.1 to send the response for us.
    if (this.calendar.account.protocolVersion != "16.1") {
      await this.event.respondToInvitation(response, sendReply, this.calendar.account, false);
    }
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
