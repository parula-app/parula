import type { Event } from "../../logic/Calendar/Event";
import type { Calendar } from "../../logic/Calendar/Calendar";
import { selectedCalendar } from "./selected";
import { openEvent } from "./open";
import { getLocalStorage } from "../Util/LocalStorage";
import { appGlobal } from "../../logic/app";
import { gt } from "../../l10n/l10n";
import { assert } from "../../logic/util/util";

/** Creates a new event in the calendar, and opens it for editing. */
export function createNewEvent(calendar: Calendar, startTime: Date, exact: boolean = true): void {
  calendar ??= appGlobal.calendars.first;
  assert(calendar, gt`Please set up a calendar first`);
  selectedCalendar.set(calendar);
  let event = calendar.newEvent();
  setNewEventTime(event, exact, startTime);
  openEvent(event, true);
}

export function setNewEventTime(event: Event, exact: boolean = true, startTime: Date, endTime?: Date): void {
  event.startTime = new Date(startTime);
  if (!exact) {
    event.startTime.setHours(event.startTime.getHours() + 1, 0, 0, 0);
  }
  if (endTime) {
    event.endTime = new Date(endTime);
  } else {
    const defaultLengthInMinutes = Math.max(getLocalStorage("calendar.defaultEventLengthInMinutes", 60).value, 1);
    event.endTime = new Date(event.startTime);
    event.endTime.setMinutes(event.startTime.getMinutes() + defaultLengthInMinutes);
  }
}
