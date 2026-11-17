import { ExchangeEMail, type IconIndex, type EMailFlag } from "../EWS/ExchangeEMail";
import type { ActiveSyncFolder } from "./ActiveSyncFolder";
import { SpecialFolder } from "../Folder";
import { DeleteStrategy } from "../MailAccount";
import { ActiveSyncError } from "./ActiveSyncError";
import { ActiveSyncEvent } from "../../Calendar/ActiveSync/ActiveSyncEvent";
import { getTagByName } from "../../Abstract/Tag";
import { PersonUID, findOrCreatePersonUID } from "../../Abstract/PersonUID";
import { InvitationMessage  } from "../../Calendar/Invitation/InvitationStatus";
import { ensureArray, assert, NotSupported } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import type { ArrayColl } from "svelte-collections";
import { parseOneAddress, parseAddressList, type ParsedMailbox } from "email-addresses";

const ExchangeScheduling: Record<string, number> = {
  "IPM.Schedule.Meeting.Resp.Pos": InvitationMessage.ParticipantReply,
  "IPM.Schedule.Meeting.Resp.Tent": InvitationMessage.ParticipantReply,
  "IPM.Schedule.Meeting.Resp.Neg": InvitationMessage.ParticipantReply,
  "IPM.Schedule.Meeting.Request": InvitationMessage.Invitation,
  "IPM.Schedule.Meeting.Canceled": InvitationMessage.CancelledEvent,
};

export class ActiveSyncEMail extends ExchangeEMail {
  declare folder: ActiveSyncFolder;

  get serverID(): string | null {
    return this.pID as string | null;
  }
  set serverID(val: string | null) {
    assert(val == null || typeof (val) == "string", "ActiveSync EMail serverID must be a string");
    this.pID = val;
  }

  async download() {
    await this.downloadRunOnce.runOnce(async () => {
      let request = {
        Fetch: {
          Store: "Mailbox",
          ServerId: this.serverID,
          CollectionId: this.folder.id,
          Options: {
            MIMESupport: "2",
            BodyPreference: {
              Type: "4",
            },
          },
        },
      };
      let response = await this.folder.account.callEAS("ItemOperations", request);
      if (response.Response.Fetch.Status != "1") {
        throw new ActiveSyncError("ItemOperations", response.Response.Fetch.Status, this.folder?.account);
      }
      this.mime = response.Response.Fetch.Properties.Body.RawData;
      await this.parseMIME();
      await this.saveCompleteMessage();
    });
  }

  fromWBXML(wbxmljs: any) {
    this.subject = sanitize.nonemptystring(wbxmljs.Subject, "");
    this.size = sanitize.integer(wbxmljs.Body?.EstimatedDataSize, null); // without body
    this.received = sanitize.date(wbxmljs.DateReceived, new Date());
    this.sent = this.received; // ActiveSync only supports received date
    this.setFlags(wbxmljs);
    let from = (parseOneAddress(wbxmljs.From) || parseOneAddress(wbxmljs.Sender) || {}) as ParsedMailbox;
    this.from = findOrCreatePersonUID(
      sanitize.emailAddress(from.address, null),
      sanitize.nonemptylabel(from.name, null));
    this.outgoing = this.folder?.account.isMyEMailAddress(this.from.emailAddress);
    setPersons(this.to, wbxmljs.To);
    setPersons(this.cc, wbxmljs.Cc);
    setPersons(this.bcc, wbxmljs.Bcc);
    this.contact = this.outgoing ? this.to.first : this.from;
    this.invitationMessage = ExchangeScheduling[sanitize.string(wbxmljs.MessageClass, "")] || InvitationMessage.None;
    /* Can't use this data because the description is missing.
    if (wbxmljs.MeetingRequest) {
      let event = new ActiveSyncEvent();
      event.fromWBXML(wbxmljs.MeetingRequest);
      this.event = event;
    }
    */
  }

  /** A server-side Change contains only the changed properties,
   * so leave omitted properties unchanged. */
  setFlags(wbxmljs: any) {
    if (wbxmljs.Read != undefined) {
      let read = wbxmljs.Read != "0";
      if (this.isRead != read) {
        this.folder.countUnread += read ? -1 : 1;
      }
      this.isRead = read;
    }
    if (wbxmljs.Flag != undefined) {
      this.isStarred = wbxmljs.Flag?.Status == "2";
    }
    if (wbxmljs.Importance != undefined) {
      // Not `=`: The sender's `Importance:` header is not in the sync response
      this.isImportant ||= wbxmljs.Importance == "2";
    }
    if (wbxmljs.LastVerbExecuted != undefined) {
      // 1 = reply to sender, 2 = reply to all, 3 = forward
      this.isReplied = ["1", "2"].includes(wbxmljs.LastVerbExecuted);
      this.isForwarded = wbxmljs.LastVerbExecuted == "3";
    }
    if (this.folder.account.protocolVersion == "16.1" && wbxmljs.IsDraft != undefined) {
      this.isDraft = wbxmljs.IsDraft != "0";
    }
    if (wbxmljs.Categories != undefined) {
      this.tags.clear();
      this.tags.addAll(ensureArray(wbxmljs.Categories.Category).map(name => getTagByName(sanitize.string(name))));
    }
  }

  async markRead(read = true) {
    let data = {
      GetChanges: "0",
      Commands: {
        Change: {
          ServerId: this.serverID,
          ApplicationData: {
            Read: read ? "1" : "0",
          },
        },
      },
    };
    let response = await this.folder.makeSyncRequest(data);
    if (response.Responses) {
      throw new ActiveSyncError("Sync", response.Responses.Change.Status, this.folder?.account);
    }
    if (this.isRead != read) {
      this.folder.countUnread += read ? -1 : 1;
    }
    await super.markRead(read);
  }

  async markStarred(starred = true) {
    let data = {
      GetChanges: "0",
      Commands: {
        Change: {
          ServerId: this.serverID,
          ApplicationData: {
            Flag: starred ? { Status: "2", FlagType: "for Follow Up" } : {},
          },
        },
      },
    };
    let response = await this.folder.makeSyncRequest(data);
    if (response.Responses) {
      throw new ActiveSyncError("Sync", response.Responses.Change.Status, this.folder?.account);
    }
    await super.markStarred(starred);
  }

  //markSpam(spam = true) {
  //}

  /** The client cannot set this. The server sets it itself,
   * but only for mails that were sent using SmartReply and SmartForward. */
  protected async setFlagOnServer(verb: EMailFlag, icon: IconIndex) {
  }

  async markDraft(isDraft = true) {
    throw new NotSupported("Drafts are not supported by ActiveSync 14.1");
    // ActiveSync 16 apparently does let you create drafts.
    // And only drafts.
  }

  async deleteMessageOnServer(strategy = this.folder.account.deleteStrategy) {
    try {
      this.folder.deletions.add(this.serverID);
      let hardDelete = strategy == DeleteStrategy.DeleteImmediately ||
        [SpecialFolder.Trash, SpecialFolder.Spam].includes(this.folder.specialFolder);
      let data = {
        DeletesAsMoves: hardDelete ? "0" : "1",
        GetChanges: "0",
        Commands: {
          Delete: {
            ServerId: this.serverID,
          },
        },
      };
      let response = await this.folder.makeSyncRequest(data);
      if (response.Responses) {
        throw new ActiveSyncError("Sync", response.Responses.Delete.Status, this.folder?.account);
      }
      this.folder.countTotal--;
      if (!this.isRead) {
        this.folder.countUnread--;
      }
    } finally {
      this.folder.deletions.delete(this.serverID);
    }
  }

  async updateTags() {
    let data = {
      GetChanges: "0",
      Commands: {
        Change: {
          ServerId: this.serverID,
          ApplicationData: {
            Categories: {
              Category: this.tags.contents.map(tag => tag.name),
            },
          },
        },
      },
    };
    let response = await this.folder.makeSyncRequest(data);
    if (response.Responses) {
      throw new ActiveSyncError("Sync", response.Responses.Change.Status, this.folder?.account);
    }
  }

  /** ActiveSync only does not provide complete event data.
   * At least attendees are missing.
   * Disabled, but keeping the code, in case it will be useful later.
   *
   * `EMail.loadEvent()` works for all iTIP messages.
   * By not overriding `loadEvent()` here, `EMail.loadEvent()` will be called. */
  async loadEvent_disabled() {
    assert(this.invitationMessage, "This is not an invitation or response");
    assert(!this.event, "Event has already been loaded");
    let request = {
      Fetch: {
        Store: "Mailbox",
        ServerId: this.serverID,
        CollectionId: this.folder.id,
        Options: {
          BodyPreference: {
            Type: "2",
          },
        },
      },
    };
    let result = await this.folder.account.callEAS("ItemOperations", request);
    if (result.Response.Fetch.Status != "1") {
      throw new ActiveSyncError("ItemOperations", result.Response.Fetch.Status, this.folder?.account);
    }
    let event = new ActiveSyncEvent();
    // When fetching an invitation or response, ActiveSync splits up the
    // calendar-specific properties, so we need to merge them again.
    event.fromWBXML({ ...result.Response.Fetch.Properties.MeetingRequest, ...result.Response.Fetch.Properties });
    // ActiveSync only tells us the organiser, not the full list of attendees
    setPersons(event.participants, result.Response.Fetch.Properties.MeetingRequest.Organizer);
    this.event = event;
  }
}

function setPersons(targetList: ArrayColl<PersonUID>, addresses: string): void {
  let list = parseAddressList(addresses) as ParsedMailbox[];
  if (!list) {
    return;
  }
  targetList.replaceAll(list.map(mailbox => findOrCreatePersonUID(
    sanitize.emailAddress(mailbox.address, null),
    sanitize.label(mailbox.name, null))));
}
