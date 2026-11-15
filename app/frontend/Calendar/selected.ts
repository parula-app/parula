import type { Event } from "../../logic/Calendar/Event";
import type { Calendar } from "../../logic/Calendar/Calendar";
import { ShownCalendars } from "./ShownCalendars";
import { appGlobal } from "../../logic/app";
import { k1MinuteMS } from "../../logic/util/date";
import { mergeColls, type Collection } from "svelte-collections";
import { readable, writable, type Writable } from "svelte/store";

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

/** The current time, updated every minute */
export const now = readable(new Date(), set => {
  let timeout: ReturnType<typeof setTimeout>;
  function update() {
    let time = new Date();
    timeout = setTimeout(update, k1MinuteMS - time.getSeconds() * 1000 - time.getMilliseconds());
    time.setSeconds(0, 0);
    set(time);
  }
  update();
  return () => clearTimeout(timeout);
});
