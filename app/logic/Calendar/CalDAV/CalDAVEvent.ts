import { Event } from "../Event";
import type { CalDAVCalendar } from "./CalDAVCalendar";
import { convertICalToEvent, convertICalContainerToEvent, parseDate } from "../ICal/ICalToEvent";
import { ICalParser } from "../ICal/ICalParser";
import { getICal } from "../ICal/ICalGenerator";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assertHTTPResponseOK } from "../../util/netUtil";
import { ensureArray, type URLString } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import type { ArrayColl } from "svelte-collections";
import type { DAVObject } from "tsdav";

export class CalDAVEvent extends Event {
  declare calendar: CalDAVCalendar;
  declare parentEvent: CalDAVEvent;
  declare readonly exceptions: ArrayColl<CalDAVEvent>;
  originalICal: string;

  /** URL of this event on the server, which is its ID there. null until saved. */
  get url(): URLString | null {
    return this.pID;
  }
  set url(val: URLString | null) {
    this.pID = val;
  }
  get etag(): string | null {
    return this.syncState as string;
  }
  set etag(val: string | null) {
    this.syncState = val;
  }

  fromDAVObject(entry: DAVObject): boolean {
    this.originalICal = entry.data;
    let isEvent = convertICalToEvent(entry.data, this);
    if (!isEvent) {
      return false;
    }
    this.url = new URL(entry.url, this.calendar.calendarURL).href;
    this.etag = entry.etag;
    return true;
  }

  /** Modified occurrences of a recurring event are additional `VEVENT`s
   * with a `RECURRENCE-ID`, and deleted occurrences are `EXDATE`s of the
   * master, in the same ics file. Attach them to this master.
   * Call after `fromDAVObject()` and `saveLocally()`. */
  async updateExceptions() {
    if (!this.recurrenceRule || !this.originalICal) {
      return;
    }
    let parsed = new ICalParser(this.originalICal);
    let vevents = ensureArray(parsed.containers.vcalendar?.[0].containers.vevent);
    for (let vevent of vevents) {
      let recurrenceID = vevent.entries.recurrenceid?.[0];
      if (!recurrenceID) {
        continue; // the master itself
      }
      try {
        let [recurrenceStartTime] = parseDate(recurrenceID, vevent);
        if (!recurrenceStartTime) {
          continue;
        }
        let occurrence = this.getOccurrenceByDate(recurrenceStartTime, false) as CalDAVEvent | null;
        if (!occurrence) {
          continue;
        }
        convertICalContainerToEvent(vevent, occurrence);
        await occurrence.saveLocally();
      } catch (ex) {
        this.calendar.errorCallback(ex);
      }
    }
    let master = vevents.find(v => !v.entries.recurrenceid);
    for (let entry of ensureArray(master?.entries.exdate)) {
      for (let value of entry.value.split(",")) { // one EXDATE line can hold multiple dates
        let [exclusionTime] = parseDate({ value, properties: entry.properties }, master);
        if (exclusionTime) {
          this.makeExclusionLocally(exclusionTime);
        }
      }
    }
  }

  getDAVObject(iCal?: string): DAVObject {
    return {
      url: this.url,
      etag: this.etag,
      data: iCal,
    };
  }

  async saveToServer() {
    await this.prepareSaveToServer(); // creates the online meeting, so its URL must be in the ics
    if (this.parentEvent) {
      // Exceptions are stored in the master's ics file.
      // `saveLocally()` already attached this event to the master.
      await this.parentEvent.saveToServer();
      return;
    }
    await this.calendar.login(false);
    this.calUID ??= crypto.randomUUID();
    let iCal = await getICal(this);
    if (this.url) {
      // TODO take `originalICal` and update only the properties we know about
      console.log("updating", this, this.url, "with ICS", iCal);
      let response = await this.calendar.client.updateCalendarObject({
        calendarObject: this.getDAVObject(iCal),
      });
      await assertHTTPResponseOK(response, gt`Saving the event failed`);
    } else {
      console.log("creating", this, "with ICS", iCal);
      let filename = sanitize.filename(this.calUID) + ".ics";
      let response = await this.calendar.client.createCalendarObject({
        calendar: this.calendar.davCalendar,
        iCalString: iCal,
        filename,
      });
      await assertHTTPResponseOK(response, gt`Saving the event failed`);
      this.url = new URL(filename, this.calendar.calendarURL).href;
      this.originalICal = iCal;
      await this.saveLocally(); // Save server IDs, otherwise we get dups
    }
    await this.sendInvitationsDirectly();
  }

  async saveTask() {
  }

  fromExtraJSON(json: any) {
    super.fromExtraJSON(json);
    this.originalICal = sanitize.string(json.original, null);
  }
  toExtraJSON(): any {
    let json = super.toExtraJSON();
    json.original = this.originalICal;
    return json;
  }

  async deleteFromServer() {
    console.log("Delete event", this, this.url, {
      calendarObject: this.getDAVObject(),
    });
    if (this.parentEvent) {
      // Occurrences are stored in the master's ics file.
      // `deleteLocally()` already added the exclusion to the master.
      await this.parentEvent.saveToServer();
      return;
    }
    if (!this.url) {
      return;
    }
    await this.calendar.login(false);
    let response = await this.calendar.client.deleteCalendarObject({
      calendarObject: this.getDAVObject(),
    });
    if (await response.status != 404) { // 404 = already deleted on the server
      await assertHTTPResponseOK(response, gt`Deleting the event failed`);
    }
  }
}
