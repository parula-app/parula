import type { Event } from "../../logic/Calendar/Event";
import { openEvent } from "./open";
import { bringAppToFront } from "../AppsBar/selectedApp";
import { appGlobal } from "../../logic/app";
import { SystemNotification, NotificationKinds } from "../Shared/SystemNotification";
import { getComputerOn } from "../../logic/util/backend-wrapper";
import { getLocalStorage } from "../Util/LocalStorage";
import { catchErrors, minorError } from "../Util/error";
import { k1HourMS } from "../../logic/util/date";
import CalendarIcon from '../asset/icon/appBar/calendar.svg?raw';
import { Debounce } from "../../logic/util/flow/Debounce";
import { sleep } from "../../logic/util/util";
import { CollectionObserver, type Collection } from "svelte-collections";

/** `setTimeout()` overflows and fires immediately, if the delay is longer than 24 days.
 * Waking up in-between also lets us catch up when the system clock jumped. */
const kMaxDelayMS = k1HourMS;

/** All events that have an alarm, including those in the past.
 *
 * Created only once: The condition must not depend on the current time, and
 * creating the collection again while it tells us about a change would
 * make it tell us about the same change again, endlessly. */
let eventsWithAlarms: Collection<Event>;
let isListening = false;
let timeout: NodeJS.Timeout | null = null;
/** Alarms before this time have already been shown to the user, or happened before app start */
let lastRemindTime = Date.now();

/** Notifies the user when the alarm of a calendar event is due. */
export async function reminderListener() {
  if (isListening) {
    return;
  }
  isListening = true;
  await sleep(3);
  const now = Date.now();
  eventsWithAlarms = appGlobal.calendarEvents.filterObservable(event => event.alarm && event.alarm.getTime() > now);
  eventsWithAlarms.registerObserver(eventsObserver);
  eventsObserver.added(eventsWithAlarms.contents);
  // Timers don't run while the computer sleeps
  getComputerOn().subscribe(waitForNextReminder);
}

/** Sets the timer for the next alarm that is due. */
function waitForNextReminder() {
  /* Attention: Must not create observable collections: We run while the collections
  tell us about a change. If we add a new observer during the observer run,
  the new observer would be called for the same change, and we'd loop endlessly. */

  clearTimeout(timeout);
  let nextAlarm: Date | null = null;
  for (let event of eventsWithAlarms) {
    if (event.alarm.getTime() > lastRemindTime && (!nextAlarm || event.alarm < nextAlarm)) {
      nextAlarm = event.alarm;
    }
  }
  if (!nextAlarm) {
    return;
  }
  let delayMS = Math.max(Math.min(nextAlarm.getTime() - Date.now(), kMaxDelayMS), 0);
  timeout = setTimeout(() => catchErrors(showReminder, minorError), delayMS);
}

async function showReminder() {
  let now = Date.now();
  let dueEvents = eventsWithAlarms.filterOnce(event =>
    event.alarm.getTime() > lastRemindTime &&
    event.alarm.getTime() <= now &&
    // The reminder is pointless once the meeting is over, e.g. after the computer slept
    (!event.endTime || event.endTime.getTime() > now));
  lastRemindTime = now;
  waitForNextReminder();
  if (dueEvents.isEmpty) {
    return;
  }

  const kinds = new NotificationKinds(getLocalStorage("notifications.calendar", ["popup", "sound"]).value);
  for (let event of dueEvents) {
    let notification = new SystemNotification(kinds, event.title, event.descriptionText, event.id);
    notification.icon = CalendarIcon;
    notification.onClick = () => openEventInApp(event);
    await notification.show();
  }
}

async function openEventInApp(event: Event) {
  try {
    openEvent(event, false);
    bringAppToFront();
  } catch (ex) {
    minorError(ex);
  }
}

/** Waits until all the changes of a sync are in, and calculates only once */
let waitForNextReminderDebounce = new Debounce(1);

/** Watches when an event gets or loses its alarm, and when the alarm time changes */
class EventsWithAlarmsObserver extends CollectionObserver<Event> {
  protected unsubscribeEvents = new Map<Event, () => void>();

  added(events: Event[]) {
    for (let event of events) {
      // The collection tells us only whether the event has an alarm, not when the alarm time changes
      this.unsubscribeEvents.set(event, event.subscribe(() => this.changed()));
    }
    this.changed();
  }

  removed(events: Event[]) {
    for (let event of events) {
      this.unsubscribeEvents.get(event)?.();
      this.unsubscribeEvents.delete(event);
    }
    this.changed();
  }

  protected changed() {
    waitForNextReminderDebounce.debounce(waitForNextReminder)
      .catch(minorError);
  }
}
let eventsObserver = new EventsWithAlarmsObserver();
