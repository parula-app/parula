import type { Event } from "../../logic/Calendar/Event";
import type { Calendar } from "../../logic/Calendar/Calendar";
import { ShownCalendars } from "./ShownCalendars";
import { AppWindow } from "../MainWindow/AppWindow";
import { appGlobal } from "../../logic/app";
import { mergeColls, type Collection } from "svelte-collections";
import { writable, type Writable } from "svelte/store";

export let selectedCalendar = AppWindow.perWindow(() => writable<Calendar | null>(null));
/** Which event is highlighted right now. */
export let selectedEvent: Writable<Event> = AppWindow.perWindow(() => writable(null));

export let selectedDate = AppWindow.perWindow(() => writable(new Date()));
export let startDate = AppWindow.perWindow(() => writable(new Date()));
export type DateInterval = 0 | 1 | 2 | 5 | 7 | 31 | 28;

export let shownCalendars = AppWindow.perWindow(appWindow => new ShownCalendars(appGlobal.calendars, appWindow.uiState(selectedCalendar)));
export let shownCalendarEvents: Collection<Event> = AppWindow.perWindow(appWindow =>
  mergeColls(appWindow.uiState(shownCalendars).map(cal => cal.eventsWithRecurrences)).sortBy(ev => ev.startTime));
export let isCalendarListOpen = AppWindow.perWindow(() => writable(false));
