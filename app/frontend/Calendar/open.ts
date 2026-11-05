import type { Event } from "../../logic/Calendar/Event";
import { selectedDate, selectedEvent, startDate } from "../Calendar/selected";
import { goTo, openApp } from "../AppsBar/selectedApp";
import { calendarMustangApp } from "../Calendar/CalendarMustangApp";
import { appGlobal } from "../../logic/app";

// TODO compare openUIFor()
export function openEvent(event: Event, edit = true) {
  selectedEvent.set(event);
  selectedDate.set(new Date(event.startTime));
  startDate.set(new Date(event.startTime));
  if (appGlobal.isMobile) {
    goTo("/calendar/event", { event });
  } else {
    openApp(calendarMustangApp, { event });
    if (edit && !event.isReadOnly) {
      calendarMustangApp.showEvent(event);
      event.startEditing();
    }
  }
}
