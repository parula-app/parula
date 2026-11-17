import type { Event } from "../../logic/Calendar/Event";
import { selectedDate, selectedEvent, startDate } from "../Calendar/selected";
import { goTo, openApp } from "../AppsBar/selectedApp";
import { AppWindow } from "../MainWindow/AppWindow";
import { calendarMustangApp } from "../Calendar/CalendarMustangApp";
import { appGlobal } from "../../logic/app";

// TODO compare openUIFor()
export function openEvent(event: Event, edit = true) {
  let appWindow = AppWindow.current().mainWindow;
  appWindow.uiState(selectedEvent).set(event);
  appWindow.uiState(selectedDate).set(new Date(event.startTime));
  appWindow.uiState(startDate).set(new Date(event.startTime));
  if (appGlobal.isMobile) {
    goTo("/calendar/event", { event });
  } else {
    openApp(calendarMustangApp, { event });
    if (edit) {
      calendarMustangApp.showEvent(event);
      event.startEditing();
    }
  }
}
