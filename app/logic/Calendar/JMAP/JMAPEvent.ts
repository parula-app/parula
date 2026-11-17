import { Event } from "../Event";
import { JSCalendarEvent } from "./JSCalendarEvent";
import type { TJMAPCalendarEvent } from "./TJSCalendar";
import type { TID, TJMAPChangeResponse } from "../../Mail/JMAP/TJMAPGeneric";
import type { JMAPCalendar } from "./JMAPCalendar";
import { JMAPOutgoingInvitation } from "./JMAPOutgoingInvitation";
import { checkChangeError } from "../../Mail/JMAP/JMAPError";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import type { ArrayColl } from "svelte-collections";

export class JMAPEvent extends Event {
  declare calendar: JMAPCalendar;
  declare parentEvent: JMAPEvent;
  declare readonly exceptions: ArrayColl<JMAPEvent>;
  isOrigin = true;
  original: TJMAPCalendarEvent;

  get jmapID(): TID {
    return this.pID;
  }
  set jmapID(val: TID) {
    this.pID = val;
  }

  get account() {
    return this.calendar.account;
  }

  fromJMAP(jmap: TJMAPCalendarEvent) {
    JSCalendarEvent.toEvent(jmap, this);
    this.isOrigin = sanitize.boolean(jmap.isOrigin, true);
    this.jmapID = sanitize.alphanumdash(jmap.id);
    this.original = jmap;
  }

  updateRecurrenceOverrides(exceptions: ArrayColl<Event>) {
    let ro = this.original.recurrenceOverrides;
    for (let override in ro) {
      try {
        let recurrenceStartTime = JSCalendarEvent.toDate(override, this.original);
        if (ro[override].excluded) {
          this.makeExclusionLocally(recurrenceStartTime);
        } else {
          let instance = this.getOccurrenceByDate(recurrenceStartTime);
          let json = JSCalendarEvent.applyOverride(this.original, override, ro[override]);
          JSCalendarEvent.toEvent(json, instance);
          instance.original = ro[override];
          exceptions.add(instance);
        }
      } catch (ex) {
        this.calendar.errorCallback(ex);
      }
    }
  }

  get outgoingInvitation() {
    return new JMAPOutgoingInvitation(this);
  }

  async saveToServer() {
    await this.prepareSaveToServer();

    if (this.parentEvent) {
      // Instances and exceptions are stored in the master's `recurrenceOverrides`.
      // `saveLocally()` already added this event to the master.
      await this.parentEvent.saveToServer();
      return;
    }

    let isNew = !this.original;
    let jsevent = this.original ?? {} as TJMAPCalendarEvent;
    JSCalendarEvent.fromEvent(this, jsevent); // overwrites `jsevent`, so must be first
    jsevent.calendarIds ??= {};
    jsevent.calendarIds[this.calendar.jmapID] = true;
    delete jsevent.id; // Workaround for <https://github.com/stalwartlabs/stalwart/discussions/2858>
    delete jsevent.isOrigin; // ditto
    if (!isNew) {
      delete jsevent.uid; // UID is immutable
    }
    assert(this.id, "Event ctor should set this");

    let results = await this.account.makeSingleCall("CalendarEvent/set", {
      accountId: this.account.accountID,
      [isNew ? "create" : "update"]: {
        [isNew ? this.id : this.jmapID]: jsevent,
      },
    }) as TJMAPChangeResponse<TJMAPCalendarEvent>;
    checkChangeError(results);

    this.original = jsevent;
    if (isNew) {
      this.jmapID = this.original.id = sanitize.alphanumdash(results.created[this.id].id);
      await this.saveLocally();
    }

    await this.sendInvitationsDirectly(); // server doesn't send
  }

  async deleteFromServer() {
    if (this.parentEvent) {
      // Instances and exceptions are stored in the master's `recurrenceOverrides`.
      // `deleteLocally()` already added the exclusion to the master.
      await this.parentEvent.saveToServer();
      return;
    }
    if (!this.jmapID) { // never saved to the server
      return;
    }
    let response = await this.account.makeSingleCall("CalendarEvent/set", {
      accountId: this.account.accountID,
      destroy: [this.jmapID],
    }) as TJMAPChangeResponse<TJMAPCalendarEvent>;
    checkChangeError(response);
    await super.deleteFromServer(); // we send, because server doesn't
  }

  async makeExclusions(exclusions: JMAPEvent[]) {
    await super.makeExclusions(exclusions);
  }

  fromExtraJSON(json: any) {
    super.fromExtraJSON(json);
    this.original = sanitize.json(json.original, null); // as object, not string. null = never saved to the server
    this.jmapID = sanitize.alphanumdash(json.jmapID, null);
  }
  toExtraJSON(): any {
    let json = super.toExtraJSON();
    json.original = this.original;
    json.jmapID = this.jmapID;
    return json;
  }
}
