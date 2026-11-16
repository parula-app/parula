import type { Event } from "../../logic/Calendar/Event";
import type { Calendar } from "../../logic/Calendar/Calendar";
import type { CalendarViewType } from "./CalendarRange";
import { ShownCalendars } from "./ShownCalendars";
import { appGlobal } from "../../logic/app";
import { mergeColls, type Collection } from "svelte-collections";
import { writable, type Writable } from "svelte/store";

export let selectedCalendar = writable<Calendar | null>(null);
/** Which event is highlighted right now. */
export let selectedEvent: Writable<Event> = writable(null);

export let selectedDate = writable(new Date());
export let startDate = writable(new Date());
export type DateInterval = 0 | 1 | 2 | 5 | 7 | 31 | 28;
/** The view of each `DateInterval`. The list has none, and the mini month shows its start day. */
export const kDateIntervalViews: Record<DateInterval, CalendarViewType> = {
  0: "day", 1: "day", 2: "dual", 5: "workweek", 7: "week", 28: "4weeks", 31: "month",
};

export let shownCalendars = new ShownCalendars(appGlobal.calendars, selectedCalendar);
export let shownCalendarEvents: Collection<Event> =
  mergeColls(shownCalendars.map(cal => cal.eventsWithRecurrences)).sortBy(ev => ev.startTime.getTime());
export let isCalendarListOpen = writable(false);
