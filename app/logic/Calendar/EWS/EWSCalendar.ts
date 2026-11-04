import { ExchangeCalendar } from "./ExchangeCalendar";
import { CalendarShareCombinedPermissions } from "../Calendar";
import type { Participant } from "../Participant";
import { FreeBusyEvent } from "../FreeBusyEvent";
import type { PersonUID } from "../../Abstract/PersonUID";
import { EWSEvent } from "./EWSEvent";
import { EWSIncomingInvitation } from "./EWSIncomingInvitation";
import type { EWSAccount, EWSSubscribable } from "../../Mail/EWS/EWSAccount";
import { ConnectionPurpose } from "../../Mail/EWS/ConnectionPurpose";
import { getSharedPersons, ExchangePermission, deleteExchangePermissions, setExchangePermissions } from "../../Mail/EWS/ExchangePermission";
import { EWSItemError } from "../../Mail/EWS/EWSError";
import type { EWSEMail } from "../../Mail/EWS/EWSEMail";
import { kMaxCount } from "../../Mail/EWS/EWSFolder";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert, ensureArray } from "../../util/util";
import { Lock } from "../../util/flow/Lock";
import { gt } from "../../../l10n/l10n";
import type { ArrayColl } from "svelte-collections";

export class EWSCalendar extends ExchangeCalendar implements EWSSubscribable {
  readonly protocol: string = "calendar-ews";
  declare readonly events: ArrayColl<EWSEvent>;
  /** Exchange FolderID for this calendar. Not DistinguishedFolderId */
  folderID: string;

  get account(): EWSAccount {
    assert(this.mainAccount, gt`Calendar ${this.name} lost the connection to its account`);
    return this.mainAccount as EWSAccount;
  }

  newEvent(parentEvent?: EWSEvent): EWSEvent {
    return new EWSEvent(this, parentEvent);
  }

  get isLoggedIn(): boolean {
    return this.account.isLoggedIn;
  }

  async disconnect(): Promise<void> {
    await this.account.unsubscribeNotifications(this);
  }

  async login(interactive: boolean): Promise<void> {
    await super.login(interactive);
    if (this.username != this.account.username) {
      // Folders of the main user are covered by its `SubscribeToAllFolders`
      await this.account.subscribeToNotificationsForSubaccount(this);
    }
  }

  getIncomingInvitationForEMail(message: EWSEMail) {
    return new EWSIncomingInvitation(this, message);
  }

  async arePersonsFree(participants: Participant[], from: Date, to: Date): Promise<{ participant: Participant, availability?: FreeBusyEvent[] }[]> {
    let request = {
      m$GetUserAvailabilityRequest: {
        m$MailboxDataArray: {
          t$MailboxData: participants.map(participant => ({
            t$Email: {
              t$Address: participant.emailAddress,
            },
            t$AttendeeType: "Required",
          })),
        },
        t$FreeBusyViewOptions: {
          t$TimeWindow: {
            t$StartTime: from.toISOString(),
            t$EndTime: to.toISOString(),
          },
          t$RequestedView: "Detailed",
        },
      },
    };
    let results = await this.account.callEWS(request);
    let availabilities = [];
    for (let [i, participant] of participants.entries()) {
      let result = results[i];
      if (result.ResponseMessage.ResponseClass == "Error" || !result.FreeBusyView || result.FreeBusyView.FreeBusyViewType == "None") {
        // Don't report unknown as Free
        availabilities.push({ participant, availability: undefined });
        continue;
      }
      availabilities.push({
        participant,
        availability: ensureArray(result.FreeBusyView.CalendarEventArray?.CalendarEvent)
          .filter(event => this.freeBusyStatus(event.BusyType))
          .map(event => {
            let appointment = new FreeBusyEvent(
              sanitize.date(sanitize.nonemptystring(event.StartTime) + "Z"),
              sanitize.date(sanitize.nonemptystring(event.EndTime) + "Z"),
              this.freeBusyStatus(event.BusyType));
            let details = sanitize.boolean(event.CalendarEventDetails?.IsPrivate, false) ? null : event.CalendarEventDetails;
            appointment.title = sanitize.label(details?.Subject, null);
            appointment.location = sanitize.label(details?.Location, null);
            return appointment;
          }),
      });
    }
    return availabilities;
  }

  protected async listEventsFromServer() {
    await this.syncFolder();
    await this.save();
  }

  protected readonly syncFolderLock = new Lock();

  protected async syncFolder(): Promise<void> {
    let lock = await this.syncFolderLock.lock();
    try {
      let sync = {
        m$SyncFolderItems: {
          m$ItemShape: {
            t$BaseShape: "IdOnly",
          },
          m$SyncFolderId: {
            t$FolderId: {
              Id: this.folderID,
            },
          },
          m$SyncState: this.syncState,
          m$MaxChangesReturned: kMaxCount,
        }
      };
      let result: any = { IncludesLastItemInRange: "false" };
      while (result.IncludesLastItemInRange === "false") {
        try {
          result = await this.account.callEWS(sync, ConnectionPurpose.Fetch);
        } catch (ex) {
          if (ex.error?.ResponseCode != 'ErrorInvalidSyncStateData') {
            throw ex;
          }
          sync.m$SyncFolderItems.m$SyncState = null;
          result = await this.account.callEWS(sync, ConnectionPurpose.Fetch);
        }
        let eventIDs: any[] = [];
        for (let changes of [result.Changes.Update, result.Changes.Create]) {
          if (changes) {
            for (let change of ensureArray(changes)) {
              if (change.CalendarItem) {
                eventIDs.push(change.CalendarItem.ItemId);
              }
              if (change.Task) {
                eventIDs.push(change.Task.ItemId);
              }
            }
          }
        }
        if (result.Changes.Delete) {
          for (let deletion of ensureArray(result.Changes.Delete)) {
            let event = this.getEventByItemID(sanitize.nonemptystring(deletion.ItemId.Id));
            if (event) {
              await event.deleteLocally();
            }
          }
        }
        await this.getEvents(eventIDs);
        this.syncState = sync.m$SyncFolderItems.m$SyncState = sanitize.nonemptystring(result.SyncState);
      }
    } finally {
      lock.release();
    }
  }

  getEventByItemID(id: string): EWSEvent | undefined {
    return this.events.find(p => p.itemID == id);
  }

  // Lists all events and tasks starting from scratch, ignoring the sync state.
  // If you don't want this, then clear the sync state and update changes.
  // Updates any events that have been loaded from the db.
  async listAllEvents() {
    let events: EWSEvent[] = [];
    await this.listFolder("calendar", events);
    /* Disabling tasks for now.
    await this.listFolder("tasks", events);
    */
    this.events.replaceAll(events);
  }

  async listFolder(folder: string, events: EWSEvent[]) {
    let request = {
      m$FindItem: {
        m$ItemShape: {
          t$BaseShape: "IdOnly",
        },
        m$IndexedPageItemView: {
          BasePoint: "Beginning",
          Offset: 0,
        },
        m$ParentFolderIds: {
          t$DistinguishedFolderId: [{
            Id: folder,
          }],
        },
        Traversal: "Shallow",
      },
    };
    let result: any = { RootFolder: { IncludesLastItemInRange: "false" } };
    while (result?.RootFolder?.IncludesLastItemInRange === "false") {
      result = await this.account.callEWS(request, ConnectionPurpose.Fetch);
      if (!result?.RootFolder?.Items) {
        break;
      }
      request.m$FindItem.m$IndexedPageItemView.Offset = sanitize.integer(result.RootFolder.IndexedPagingOffset);
      await this.getEvents(ensureArray(result.RootFolder.Items.CalendarItem || result.RootFolder.Items.Task).map(item => item.ItemId), events);
    }
  }

  async getEvents(eventIDs: { Id: string }[], events?: EWSEvent[], parentEvent?: EWSEvent) {
    if (!eventIDs.length) {
      return;
    }
    let request = {
      m$GetItem: {
        m$ItemShape: {
          t$BaseShape: "Default",
          t$BodyType: "Best",
          t$AdditionalProperties: {
            t$FieldURI: [{
              FieldURI: "item:Body",
            }, {
              FieldURI: "item:Attachments",
            }, {
              FieldURI: "item:ReminderIsSet",
            }, {
              FieldURI: "item:ReminderMinutesBeforeStart",
            }, {
              FieldURI: "item:LastModifiedTime",
            }, {
              FieldURI: "item:TextBody",
            }, {
              FieldURI: "calendar:StartTimeZoneId",
            }, {
              FieldURI: "calendar:IsAllDayEvent",
            }, {
              FieldURI: "calendar:IsCancelled",
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
            }, {
              FieldURI: "calendar:DateTimeStamp",
            }, {
              FieldURI: "task:Recurrence",
            }],
          },
        },
        m$ItemIds: {
          t$ItemId: eventIDs,
        },
      },
    };
    try {
      let results = ensureArray(await this.account.callEWS(request, ConnectionPurpose.Fetch));
      for (let result of results) {
        try {
          if (result.ResponseClass == "Error") {
            throw new EWSItemError(result, request);
          }
          let item = result.Items.CalendarItem || result.Items.Task;
          let event = this.getEventByItemID(sanitize.nonemptystring(item.ItemId.Id));
          if (event) {
            event.parentEvent = parentEvent; // should already be correct
            event.fromXML(item);
            await event.saveLocally();
          } else {
            if (parentEvent) {
              // `toLocalMidnight()`, because the master converted its own times, too
              event = parentEvent.getOccurrenceByDate(parentEvent.toLocalMidnight(sanitize.date(item.RecurrenceId))) as EWSEvent;
            }
            event ??= this.newEvent();
            event.fromXML(item);
            // For a modified occurrence, this already adds the event to `this.events`
            await event.saveLocally();
            if (!this.events.contains(event)) {
              // Add it now, so that `getEventByItemID()` finds it when the server sends it again in a later page
              this.events.add(event);
            }
          }
          events?.push(event);
          if (item.ModifiedOccurrences?.Occurrence && event.recurrenceRule) {
            await this.getEvents(ensureArray(item.ModifiedOccurrences.Occurrence).map(item => item.ItemId), events, event);
          }
        } catch (ex) {
          this.account.errorCallback(ex);
        }
      }
    } catch (ex) {
      this.account.errorCallback(ex);
    }
  }

  async getSharedPersons(): Promise<ArrayColl<PersonUID>> {
    let request = {
      m$GetFolder: {
        m$FolderShape: {
          t$BaseShape: "IdOnly",
          t$AdditionalProperties: {
            t$FieldURI: {
              FieldURI: "folder:PermissionSet",
            },
          },
        },
        m$FolderIds: {
          t$FolderId: {
            Id: this.folderID,
          },
        },
      },
    };
    let result = await this.account.callEWS(request);
    return getSharedPersons(ensureArray(result.Folders.CalendarFolder.PermissionSet.CalendarPermissions.CalendarPermission), this.account.emailAddress);
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
    let request = {
      m$GetFolder: {
        m$FolderShape: {
          t$BaseShape: "IdOnly",
          t$AdditionalProperties: {
            t$FieldURI: {
              FieldURI: "folder:PermissionSet",
            },
          },
        },
        m$FolderIds: {
          t$FolderId: {
            Id: this.folderID,
          },
        },
      },
    };
    let result = await this.account.callEWS(request);
    return ensureArray(result.Folders.CalendarFolder.PermissionSet.CalendarPermissions.CalendarPermission).map(permission => new ExchangePermission(permission));
  }

  async setPermissions(permissions: ExchangePermission[]) {
    let request = {
      m$UpdateFolder: {
        m$FolderChanges: {
          t$FolderChange: {
            t$FolderId: {
              Id: this.folderID,
            },
            t$Updates: {
              t$SetFolderField: {
                t$FieldURI: {
                  FieldURI: "folder:PermissionSet",
                },
                t$CalendarFolder: {
                  t$PermissionSet: {
                    t$CalendarPermissions: {
                      t$CalendarPermission: permissions.map(permission => permission.toEWSCalendarPermission()),
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    await this.account.callEWS(request);
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
