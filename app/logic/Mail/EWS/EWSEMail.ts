import { ExchangeEMail, EMailFlag, EMailFlagPidTag, EMailFlagTimePidTag, IconIndex, IconIndexPidTag } from "./ExchangeEMail";
import { type EWSFolder, getEWSItem } from "./EWSFolder";
import { SpecialFolder } from "../Folder";
import { DeleteStrategy } from "../MailAccount";
import { EWSEvent } from "../../Calendar/EWS/EWSEvent";
import { getTagByName } from "../../Abstract/Tag";
import { ContentDisposition } from "../../Abstract/Attachment";
import { EWSDeleteItemRequest } from "./Request/EWSDeleteItemRequest";
import { EWSUpdateItemRequest } from "./Request/EWSUpdateItemRequest";
import { PersonUID, findOrCreatePersonUID, kDummyPerson } from "../../Abstract/PersonUID";
import { InvitationMessage } from "../../Calendar/Invitation/InvitationStatus";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert, ensureArray } from "../../util/util";
import { base64ToUint8Array } from "../../util/blob";
import type { ArrayColl } from "svelte-collections";

const ExchangeScheduling: Record<string, number> = {
  "IPM.Schedule.Meeting.Resp.Pos": InvitationMessage.ParticipantReply,
  "IPM.Schedule.Meeting.Resp.Tent": InvitationMessage.ParticipantReply,
  "IPM.Schedule.Meeting.Resp.Neg": InvitationMessage.ParticipantReply,
  "IPM.Schedule.Meeting.Request": InvitationMessage.Invitation,
  "IPM.Schedule.Meeting.Canceled": InvitationMessage.CancelledEvent,
};

export class EWSEMail extends ExchangeEMail {
  declare folder: EWSFolder;

  get itemID(): string | null {
    return this.pID as string | null;
  }
  set itemID(val: string | null) {
    assert(val == null || typeof (val) == "string", "EWS EMail itemID must be a string");
    this.pID = val;
  }

  async download() {
    await this.downloadRunOnce.runOnce(async () => {
      let request = {
        m$GetItem: {
          m$ItemShape: {
            t$BaseShape: "IdOnly",
            t$IncludeMimeContent: true,
          },
          m$ItemIds: {
            t$ItemId: {
              Id: this.itemID,
            },
          },
        },
      };
      let result = await this.folder.account.callEWS(request);
      let mimeBase64 = sanitize.nonemptystring(getEWSItem(result.Items).MimeContent.Value);
      this.mime = base64ToUint8Array(mimeBase64);
      await this.parseMIME();
      await this.saveCompleteMessage();
    });
  }

  fromXML(xmljs: Record<string, any>) {
    this.itemID = sanitize.nonemptystring(xmljs.ItemId.Id);
    this.id = sanitize.nonemptystring(xmljs.InternetMessageId, "");
    this.subject = sanitize.nonemptystring(xmljs.Subject, "");
    this.size = sanitize.integer(xmljs.Size, null);
    this.sent = sanitize.date(xmljs.DateTimeSent, new Date());
    this.received = sanitize.date(xmljs.DateTimeReceived, new Date());
    this.setFlags(xmljs);
    this.inReplyTo = sanitize.nonemptystring(xmljs.InReplyTo, null);
    this.references = sanitize.nonemptystring(xmljs.References, null)?.split(" ");
    if ("ReplyTo" in xmljs) {
      this.replyTo = findOrCreatePersonUID(
        getEmailAddressOrX400(xmljs.ReplyTo.Mailbox.EmailAddress),
        sanitize.nonemptylabel(xmljs.ReplyTo.Mailbox.Name, null));
    }
    if ("From" in xmljs) {
      this.from = findOrCreatePersonUID(
        getEmailAddressOrX400(xmljs.From.Mailbox.EmailAddress),
        sanitize.nonemptylabel(xmljs.From.Mailbox.Name, null));
    } else if ("Sender" in xmljs) {
      this.from = findOrCreatePersonUID(
        getEmailAddressOrX400(xmljs.Sender.Mailbox.EmailAddress),
        sanitize.nonemptylabel(xmljs.Sender.Mailbox.Name, null));
    } else {
      this.from = kDummyPerson;
    }
    this.outgoing = this.folder?.account.isMyEMailAddress(this.from?.emailAddress);
    setPersons(this.to, xmljs.ToRecipients?.Mailbox);
    setPersons(this.cc, xmljs.CcRecipients?.Mailbox);
    setPersons(this.bcc, xmljs.BccRecipients?.Mailbox);
    this.contact = this.outgoing ? this.to.first : this.from;
    this.invitationMessage = ExchangeScheduling[sanitize.string(xmljs.ItemClass, null)] || InvitationMessage.None;
  }

  /** Get body and attachments from Exchange.
   * This is an alternative to parsing MIME.
   * @see EWSFolder GetItem server call. */
  bodyAndAttachmentsFromXML(xmljs: Record<string, any>) {
    assert(this.itemID == xmljs.ItemId.Id, "EWS EMail ItemID doesn't match");
    if (xmljs.Body?.BodyType == "Text") {
      this.text = sanitize.nonemptystring(xmljs.Body.Value, "");
    } else {
      this.text = sanitize.nonemptystring(xmljs.TextBody?.Value, "");
      if (xmljs.Body?.BodyType == "HTML") {
        this.html = sanitize.nonemptystring(xmljs.Body.Value, "");
      }
    }
    if (xmljs.Attachments?.FileAttachment) {
      let attachments = ensureArray(xmljs.Attachments.FileAttachment);
      this.attachments.replaceAll(attachments.map(a => {
        let attachment = this.newAttachment();
        attachment.filename = sanitize.filename(a.Name);
        attachment.mimeType = sanitize.nonemptystring(a.ContentType);
        attachment.disposition = a.IsInline == "true" ? ContentDisposition.inline : ContentDisposition.attachment;
        if (a.ContentId) {
          attachment.contentID = sanitize.nonemptystring(a.ContentId);
        }
        attachment.size = sanitize.integer(a.Size, null);
        return attachment;
      }));
    }
  }

  setFlags(xmljs: Record<string, any>) {
    this.isRead = sanitize.boolean(xmljs.IsRead);
    // this.isNewArrived = xmljs.ExtendedProperty?.Value == -1; // We requested signed Integer, but @see EWSFolder
    this.isReplied = xmljs.ExtendedProperty?.Value == IconIndex.Replied;
    this.isForwarded = xmljs.ExtendedProperty?.Value == IconIndex.Forwarded;
    // Not `=`: The sender's `Importance:` header is not in the sync response
    this.isImportant ||= xmljs.Importance == "High";
    this.isStarred = xmljs.Flag?.FlagStatus == "Flagged";
    // can't work out how to find junk status
    this.isDraft = sanitize.boolean(xmljs.IsDraft, false);
    this.tags.replaceAll(ensureArray(xmljs.Categories?.String).map(name => getTagByName(sanitize.string(name))));
  }

  async markRead(read = true) {
    let request = new EWSUpdateItemRequest(this.itemID, {
      MessageDisposition: "SaveOnly",
      SendMeetingInvitationsOrCancellations: "SendToNone",
      SuppressReadReceipts: true,
    });
    request.addField("Message", "IsRead", read, "message:IsRead");
    try {
      await this.folder.account.callEWS(request);
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
    let request = new EWSUpdateItemRequest(this.itemID, {
      MessageDisposition: "SaveOnly",
      SendMeetingInvitationsOrCancellations: "SendToNone",
      SuppressReadReceipts: true,
    });
    request.addField("Message", "Flag", {
      t$FlagStatus: starred ? "Flagged" : "NotFlagged",
      t$StartDate: null,
      t$DueDate: null,
      t$CompleteDate: null,
    }, "item:Flag");
    await this.folder.account.callEWS(request);
    await super.markStarred(starred);
  }

  async markSpam(spam = true) {
    if (!spam && this.folder.specialFolder != SpecialFolder.Spam) {
      // For Office365, "is Junk" == "is in Junk folder", so it attempts to move
      await super.markSpam(spam);
      return;
    }
    let request = {
      m$MarkAsJunk: {
        IsJunk: spam,
        MoveItem: false,
        m$ItemIds: {
          t$ItemId: {
            Id: this.itemID,
          },
        },
      },
    };
    await this.folder.account.callEWS(request);
    await super.markSpam(spam);
  }

  async markImportant(isImportant = true) {
    let request = new EWSUpdateItemRequest(this.itemID, {
      MessageDisposition: "SaveOnly",
      SendMeetingInvitationsOrCancellations: "SendToNone",
      SuppressReadReceipts: true,
    });
    request.addField("Message", "Importance", isImportant ? "High" : "Normal", "item:Importance");
    await this.folder.account.callEWS(request);
    await super.markImportant(isImportant);
  }

  protected async setFlagOnServer(verb: EMailFlag, icon: IconIndex) {
    let request = new EWSUpdateItemRequest(this.itemID, {
      MessageDisposition: "SaveOnly",
      SendMeetingInvitationsOrCancellations: "SendToNone",
      SuppressReadReceipts: true,
    });
    request.addExtendedField("Message", EMailFlagPidTag, "Integer", verb);
    request.addExtendedField("Message", EMailFlagTimePidTag, "SystemTime", new Date().toISOString());
    request.addExtendedField("Message", IconIndexPidTag, "Integer", icon);
    await this.folder.account.callEWS(request);
  }

  async markDraft(isDraft = true) {
    await super.markDraft(isDraft);
    let request = new EWSUpdateItemRequest(this.itemID, {
      MessageDisposition: "SaveOnly",
      SendMeetingInvitationsOrCancellations: "SendToNone",
      SuppressReadReceipts: true,
    });
    request.addField("Message", "IsDraft", isDraft, "message:IsDraft");
    await this.folder.account.callEWS(request);
  }

  async deleteMessageOnServer(strategy = this.folder.account.deleteStrategy) {
    try {
      this.folder.deletions.add(this.itemID);
      let hardDelete = strategy == DeleteStrategy.DeleteImmediately ||
        [SpecialFolder.Trash, SpecialFolder.Spam].includes(this.folder.specialFolder);
      let request = new EWSDeleteItemRequest(this.itemID, {
        DeleteType: hardDelete ? "HardDelete" : "MoveToDeletedItems",
        SuppressReadReceipts: true,
        // Otherwise server refuses to delete calendar and tasks, and they can be any mail
        SendMeetingCancellations: "SendToNone",
        AffectedTaskOccurrences: "AllOccurrences",
      });
      await this.folder.account.callEWS(request);
    } finally {
      this.folder.deletions.delete(this.itemID);
    }
  }

  async updateTags() {
    let request = new EWSUpdateItemRequest(this.itemID, {
      MessageDisposition: "SaveOnly",
      SendMeetingInvitationsOrCancellations: "SendToNone",
      SuppressReadReceipts: true,
    });
    request.addField("Message", "Categories", this.tags.hasItems ? { t$String: this.tags.contents.map(tag => tag.name) } : null, "item:Categories");
    await this.folder.account.callEWS(request);
  }

  /** EWS only provides event data for invitations,
   * but not responses to invitations.
   * Disabled, but keeping the code, in case it will be useful later.
   *
   * `EMail.loadEvent()` works for all iTIP messages.
   * By not overriding `loadEvent()` here, `EMail.loadEvent()` will be called. */
  async loadEvent_disabled() {
    assert(this.invitationMessage == InvitationMessage.Invitation, "This is not an invitation");
    assert(!this.event, "Event has already been loaded");
    let request = {
      m$GetItem: {
        m$ItemShape: {
          t$BaseShape: "Default",
          t$BodyType: "Best",
          t$AdditionalProperties: {
            t$FieldURI: [{
              FieldURI: "item:Body",
            }, {
              FieldURI: "item:ReminderIsSet",
            }, {
              FieldURI: "item:ReminderMinutesBeforeStart",
            }, {
              FieldURI: "item:LastModifiedTime",
            }, {
              FieldURI: "item:TextBody",
            }, {
              FieldURI: "calendar:IsAllDayEvent",
            }, {
              FieldURI: "calendar:MyResponseType",
            }, {
              FieldURI: "calendar:RequiredAttendees",
            }, {
              FieldURI: "calendar:OptionalAttendees",
            }, {
              FieldURI: "calendar:Recurrence",
            }, {
              FieldURI: "calendar:ModifiedOccurrences",
            }, {
              FieldURI: "calendar:DeletedOccurrences",
            }, {
              FieldURI: "calendar:UID",
            }, {
              FieldURI: "calendar:RecurrenceId",
            }],
          },
        },
        m$ItemIds: {
          t$ItemId: {
            Id: this.itemID,
          },
        },
      },
    };
    let result = await this.folder.account.callEWS(request);
    let event = new EWSEvent();
    event.fromXML(getEWSItem(result.Items));
    this.event = event;
  }
}

function setPersons(targetList: ArrayColl<PersonUID>, mailboxes: any): void {
  if (!mailboxes) {
    return;
  }
  targetList.replaceAll(ensureArray(mailboxes).map(mailbox => findOrCreatePersonUID(
    getEmailAddressOrX400(mailbox.EmailAddress),
    sanitize.nonemptylabel(mailbox.Name, null))));
}

/**
 * Converts X.400 into pseudo email addresses.
 * Alternative to sanitize.emailAddress()
 * @param emailAddress email address or X.400 address.
 *   May be missing, e.g. for a distribution list member that the server
 *   returns with a `Name`, but no `EmailAddress`.
 * @returns email address, or `null` when missing or not valid
 */
export function getEmailAddressOrX400(emailAddress: string | null | undefined): string | null {
  emailAddress = sanitize.string(emailAddress, "");
  if (emailAddress.startsWith("/o=") || emailAddress.startsWith("/O=")) {
    return convertX400ToEmailAddress(emailAddress);
  }
  return sanitize.emailAddress(emailAddress, null);
}

/**
 * Converts X.400 into pseudo email addresses.
 *
 * This is just as a fail-safe. When we download the MIME and parse it,
 * we should be getting the real Internet email addresses anyways.
 *
 * @param x400 X.400 address
 * @returns pseudo email address
 */
export function convertX400ToEmailAddress(x400: string): string {
  let parts = x400.toLowerCase().split("/");
  let username = "user";
  let domain = "xfourhundred";
  for (let part of parts) {
    if (!part) {
      continue;
    }
    if (part.startsWith("ou=")) { // Must be before `o=`, given they share the prefix
      part = part.substring(3);
      const prefix = "exchange administrative group (";
      const suffix = ")";
      if (part.startsWith(prefix) && part.endsWith(suffix)) {
        part = part.substring(prefix.length, part.length - suffix.length);
      }
      let department = ensureAlphaNum(part);
      domain = department + "." + domain;
    } else if (part.startsWith("o=")) {
      part = part.substring(2);
      let company = ensureAlphaNum(part);
      domain = company + "." + domain;
    } else if (part.startsWith("cn=recipient")) {
      continue;
    } else if (part.startsWith("cn=")) {
      part = part.substring(3);
      username = ensureAlphaNum(part);
    }
  }
  return sanitize.emailAddress(username + "@" + domain, null);
}

function ensureAlphaNum(str: string): string {
  return str.replace(/[^a-zA-Z0-9\-]/g, "");
}
