import { Calendar, CalendarShareCombinedPermissions } from "../Calendar";
import type { Event } from "../Event";
import { JMAPEvent } from "./JMAPEvent";
import type { TJMAPCalendar, TJMAPCalendarRights } from "./TJMAPCalendar";
import type { TJMAPCalendarEvent } from "./TJSCalendar";
import type { JMAPAccount } from "../../Mail/JMAP/JMAPAccount";
import type { TID, TJMAPChangeResponse, TJMAPGetResponse, TJMAPQueryResponse } from "../../Mail/JMAP/TJMAPGeneric";
import type { Participant } from "../Participant";
import type { FreeBusyEvent } from "../FreeBusyEvent";
import type { PersonUID } from "../../Abstract/PersonUID";
import { checkChangeError } from "../../Mail/JMAP/JMAPError";
import { retryOnTransientError } from "../../util/netUtil";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { ArrayColl, Collection, SetColl } from "svelte-collections";

export class JMAPCalendar extends Calendar {
  readonly protocol: string = "calendar-jmap";
  declare readonly events: ArrayColl<JMAPEvent>;
  readonly deletions = new Set<string>();
  /** ID in JMAP (because `.id` is the ID our database) */
  jmapID: TID;
  /** Primary calendar for this account */
  isDefault = false;
  /** isSubscribed - if false, the user doesn't want to see it in the UI */
  shouldShow = true;

  get account(): JMAPAccount {
    assert(this.mainAccount, gt`Calendar ${this.name} lost the connection to its account`);
    return this.mainAccount as JMAPAccount;
  }

  newEvent(parentEvent?: JMAPEvent): JMAPEvent {
    return new JMAPEvent(this, parentEvent);
  }

  fromJMAP(jmap: TJMAPCalendar) {
    this.jmapID = sanitize.nonemptystring(jmap.id);
    this.isDefault = sanitize.boolean(jmap.isDefault, false);
    this.shouldShow = sanitize.boolean(jmap.isSubscribed, true);
    if (!this.name || !this.isDefault) { // Default calendar name = account name, as set by `initFromMainAccount()`
      this.name = sanitize.nonemptystring(jmap.name);
    }
  }

  async arePersonsFree(participants: Participant[], from: Date, to: Date): Promise<{ participant: Participant, availability?: FreeBusyEvent[] }[]> {
    return [];
  }

  protected async listEventsFromServer() {
    await this.account.ensureLoggedIn();

    this.syncState
      ? await this.listChangedEvents()
      : await this.listAllEvents();
  }

  protected async listAllEvents(): Promise<ArrayColl<JMAPEvent>> {
    const batchSize = 200;
    let state: string;
    let allNewEvents = new ArrayColl<JMAPEvent>();
    let start = 0;
    let hasMore = true;
    const kMaxEvents = 200000;
    let maxRounds = kMaxEvents / batchSize;
    let previousIDs: string | null = null;
    for (let round = 1; hasMore && round <= maxRounds; round++) {
      let { newEvents, updatedEvents, syncState, ids, pageSize } = await retryOnTransientError(() =>
        this.fetchEvents(start, batchSize));
      let pageIDs = ids.join(" ");
      if (pageIDs == previousIDs) {
        break;
      }
      previousIDs = pageIDs;
      hasMore = ids.length == pageSize; // A full page means that there is probably more
      start += ids.length;
      state ??= syncState;
      this.events.addAll(newEvents);
      await this.saveEvents(newEvents);
      await this.updateRecurrenceOverrides(newEvents);
      allNewEvents.addAll(newEvents);
    }
    if (hasMore) {
      this.errorCallback(new Error("Listing the events: The server keeps returning more events. Stopped."));
    }
    if (state) {
      this.account.syncState.set("CalendarEvent", state);
    }
    this.syncState = state;
    await this.save();
    return allNewEvents;
  }

  /** @returns
   * `ids`: The events that the server returned.
   * `pageSize`: The `limit` that the server used, which may be lower than the
   *   one that we asked for. Fewer `ids` mean that this was the last page. */
  protected async fetchEvents(start: number, limit: number): Promise<UpdateResult<JMAPEvent> & { syncState: string, ids: string[], pageSize: number }> {
    console.log("JMAP fetch", `start ${start} limit ${limit}`);
    let listResponse: TJMAPGetResponse<TJMAPCalendarEvent>;
    let lock = await this.account.stateLock.lock();
    let after = new Date();
    after.setMonth(after.getMonth() - 6); // Don't fetch old appointments, only last 6 months
    try {
      // <https://www.rfc-editor.org/rfc/rfc8621.html#section-4.4>
      let response = await this.account.makeCombinedCall([
        [
          "CalendarEvent/query", {
            accountId: this.account.accountID,
            filter: {
              inCalendar: this.jmapID,
              after: after.toISOString().substring(0, 19) + "Z",
            },
            sort: [
              { property: "start", isAscending: false }
            ],
            position: start,
            limit: limit,
          },
          "list",
        ], [
          "CalendarEvent/get", {
            accountId: this.account.accountID,
            "#ids": {
              name: "CalendarEvent/query",
              path: "/ids",
              resultOf: "list",
            },
          },
          "events",
        ],
      ]);
      let queryResponse = response["list"] as TJMAPQueryResponse;
      listResponse = response["events"] as TJMAPGetResponse<TJMAPCalendarEvent>;

      return {
        ...this.parseEventsList(listResponse.list),
        syncState: listResponse.state,
        ids: sanitize.array(queryResponse.ids),
        // RFC 8620 5.5: Only returned when the server used a different limit than we asked, so default to what we asked
        pageSize: sanitize.integerRange(queryResponse.limit, 1, limit * 10, limit),
      };
    } finally {
      lock.release();
    }
  }

  /** Lists all events in this calendar that are new or updated since the last fetch. */
  protected async listChangedEvents(): Promise<ArrayColl<JMAPEvent>> {
    if (!this.account.syncState.has("CalendarEvent")) {
      return await this.listAllEvents();
    }

    try {
      return await this.fetchChangedEventsForAllCalendars();
    } catch (ex) {
      if (ex.code == "cannotCalculateChanges") {
        // Our sync state is too old <https://www.rfc-editor.org/rfc/rfc8620#section-5.2>
        this.account.syncState.delete("CalendarEvent");
        return await this.listAllEvents();
      }
      throw ex;
    }
  }

  /**
   * Checks new events for *all* calendars in this account,
   * and updates *all* calendars.
   * @returns new events of *this* calendar
   */
  async fetchChangedEventsForAllCalendars(): Promise<ArrayColl<JMAPEvent>> {
    assert(this.account.syncState.has("CalendarEvent"), "No sync state");
    let newEventsOfThisCal = new ArrayColl<JMAPEvent>();
    const kMaxRounds = 1000;
    for (let round = 1; round <= kMaxRounds; round++) {
      let lock = await this.account.stateLock.lock();
      try {
        let sinceState = this.account.syncState.get("CalendarEvent");
        // <https://www.rfc-editor.org/rfc/rfc8620#section-5.2>
        let response = await this.account.makeCombinedCall([
          [
            "CalendarEvent/changes", {
              accountId: this.account.accountID,
              sinceState: sinceState,
              maxChanges: 500,
            },
            "changes",
          ], [
            "CalendarEvent/get", {
              accountId: this.account.accountID,
              "#ids": {
                resultOf: "changes",
                name: "CalendarEvent/changes",
                path: "/created",
              },
            },
            "added",
          ], [
            "CalendarEvent/get", {
              accountId: this.account.accountID,
              "#ids": {
                resultOf: "changes",
                name: "CalendarEvent/changes",
                path: "/updated",
              },
            },
            "changed",
          ],
        ]);

        let changes = response["changes"] as TJMAPChangeResponse<TJMAPCalendarEvent>;
        let addedResponse = response["added"] as TJMAPGetResponse<TJMAPCalendarEvent>;
        let changedResponse = response["changed"] as TJMAPGetResponse<TJMAPCalendarEvent>;

        // Split the responses by calendar: map Calendar JMAP ID -> JMAP Calendar Event
        let addedByCal = new Map<string, TJMAPCalendarEvent[]>();
        let changedByCal = new Map<string, TJMAPCalendarEvent[]>();
        splitByCalendar(addedResponse.list, addedByCal);
        splitByCalendar(changedResponse.list, changedByCal);

        let allCalendars = this.account.dependentAccounts().filterOnce(a => a instanceof JMAPCalendar) as Collection<JMAPCalendar>;
        for (let calendar of allCalendars) {
          await calendar.readEventsFromDB();
          if (!calendar.syncState) {
            continue; // `listEvents()` will list all its events
          }
          let removed = this.findMovedAway(changedResponse.list, calendar);
          let addedThisCal = addedByCal.get(calendar.jmapID);
          let changedThisCal = changedByCal.get(calendar.jmapID);
          if (!(addedThisCal || changedThisCal ||
            removed.hasItems || changes.destroyed?.length)) {
            continue;
          }
          removed.addAll(await calendar.parseRemovedEvents(changes.destroyed ?? []));
          // A new created locally comes back in `created`, so need dup checks
          let addedResult = calendar.parseEventsList(addedThisCal ?? []);
          let changedResult = calendar.parseEventsList(changedThisCal ?? []);
          addedResult.newEvents.addAll(changedResult.newEvents);

          calendar.events.removeAll(removed);
          calendar.events.addAll(addedResult.newEvents);
          for (let event of removed) {
            await event.deleteLocally();
          }
          await this.saveEvents(changedResult.updatedEvents);
          await this.updateRecurrenceOverrides(changedResult.updatedEvents);
          await this.saveEvents(addedResult.newEvents);
          await this.updateRecurrenceOverrides(addedResult.newEvents);
          if (this === calendar) {
            newEventsOfThisCal.addAll(addedResult.newEvents);
          }
        }

        this.account.syncState.set("CalendarEvent", changes.newState);
        await this.account.save();
        if (!changes.hasMoreChanges) {
          return newEventsOfThisCal;
        }
        if (changes.newState == sinceState) {
          break;
        }
      } finally {
        lock.release();
      }
    }
    this.account.errorCallback(new Error("Event changes: The server keeps reporting more changes. Stopped."));
    return newEventsOfThisCal;
  }

  protected async parseRemovedEvents(jmapIDs: string[]): Promise<ArrayColl<JMAPEvent>> {
    return new ArrayColl<JMAPEvent>(jmapIDs
      .map(jmapID => this.getEventByJMAPID(jmapID))
      .filter(ev => ev));
  }

  /**
   * Find `events` that were moved away from `calendars`.
   *
   * To handle copy of the same calendar event object to a second calendar, and then deleting it from only one of the calendars,
   * we need to check *all* calendars for *every* changed contact, even if the calendar didn't change, because
   * JMAP doesn't tell us about moves or removals of the second copy. :-(
   * @return removed calendar events. It's the caller's obligation to remove them from the calendar
   */
  protected findMovedAway(events: TJMAPCalendarEvent[], calendar: JMAPCalendar): SetColl<JMAPEvent> {
    let removed = new SetColl<JMAPEvent>();
    for (let event of events) {
      let existing = calendar.getEventByJMAPID(event.id);
      // added events are handled by `calendar.parseEventsList(changedThisCal...`
      if (existing && !event.calendarIds[calendar.jmapID]) {
        removed.add(existing);
      }
    }
    return removed;
  }

  protected parseEventsList(events: TJMAPCalendarEvent[], checkUpdates = true): UpdateResult<JMAPEvent> {
    let newEvents = new ArrayColl<JMAPEvent>();
    let updatedEvents = new ArrayColl<JMAPEvent>();
    for (let json of events) {
      try {
        let id = sanitize.nonemptystring(json.id);
        if (this.deletions.has(id)) {
          continue;
        }
        let event = checkUpdates && this.getEventByJMAPID(id);
        if (event) {
          event.fromJMAP(json);
          updatedEvents.add(event);
        } else {
          event = this.newEvent();
          event.fromJMAP(json);
          newEvents.add(event);
        }
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
    return { newEvents, updatedEvents };
  }

  protected async saveEvents(events: Collection<Event>) {
    for (let event of events) {
      await event.saveLocally();
    }
  }

  protected async updateRecurrenceOverrides(events: Collection<JMAPEvent>) {
    let exceptions = new ArrayColl<Event>();
    for (let event of events) {
      event.updateRecurrenceOverrides(exceptions);
    }
    await this.saveEvents(exceptions);
  }

  getEventByJMAPID(jmapID: string): JMAPEvent | undefined {
    return this.events.find(p => p.jmapID == jmapID);
  }

  get sharePermissionLevels(): CalendarShareCombinedPermissions[] {
    return [
      CalendarShareCombinedPermissions.ReadAvailability,
      CalendarShareCombinedPermissions.ReadAll,
      CalendarShareCombinedPermissions.Modify,
    ];
  }

  async getSharedPersons(): Promise<ArrayColl<PersonUID>> {
    let response = await this.account.makeSingleCall("Calendar/get", {
      accountId: this.account.accountID,
      ids: [this.jmapID],
      properties: ["shareWith"],
    }) as TJMAPGetResponse<TJMAPCalendar>;
    return await this.account.getPrincipals(Object.keys(response.list[0]?.shareWith ?? {}));
  }

  async deleteSharedPerson(person: PersonUID) {
    await this.setSharedPerson(person, null);
  }

  async addSharedPerson(person: PersonUID, access: CalendarShareCombinedPermissions) {
    let mayModify = access == CalendarShareCombinedPermissions.Modify;
    await this.setSharedPerson(person, {
      mayReadFreeBusy: true,
      mayReadItems: access != CalendarShareCombinedPermissions.ReadAvailability,
      mayWriteAll: mayModify,
      mayWriteOwn: mayModify,
      mayUpdatePrivate: mayModify,
      mayRSVP: mayModify,
      mayShare: false,
      mayDelete: false,
    });
  }

  protected async setSharedPerson(person: PersonUID, rights: TJMAPCalendarRights | null) {
    let principalID = (await this.account.findPrincipal(person))?.id;
    assert(principalID, gt`You have no access to the account of ${person.emailAddress}`);
    let response = await this.account.makeSingleCall("Calendar/set", {
      accountId: this.account.accountID,
      update: {
        [this.jmapID]: { [`shareWith/${principalID}`]: rights },
      },
    }) as TJMAPChangeResponse<TJMAPCalendar>;
    checkChangeError(response);
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.jmapID = sanitize.alphanumdash(json.jmapID);
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.jmapID = this.jmapID;
    return json;
  }
}

type UpdateResult<T> = { newEvents: ArrayColl<T>, updatedEvents: ArrayColl<T> }

function splitByCalendar(list: TJMAPCalendarEvent[], map: Map<string, TJMAPCalendarEvent[]>) {
  for (let resp of list) {
    for (let calendarID in resp.calendarIds) {
      let list = map.get(calendarID);
      if (!list) {
        list = [];
        map.set(calendarID, list);
      }
      list.push(resp);
    }
  }
}
