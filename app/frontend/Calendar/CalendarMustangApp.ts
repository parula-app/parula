import { MustangApp } from "../AppsBar/MustangApp";
import { openApp } from "../AppsBar/selectedApp";
import type { Event } from "../../logic/Calendar/Event";
import CalendarIcon from "../Calendar/CalendarIcon.svelte";
import EditIcon from "lucide-svelte/icons/pencil";
import { derived } from "svelte/store";
import { gt, locale } from "../../l10n/l10n";

export class CalendarMustangApp extends MustangApp {
  id = "calendar";
  get name() {
    return gt`Calendar`;
  }
  icon = CalendarIcon;
  appURL = "/calendar";

  showEvent(event: Event) {
    let edit = calendarMustangApp.subApps.find(app => app.windowParams?.event == event);
    if (!edit) {
      edit = new CalendarEventMustangApp();
      edit.title = derived([event, locale], ([event]) => event.title ?? edit.name);
      edit.windowParams = { event: event };
      calendarMustangApp.subApps.add(edit);
    }
    openApp(edit, edit.windowParams);
  }

  /** Closes the full window that `showEvent()` opened, if any */
  closeEvent(event: Event) {
    let window = this.subApps.find(app => app instanceof CalendarEventMustangApp && app.windowParams.event == event);
    this.subApps.remove(window);
  }
}

export class CalendarEventMustangApp extends MustangApp {
  id = "calendar-event-show";
  get name() {
    return gt`Event`;
  }
  icon = EditIcon;
  appURL = "/calendar/event";
}

export const calendarMustangApp = new CalendarMustangApp();
