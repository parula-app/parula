import { selectedCalendar, selectedDate, selectedEvent, startDate, type DateInterval } from "./selected";
import { createNewEvent } from "./event";
import { openEvent } from "./open";
import { focusSearch } from "../MainWindow/GlobalKeyboard";
import { getKeyDigit, getOSName, isTextField } from "../Util/util";
import { getLocalStorage } from "../Util/LocalStorage";
import { getToday, getWeekStart } from "../../logic/util/date";
import { get } from "svelte/store";

// <https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values>

/** Keys of the calendar app */
export async function onKeyOnCalendar(event: KeyboardEvent) {
  if (event.defaultPrevented || isTextField(event.target)) {
    return;
  }
  let view = getLocalStorage<DateInterval>("calendar.view", 2);
  let day = shownDay(view.value);
  let isCtrl = event.ctrlKey || event.metaKey;
  let key = event.key.length == 1 ? event.key.toLowerCase() : event.key;

  function show(date: Date) {
    event.preventDefault();
    event.stopPropagation();
    startDate.set(new Date(date));
    selectedDate.set(new Date(date));
  }

  function showView(interval: DateInterval) {
    event.preventDefault();
    event.stopPropagation();
    view.value = interval;
  }

  // Ctrl+Alt+
  if (isCtrl && event.altKey && !event.shiftKey) {
    const kViews: DateInterval[] = [null, 1, 5, 7, 31];
    let interval = kViews[getKeyDigit(event) ?? 0];
    if (interval) { // Outlook: Day, Work week, Week, Month
      showView(interval);
      return;
    } else if (key == "ArrowRight" || key == "ArrowLeft") { // Outlook: Next and previous period
      show(nextPeriod(day, view.value, key == "ArrowLeft" ? -1 : 1));
      return;
    }
  }
  // Ctrl+ (or Cmd+)
  if (isCtrl && !event.altKey && !event.shiftKey) {
    if (key == "n") { // Outlook
      event.preventDefault();
      event.stopPropagation();
      createNewEvent(get(selectedCalendar), get(selectedDate), false);
      return;
    } else if (key == "e") { // Outlook
      event.preventDefault();
      event.stopPropagation();
      focusSearch();
      return;
    } else if (key == "ArrowRight" || key == "ArrowLeft") { // Outlook: Next and previous day
      show(addDays(day, key == "ArrowLeft" ? -1 : 1));
      return;
    }
  }
  // Alt+ (Option+ types characters on macOS)
  if (event.altKey && !isCtrl && getOSName() != "macintosh") {
    if (event.shiftKey) {
      if (event.code == "KeyY") { // Outlook
        show(getToday());
        return;
      }
    } else if (key == "ArrowDown" || key == "ArrowUp") { // Outlook: Next and previous week
      show(addDays(day, key == "ArrowUp" ? -7 : 7));
      return;
    } else if (key == "PageDown" || key == "PageUp") { // Outlook: Next and previous month
      show(addMonths(day, key == "PageUp" ? -1 : 1));
      return;
    } else if (key == "Home") { // Outlook: Start of the week
      show(getWeekStart(day));
      return;
    } else if (key == "End") { // Outlook: End of the week
      show(addDays(getWeekStart(day), 6));
      return;
    } else if (key == "-") { // Outlook
      showView(7);
      return;
    } else if (key == "=") { // Outlook
      showView(31);
      return;
    }
  }
  // No modifier
  if (key == "Enter" && !isCtrl && !event.altKey && !event.shiftKey &&
      !(event.target as HTMLElement)?.closest?.("button, a")) { // Outlook
    let calendarEvent = get(selectedEvent);
    if (calendarEvent) {
      event.preventDefault();
      event.stopPropagation();
      openEvent(calendarEvent, true);
    }
  }
}

/** The day from which the keys go forward and back:
 * the selected day, if the view shows it, otherwise the first day of the view */
function shownDay(view: DateInterval): Date {
  let start = get(startDate);
  let selected = get(selectedDate);
  if (view == 2 || view == 0) {
    return selected;
  } else if (view == 5 || view == 7) {
    return getWeekStart(start).getTime() == getWeekStart(selected).getTime() ? selected : start;
  } else if (view == 31) {
    // The month view's first row may start in the previous month
    let month = addDays(start, 7);
    return month.getMonth() == selected.getMonth() && month.getFullYear() == selected.getFullYear() ? selected : month;
  }
  return start;
}

function nextPeriod(day: Date, view: DateInterval, direction: number): Date {
  if (view == 31) {
    return addMonths(day, direction);
  } else if (view == 5 || view == 7 || view == 28) {
    return addDays(day, view == 28 ? 28 * direction : 7 * direction);
  }
  return addDays(day, direction);
}

function addDays(date: Date, days: number): Date {
  let result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** Keeps the day of the month, as far as the other month has it */
function addMonths(date: Date, months: number): Date {
  let result = new Date(date);
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  let daysInMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(date.getDate(), daysInMonth));
  return result;
}
