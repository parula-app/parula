import { EWSCalendarShortcut } from "../EWS/EWSCalendarShortcut";
import type { OWACalendar } from "./OWACalendar";
import type { OWAAccount } from "../../Mail/OWA/OWAAccount";
import { owaGetFolderRequest, owaSharedFolderRequest } from "../../Mail/OWA/Request/OWAFolderRequests";
import { owaResolveNamesRequest } from "../../Contacts/OWA/Request/OWAPersonRequests";
import { PersonUID } from "../../Abstract/PersonUID";
import { ensureArray } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

export class OWACalendarShortcut {
  readonly account: OWAAccount;
  readonly ownerEmailAddress: string | null;
  readonly sharedFolderID: string | null;

  /** @param entry as returned by `GetCalendarFolders` in `listCalendars()` */
  constructor(account: OWAAccount, entry: any) {
    this.account = account;
    this.ownerEmailAddress = entry?.IsOwnerEmailAddressInvalid
      ? null
      : sanitize.emailAddress(entry?.OwnerEmailAddress, null);
    this.sharedFolderID = sanitize.nonemptystring(entry?.SharedFolderId?.Id, null);
  }

  static async listCalendars(account: OWAAccount): Promise<OWACalendar[]> {
    let response = await account.callOWA(new OWAGetCalendarFoldersRequest());
    let entries = ensureArray(response?.CalendarGroups).flatMap(group => ensureArray(group?.Calendars));
    let calendars: OWACalendar[] = [];
    for (let entry of entries) {
      let shortcut = new OWACalendarShortcut(account, entry);
      if (!shortcut.isCalendarOfOtherUser) {
        continue;
      }
      try {
        let calendar = await shortcut.createCalendar();
        if (calendar && !calendars.some(other => other.folderID == calendar.folderID)) {
          calendars.push(calendar);
        }
      } catch (ex) {
        if (!EWSCalendarShortcut.isStaleError(ex)) {
          account.dataError(ex);
        }
      }
    }
    return calendars;
  }

  get isCalendarOfOtherUser(): boolean {
    return !!this.ownerEmailAddress && !this.account.isMyEMailAddress(this.ownerEmailAddress);
  }

  async createCalendar(): Promise<OWACalendar | null> {
    let request = this.sharedFolderID
      ? owaGetFolderRequest(this.sharedFolderID)
      : owaSharedFolderRequest(["calendar"], this.ownerEmailAddress);
    let result = await this.account.callOWA(request);
    let folder = result.Folders?.[0];
    if (folder?.FolderClass != "IPF.Appointment") {
      return null;
    }
    let owner = await this.resolveOwner();
    return this.account.createCalendarAccount(folder, {
      name: owner.nameOrEMail,
      username: owner.emailAddress,
      color: this.account.colorForSharedAccount(owner),
    });
  }

  protected async resolveOwner(): Promise<PersonUID> {
    try {
      let response = await this.account.callOWA(owaResolveNamesRequest("smtp:" + this.ownerEmailAddress));
      let resolution = ensureArray(response.ResolutionSet).find(candidate =>
        candidate?.Mailbox?.EmailAddress?.toLowerCase() == this.ownerEmailAddress);
      return new PersonUID(this.ownerEmailAddress, sanitize.nonemptylabel(resolution?.Mailbox?.Name, null) ?? undefined);
    } catch (ex) {
      if (ex.type != "ErrorNameResolutionNoResults") {
        throw ex;
      }
      return new PersonUID(this.ownerEmailAddress);
    }
  }
}

class OWAGetCalendarFoldersRequest {
  get action() {
    return "GetCalendarFolders";
  }
}
