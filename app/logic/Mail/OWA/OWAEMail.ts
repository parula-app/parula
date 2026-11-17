import { ExchangeEMail, type EMailFlag, EMailFlagPidTag, EMailFlagTimePidTag, type IconIndex, IconIndexPidTag } from "../EWS/ExchangeEMail";
import type { OWAFolder } from "./OWAFolder";
import { SpecialFolder } from "../Folder";
import { DeleteStrategy } from "../MailAccount";
import { OWAEvent } from "../../Calendar/OWA/OWAEvent";
import { getTagByName } from "../../Abstract/Tag";
import { OWARequest } from "./Request/OWARequest";
import { OWADeleteItemRequest } from "./Request/OWADeleteItemRequest";
import { OWAUpdateItemRequest } from "./Request/OWAUpdateItemRequest";
import { owaDownloadMsgsRequest } from "./Request/OWAFolderRequests";
import { owaGetEventsRequest } from "../../Calendar/OWA/Request/OWAEventRequests";
import { PersonUID, findOrCreatePersonUID, kDummyPerson } from "../../Abstract/PersonUID";
import { InvitationMessage } from "../../Calendar/Invitation/InvitationStatus";
import { assert, ensureArray } from "../../util/util";
import { base64ToUint8Array } from "../../util/blob";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import type { ArrayColl } from "svelte-collections";

export class OWAEMail extends ExchangeEMail {
  declare folder: OWAFolder;

  get itemID(): string | null {
    return this.pID as string | null;
  }
  set itemID(val: string | null) {
    assert(val == null || typeof (val) == "string", "OWA EMail itemID must be a string");
    this.pID = val;
  }

  async download() {
    await this.downloadRunOnce.runOnce(async () => {
      let result = await this.folder.account.callOWA(owaDownloadMsgsRequest([ this ]));
      let mimeBase64 = sanitize.nonemptystring(result.Items[0].MimeContent.Value);
      this.mime = base64ToUint8Array(mimeBase64);
      await this.parseMIME();
      await this.saveCompleteMessage();
    });
  }

  fromJSON(json: Record<string, any>) {
    this.itemID = sanitize.nonemptystring(json.ItemId.Id);
    this.id = sanitize.nonemptystring(json.InternetMessageId, "");
    this.subject = sanitize.nonemptystring(json.Subject, "");
    this.size = sanitize.integer(json.Size, null);
    this.sent = sanitize.date(json.DateTimeSent, new Date());
    this.received = sanitize.date(json.DateTimeReceived, new Date());
    this.setFlags(json);
    this.inReplyTo = sanitize.nonemptystring(json.InReplyTo, null);
    this.references = sanitize.nonemptystring(json.References, null)?.split(" ");
    /*if ("ReplyTo" in json) {
      this.replyTo = findOrCreatePersonUID(
        sanitize.emailAddress(json.ReplyTo.Mailbox.EmailAddress, null),
        sanitize.nonemptylabel(json.ReplyTo.Mailbox.Name, null));
    }*/
    if ("From" in json) {
      this.from = findOrCreatePersonUID(
        sanitize.emailAddress(json.From.Mailbox.EmailAddress, null),
        sanitize.nonemptylabel(json.From.Mailbox.Name, null));
    } else if ("Sender" in json) {
      this.from = findOrCreatePersonUID(
        sanitize.emailAddress(json.Sender.Mailbox.EmailAddress, null),
        sanitize.nonemptylabel(json.Sender.Mailbox.Name, null));
    } else {
      this.from = kDummyPerson;
    }
    this.outgoing = this.folder?.account.isMyEMailAddress(this.from?.emailAddress);
    setPersons(this.to, json.ToRecipients);
    setPersons(this.cc, json.CcRecipients);
    setPersons(this.bcc, json.BccRecipients);
    this.contact = this.outgoing ? this.to.first : this.from;
    this.invitationMessage = ExchangeScheduling[sanitize.string(json.ItemClass)] || InvitationMessage.None;
  }

  setFlags(json: Record<string, any>) {
    this.isRead = sanitize.boolean(json.IsRead);
    // don't know how to get new, replied or forwarded status
    // Not `=`: The sender's `Importance:` header is not in the response
    this.isImportant ||= json.Importance == "High";
    this.isStarred = json.Flag?.FlagStatus == "Flagged";
    // can't work out how to find junk status
    this.isDraft = sanitize.boolean(json.IsDraft);
    this.tags.replaceAll(ensureArray(json.Categories).map(name => getTagByName(sanitize.string(name))));
  }

  async markRead(read = true) {
    let request = new OWAUpdateItemRequest(this.itemID, {
      MessageDisposition: "SaveOnly",
      SendCalendarInvitationsOrCancellations: "SendToNone",
      SuppressReadReceipts: true,
    });
    request.addField("Message", "IsRead", read, "message:IsRead");
    try {
      await this.folder.account.callOWA(request);
    } catch (ex) {
      if (ex.type == "ErrorItemNotFound") { // it is gone on the server
        await this.deleteMessageLocally();
        return;
      }
      throw ex;
    }
    await super.markRead(read);
  }

  async markStarred(starred = true) {
    let request = new OWAUpdateItemRequest(this.itemID, {
      MessageDisposition: "SaveOnly",
      SendCalendarInvitationsOrCancellations: "SendToNone",
      SuppressReadReceipts: true,
    });
    request.addField("Message", "Flag", {
      __type: "FlagType:#Exchange",
      CompleteDate: null,
      DueDate: null,
      StartDate: null,
      FlagStatus: starred ? "Flagged" : "NotFlagged",
    }, "item:Flag");
    await this.folder.account.callOWA(request);
    await super.markStarred(starred);
  }

  /*async markSpam(spam = true) {
    let request = new OWARequest("MarkAsJunk", {
      __type: "MarkAsJunkRequest:#Exchange",
      IsJunk: spam,
      MoveItem: false,
      ItemIds: [{
        __type: "ItemId:#Exchange",
        Id: this.itemID,
      }],
    });
    await this.folder.account.callOWA(request);
    await super.markSpam(spam);
  }*/

  async markImportant(isImportant = true) {
    let request = new OWAUpdateItemRequest(this.itemID, {
      MessageDisposition: "SaveOnly",
      SendCalendarInvitationsOrCancellations: "SendToNone",
      SuppressReadReceipts: true,
    });
    request.addField("Message", "Importance", isImportant ? "High" : "Normal", "item:Importance");
    await this.folder.account.callOWA(request);
    await super.markImportant(isImportant);
  }

  protected async setFlagOnServer(verb: EMailFlag, icon: IconIndex) {
    let request = new OWAUpdateItemRequest(this.itemID, {
      MessageDisposition: "SaveOnly",
      SendCalendarInvitationsOrCancellations: "SendToNone",
      SuppressReadReceipts: true,
    });
    request.addExtendedField("Message", EMailFlagPidTag, "Integer", verb);
    request.addExtendedField("Message", EMailFlagTimePidTag, "SystemTime", new Date().toISOString());
    request.addExtendedField("Message", IconIndexPidTag, "Integer", icon);
    await this.folder.account.callOWA(request);
  }

  async markDraft(isDraft = true) {
    await super.markDraft(isDraft);
    let request = new OWAUpdateItemRequest(this.itemID, {
      MessageDisposition: "SaveOnly",
      SendCalendarInvitationsOrCancellations: "SendToNone",
      SuppressReadReceipts: true,
    });
    request.addField("Message", "IsDraft", isDraft, "message:IsDraft");
    await this.folder.account.callOWA(request);
  }

  async deleteMessageOnServer(strategy = this.folder.account.deleteStrategy) {
    try {
      this.folder.deletions.add(this.itemID);
      let hardDelete = strategy == DeleteStrategy.DeleteImmediately ||
        [SpecialFolder.Trash, SpecialFolder.Spam].includes(this.folder.specialFolder);
      let request = new OWADeleteItemRequest(this.itemID, {
        DeleteType: hardDelete ? "HardDelete" : "MoveToDeletedItems",
        SuppressReadReceipts: true,
        // Otherwise server refuses to delete calendar and tasks, and they can be any mail
        SendMeetingCancellations: "SendToNone",
        AffectedTaskOccurrences: "AllOccurrences",
      });
      await this.folder.account.callOWA(request);
    } finally {
      this.folder.deletions.delete(this.itemID);
    }
  }

  async updateTags() {
    let request = new OWAUpdateItemRequest(this.itemID, {
      MessageDisposition: "SaveOnly",
      SendCalendarInvitationsOrCancellations: "SendToNone",
      SuppressReadReceipts: true,
    });
    request.addField("Message", "Categories", this.tags.contents.map(tag => tag.name), "Categories");
    await this.folder.account.callOWA(request);
  }

  /** OWA only provides event data for invitations,
   * but not responses to invitations.
   * Disabled, but keeping the code, in case it will be useful later.
   *
   * `EMail.loadEvent()` works for all iTIP messages.
   * By not overriding `loadEvent()` here, `EMail.loadEvent()` will be called. */
  async loadEvent_disabled() {
    assert(this.invitationMessage == InvitationMessage.Invitation, "This is not an invitation");
    assert(!this.event, "Event has already been loaded");
    let result = await this.folder.account.callOWA(owaGetEventsRequest([ this.itemID ]));
    let event = new OWAEvent();
    event.fromJSON(result.Items[0]);
    this.event = event;
  }
}


const ExchangeScheduling: Record<string, number> = {
  "IPM.Schedule.Meeting.Resp.Pos": InvitationMessage.ParticipantReply,
  "IPM.Schedule.Meeting.Resp.Tent": InvitationMessage.ParticipantReply,
  "IPM.Schedule.Meeting.Resp.Neg": InvitationMessage.ParticipantReply,
  "IPM.Schedule.Meeting.Request": InvitationMessage.Invitation,
  "IPM.Schedule.Meeting.Canceled": InvitationMessage.CancelledEvent,
};

function setPersons(targetList: ArrayColl<PersonUID>, mailboxes?: { EmailAddress: string, Name: string }[]): void {
  if (!mailboxes) {
    return;
  }
  targetList.replaceAll(mailboxes.map(mailbox => findOrCreatePersonUID(
    sanitize.emailAddress(mailbox.EmailAddress, null),
    sanitize.nonemptylabel(mailbox.Name, null))));
}
