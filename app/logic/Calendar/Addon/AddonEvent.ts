import { Event } from "../Event";
import type { AddonCalendar } from "./AddonCalendar";
import { convertICalToEvent, convertICalContainerToEvent, parseDate } from "../ICal/ICalToEvent";
import { ICalParser } from "../ICal/ICalParser";
import { getICal } from "../ICal/ICalGenerator";
import { sanitizeHTMLWithoutLoading } from "../../util/convertHTML";
import { ensureArray } from "../../util/util";
import type { ArrayColl } from "svelte-collections";

export class AddonEvent extends Event {
  /** pID: of the server */
  declare calendar: AddonCalendar;
  declare parentEvent: AddonEvent;
  declare readonly exceptions: ArrayColl<AddonEvent>;

  /** @param ical from the addon, unchecked
   * @returns false, if it has no event */
  fromAddon(id: string, ical: string): boolean {
    if (!convertICalToEvent(ical, this)) {
      return false;
    }
    this.pID = id;
    this.checkFromAddon();
    return true;
  }

  /** Texts lose control characters. The description loses what would load from the internet,
   * because the event editor shows it unsanitized. */
  protected checkFromAddon() {
    const kMaxLength = 10000;
    let connection = this.calendar.connection;
    this.title = connection.checkText(this.title, kMaxLength, "");
    this.location = connection.checkText(this.location, kMaxLength, "");
    if (this.hasHTML) {
      this.rawHTMLDangerous = sanitizeHTMLWithoutLoading(this.rawHTMLDangerous);
    }
  }

  // <copied from="../CalDAV/CalDAVEvent.ts updateExceptions()">, with the iCalendar as parameter, and checked occurrences
  /** Modified occurrences of a recurring event are additional `VEVENT`s
   * with a `RECURRENCE-ID`, and deleted occurrences are `EXDATE`s of the
   * master, in the same ics file. Attach them to this master.
   * Call after `fromAddon()` and `saveLocally()`. */
  async updateExceptions(ical: string) {
    if (!this.recurrenceRule) {
      return;
    }
    let parsed = new ICalParser(ical);
    let vevents = ensureArray(parsed.containers.vcalendar?.[0].containers.vevent);
    for (let vevent of vevents) {
      let recurrenceID = vevent.entries.recurrenceid?.[0];
      if (!recurrenceID) {
        continue; // the master itself
      }
      try {
        let [recurrenceStartTime] = parseDate(recurrenceID);
        if (!recurrenceStartTime) {
          continue;
        }
        let occurrence = this.getOccurrenceByDate(recurrenceStartTime, false) as AddonEvent | null;
        if (!occurrence) {
          continue;
        }
        convertICalContainerToEvent(vevent, occurrence);
        occurrence.checkFromAddon();
        await occurrence.saveLocally();
      } catch (ex) {
        this.calendar.errorCallback(ex);
      }
    }
    let master = vevents.find(v => !v.entries.recurrenceid);
    for (let entry of ensureArray(master?.entries.exdate)) {
      for (let value of entry.value.split(",")) { // one EXDATE line can hold multiple dates
        let [exclusionTime] = parseDate({ value, properties: entry.properties });
        if (exclusionTime) {
          this.makeExclusionLocally(exclusionTime);
        }
      }
    }
  }
  // </copied>

  async saveToServer() {
    await this.prepareSaveToServer(); // creates the online meeting, so its URL must be in the iCalendar
    if (this.parentEvent) {
      // Exceptions are in the iCalendar of the master
      await this.parentEvent.saveToServer();
      return;
    }
    let connection = this.calendar.connection;
    this.calUID ??= crypto.randomUUID();
    let id = connection.checkID(await connection.call("saveEvent", this.pID, await getICal(this)));
    if (id != this.pID) {
      this.pID = id;
      await this.saveLocally();
    }
    await this.sendInvitationsDirectly();
  }

  async deleteFromServer() {
    if (this.parentEvent) {
      // Occurrences are in the iCalendar of the master.
      // `deleteLocally()` already added the exclusion to the master.
      await this.parentEvent.saveToServer();
      return;
    }
    if (!this.pID) {
      return;
    }
    await this.calendar.connection.call("deleteEvent", this.pID);
  }
}
