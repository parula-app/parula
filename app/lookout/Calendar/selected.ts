import type { Event } from "../../logic/Calendar/Event";
import type { Calendar } from "../../logic/Calendar/Calendar";
import type { CalendarPropertiesTab } from "./CalendarPropertiesDialog.svelte";
import { shownCalendars } from "../../frontend/Calendar/selected";
import { k1MinuteMS } from "../../logic/util/date";
import { EventTable } from "./ListView/EventTable";
import { appGlobal } from "../../logic/app";
import { mergeColls, type Collection } from "svelte-collections";
import { TimeZoneRuler } from "./TimeZones";
import { getLocalStorage } from "../../frontend/Util/LocalStorage";
import { AppWindow } from "../../frontend/MainWindow/AppWindow";
import { derived, readable, writable, type Readable } from "svelte/store";

export type CalendarViewType = "day" | "workweek" | "week" | "month" | "schedule" | "dual";

export enum CalendarCurrentView {
  Calendar = "calendar",
  Preview = "preview",
  List = "list",
  Active = "active",
}

export enum CalendarFolderPane {
  Normal = "normal",
  Minimized = "minimized",
  Off = "off",
}

export enum CalendarSearchScope {
  CurrentFolder = "current",
  AllCalendarItems = "all",
}

export interface CalendarSearchOptions {
  scope: CalendarSearchScope;
  isRecurring: boolean;
  hasAttachments: boolean;
  organizerEMail: string | null;
}

export const calendarSearchOptions = AppWindow.perWindow(() => writable<CalendarSearchOptions>({
  scope: CalendarSearchScope.AllCalendarItems,
  isRecurring: false,
  hasAttachments: false,
  organizerEMail: null,
}));

export const listedEvents: Collection<Event> = AppWindow.perWindow(appWindow =>
  mergeColls(appWindow.uiState(shownCalendars).map(calendar => calendar.events)).filterObservable(event => EventTable.isListed(event)));
export const allListedEvents: Collection<Event> =
  mergeColls(appGlobal.calendars.map(calendar => calendar.events)).filterObservable(event => EventTable.isListed(event));

export interface SlotSelection {
  start: Date;
  end: Date;
  allDay: boolean;
  calendar: Calendar | null;
}

export interface EventPeek {
  event: Event;
  anchor: HTMLElement;
}

export const selectedSlots = AppWindow.perWindow(() => writable<SlotSelection | null>(null));
export const updatingCount = writable(0);
export const eventPeek = AppWindow.perWindow(() => writable<EventPeek | null>(null));
export const inlineTitle = AppWindow.perWindow(() => writable<string | null>(null));
export const isGoToDateOpen = AppWindow.perWindow(() => writable(false));
export const openCalendarProperties = AppWindow.perWindow(() => writable<{ calendar: Calendar, tab: CalendarPropertiesTab } | null>(null));
export const openSharedCalendar = AppWindow.perWindow(() => writable<{ fromAddressBook: boolean } | null>(null));
// <copied from="../../frontend/Calendar/CurrentTimeMarker.svelte">
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
// </copied>
// export const workWeekHours = WorkingHours.ofAll(new ShownWorkHours(
//   shownCalendars.filterObservable(calendar => !calendar.isOtherPersonsCalendar)));

export const timeZoneRulers: Readable<TimeZoneRuler[]> = derived([
  getLocalStorage<string>("lookout.calendar.timeZone.label", ""),
  getLocalStorage<boolean>("lookout.calendar.timeZone2.shown", false),
  getLocalStorage<string>("lookout.calendar.timeZone2.label", ""),
  getLocalStorage<string>("lookout.calendar.timeZone2.zone", "Etc/UTC"),
  getLocalStorage<boolean>("lookout.calendar.timeZone3.shown", false),
  getLocalStorage<string>("lookout.calendar.timeZone3.label", ""),
  getLocalStorage<string>("lookout.calendar.timeZone3.zone", "Etc/UTC"),
], ([label, secondShown, secondLabel, secondZone, thirdShown, thirdLabel, thirdZone]) => TimeZoneRuler.ofZones(label.value, [
  { shown: thirdShown.value, zone: thirdZone.value, label: thirdLabel.value },
  { shown: secondShown.value, zone: secondZone.value, label: secondLabel.value },
]));
