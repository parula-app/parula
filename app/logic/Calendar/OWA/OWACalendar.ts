import { ExchangeCalendar } from "../EWS/ExchangeCalendar";
import { CalendarShareCombinedPermissions } from "../Calendar";
import type { Participant } from "../Participant";
import { FreeBusyEvent } from "../FreeBusyEvent";
import type { Attachment } from "../../Abstract/Attachment";
import type { PersonUID } from "../../Abstract/PersonUID";
import { OWAEvent } from "./OWAEvent";
import { OWAIncomingInvitation } from "./OWAIncomingInvitation";
import { type OWAAccount, kMaxFetchCount } from "../../Mail/OWA/OWAAccount";
import { owaGetPermissionsRequest, owaSetCalendarPermissionsRequest } from "../../Mail/OWA/Request/OWAFolderRequests";
import { OWAGetUserAvailabilityRequest } from "./Request/OWAGetUserAvailabilityRequest";
import type { OWAEMail } from "../../Mail/OWA/OWAEMail";
import { owaFindEventsRequest, owaGetCalendarEventsRequest, owaGetEventsRequest } from "./Request/OWAEventRequests";
import { getSharedPersons, ExchangePermission, deleteExchangePermissions, setExchangePermissions } from "../../Mail/EWS/ExchangePermission";
import { RunOnce } from "../../util/flow/RunOnce";
import { Lock } from "../../util/flow/Lock";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert, ensureArray } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { ArrayColl } from "svelte-collections";

export class OWACalendar extends ExchangeCalendar {
  readonly protocol: string = "calendar-owa";
  declare readonly events: ArrayColl<OWAEvent>;
  /** Exchange FolderID for this calendar. Not DistinguishedFolderId */
  folderID: string;
  protected listEventsRunOnce = new RunOnce();
  protected readonly listEventsLock = new Lock();

  get account(): OWAAccount {
    assert(this.mainAccount, gt`Calendar ${this.name} lost the connection to its account`);
    return this.mainAccount as OWAAccount;
  }

  get isLoggedIn(): boolean {
    return this.account.isLoggedIn;
  }

  callOWA(aRequest: any) {
    return this.username == this.account.username
      ? this.account.callOWA(aRequest)
      : this.account.callOWA(aRequest, this.username);
  }

  callOWAWithOffice365Attachment(aRequest: any, attachment: Attachment) {
    return this.username == this.account.username
      ? this.account.callOWAWithOffice365Attachment(aRequest, attachment)
      : this.account.callOWAWithOffice365Attachment(aRequest, attachment, this.username);
  }

  newEvent(parentEvent?: OWAEvent): OWAEvent {
    return new OWAEvent(this, parentEvent);
  }

  getIncomingInvitationForEMail(message: OWAEMail) {
    return new OWAIncomingInvitation(this, message);
  }

  async arePersonsFree(participants: Participant[], from: Date, to: Date): Promise<{ participant: Participant, availability?: FreeBusyEvent[] }[]> {
    let results = await this.callOWA(new OWAGetUserAvailabilityRequest(participants, from, to));
    let availabilities = [];
    for (let [i, participant] of participants.entries()) {
      let result = results.Responses[i];
      let viewType = result.CalendarView?.FreeBusyViewType;
      if (result.ResponseMessage.ResponseClass == "Error" || !viewType || viewType == "None") {
        // Don't report unknown as Free
        availabilities.push({ participant, availability: undefined });
        continue;
      }
      // Without details, the subject is the status, e.g. "Busy"
      let hasDetails = viewType.startsWith("Detailed");
      availabilities.push({
        participant,
        availability: ensureArray(result.CalendarView.Items)
          .filter(event => this.freeBusyStatus(event.FreeBusyType))
          .map(event => {
            let appointment = new FreeBusyEvent(
              new Date(event.Start + "Z"),
              new Date(event.End + "Z"),
              this.freeBusyStatus(event.FreeBusyType));
            let details = hasDetails && event.Sensitivity != "Private" ? event : null;
            appointment.title = sanitize.label(details?.Subject, null);
            appointment.location = sanitize.label(details?.Location?.DisplayName, null);
            return appointment;
          }),
      });
    }
    return availabilities;
  }

  protected getEventByItemID(id: string): OWAEvent | undefined {
    return this.events.find(p => p.itemID == id);
  }

  protected async listEventsFromServer() {
    await this.listEventsRunOnce.runOnce(() => this.listEventsSlow());
  }

  async listEventsSlow() {
    let lock = await this.listEventsLock.lock();
    try {
      let events = new ArrayColl<OWAEvent>;
      await this.listFolder(events);
      for (let event of this.events.subtract(events).contents) { // copy: delete alters events
        // This might be a filled occurrence that has since been modified.
        await event.deleteLocally();
      }
      this.events.replaceAll(events);
    } finally {
      lock.release();
    }
  }

  protected async listFolder(events: ArrayColl<OWAEvent>) {
    let request = owaFindEventsRequest(this.folderID, kMaxFetchCount);
    let result: any = { RootFolder: { IncludesLastItemInRange: false } };
    while (result?.RootFolder?.IncludesLastItemInRange === false) {
      result = await this.callOWA(request);
      if (!result?.RootFolder?.Items?.length) {
        break;
      }
      request.Body.Paging.Offset = sanitize.integer(result.RootFolder.IndexedPagingOffset);
      let eventIDs: string[] = [];
      for (let item of result.RootFolder.Items) {
        let event = this.getEventByItemID(item.ItemId.Id);
        if (event?.lastMod.getTime() == sanitize.date(item.LastModifiedTime, null)?.getTime()) {
          // Our local event is up-to-date, so just add it directly to the results.
          events.add(event);
          events.addAll(event.exceptions);
        } else {
          // This is a new or updated event that we need to fetch.
          eventIDs.push(item.ItemId.Id);
        }
      }
      await this.getEvents(eventIDs, events);
    }
  }

  /** Fetches one event from the server and updates our local copy,
   * e.g. after Exchange processed an invitation */
  async getEventFromServerByID(itemID: string, parentEvent?: OWAEvent) {
    let lock = await this.listEventsLock.lock();
    try {
      await this.getEvents([itemID], new ArrayColl<OWAEvent>(), parentEvent);
    } finally {
      lock.release();
    }
  }

  protected async getEvents(eventIDs: string[], events: ArrayColl<OWAEvent>, parentEvent?: OWAEvent) {
    if (!eventIDs.length) {
      return;
    }
    let results = await this.callOWA(owaGetEventsRequest(eventIDs));
    let items = results.ResponseMessages ? this.account.itemsFromResponses(results.ResponseMessages.Items) : results.Items;
    let online = items.filter(item => item.IsOnlineMeeting);
    if (online.length) {
      let results = await this.callOWA(owaGetCalendarEventsRequest(online.map(item => item.ItemId.Id)));
      let items = results.ResponseMessages ? results.ResponseMessages.Items.map(item => item.Items?.[0]) : results.Items;
      for (let i = 0; i < items.length; i++) {
        online[i].OnlineMeetingJoinUrl = items[i]?.OnlineMeetingJoinUrl;
      }
    }
    for (let item of items) {
      try {
        let event = this.getEventByItemID(sanitize.nonemptystring(item.ItemId.Id));
        if (!event && parentEvent) {
          // `toLocalMidnight()`, because the master converted its own times, too
          event = parentEvent.getOccurrenceByDate(parentEvent.toLocalMidnight(sanitize.date(item.RecurrenceId))) as OWAEvent;
        }
        event ??= this.newEvent();
        event.fromJSON(item);
        await event.saveLocally();
        if (!this.events.contains(event)) {
          // Add it now, so that `getEventByItemID()` finds it when the server sends it again in a later page
          this.events.add(event);
        }
        events.add(event);
        if (item.ModifiedOccurrences?.length && event.recurrenceRule) {
          await this.getEvents(item.ModifiedOccurrences.map(item => item.ItemId.Id), events, event);
        }
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }
  }

  async getSharedPersons(): Promise<ArrayColl<PersonUID>> {
    let result = await this.account.callOWA(owaGetPermissionsRequest(this.folderID));
    return getSharedPersons(result.Folders[0].PermissionSet.CalendarPermissions, this.account.emailAddress);
  }

  async deleteSharedPerson(otherPerson: PersonUID) {
    await deleteExchangePermissions(this, otherPerson);
  }

  get sharePermissionLevels(): CalendarShareCombinedPermissions[] {
    return [CalendarShareCombinedPermissions.ReadAvailability, CalendarShareCombinedPermissions.ReadTitle,
      CalendarShareCombinedPermissions.ReadAll, CalendarShareCombinedPermissions.Modify];
  }

  async addSharedPerson(otherPerson: PersonUID, access: CalendarShareCombinedPermissions) {
    await setExchangePermissions(this, otherPerson, access);
  }

  async getPermissions(): Promise<ExchangePermission[]> {
    let result = await this.account.callOWA(owaGetPermissionsRequest(this.folderID));
    return result.Folders[0].PermissionSet.CalendarPermissions.map(permission => new ExchangePermission(permission));
  }

  async setPermissions(permissions: ExchangePermission[]) {
    await this.account.callOWA(owaSetCalendarPermissionsRequest(this.folderID, permissions));
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.folderID = sanitize.string(json.folderID, null);
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.folderID = this.folderID;
    return json;
  }
}
