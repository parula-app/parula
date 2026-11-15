import type { Event } from "../../logic/Calendar/Event";
import type { Calendar } from "../../logic/Calendar/Calendar";
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

export let shownCalendars = new ShownCalendars(appGlobal.calendars, selectedCalendar);
export let shownCalendarEvents: Collection<Event> =
  mergeColls(shownCalendars.map(cal => cal.eventsWithRecurrences)).sortBy(ev => ev.startTime);
export let isCalendarListOpen = writable(false);
