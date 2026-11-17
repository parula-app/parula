import { getDateTimeLocale, gPlural, gt } from "../../../l10n/l10n";
import { UserError } from "../../../logic/util/util";

export interface TimeOption {
  time: Date;
  label: string;
  durationLabel?: string;
}

const kStepMinutes = 30;

export function startTimeOptions(day: Date): TimeOption[] {
  let time = new Date(day);
  time.setHours(0, 0, 0, 0);
  let options: TimeOption[] = [];
  while (time.getDate() == day.getDate()) {
    options.push({ time: new Date(time), label: timeOfDayLabel(time) });
    time.setMinutes(time.getMinutes() + kStepMinutes);
  }
  return options;
}

export function endTimeOptions(start: Date, endDay: Date = start): TimeOption[] {
  let time = new Date(endDay);
  if (endDay.toDateString() == start.toDateString()) {
    time.setTime(start.getTime());
  } else {
    time.setHours(0, 0, 0, 0);
  }
  let options: TimeOption[] = [];
  while (time.toDateString() == endDay.toDateString()) {
    if (time.getTime() >= start.getTime()) {
      let minutes = Math.round((time.getTime() - start.getTime()) / 60000);
      options.push({
        time: new Date(time),
        label: timeOfDayLabel(time),
        durationLabel: durationLabel(minutes),
      });
    }
    time.setMinutes(time.getMinutes() + kStepMinutes);
  }
  return options;
}

export function timeOfDayLabel(time: Date): string {
  return time.toLocaleTimeString(getDateTimeLocale(), { hour: "numeric", minute: "2-digit" });
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) {
    return amountLabel(minutes, "minute");
  }
  if (minutes >= 24 * 60 && minutes % (12 * 60) == 0) {
    return amountLabel(minutes / (24 * 60), "day");
  }
  return amountLabel(minutes / 60, "hour");
}

export function amountLabel(value: number, unit: "minute" | "hour" | "day" | "week"): string {
  let number = value.toLocaleString(getDateTimeLocale(), { maximumFractionDigits: 2 });
  let pluralNumber = Number.isInteger(value) ? value : 2;
  switch (unit) {
    case "minute":
      return number + " " + gPlural(pluralNumber, { one: "minute", other: "minutes" });
    case "hour":
      return number + " " + gPlural(pluralNumber, { one: "hour", other: "hours" });
    case "day":
      return number + " " + gPlural(pluralNumber, { one: "day", other: "days" });
    case "week":
      return number + " " + gPlural(pluralNumber, { one: "week", other: "weeks" });
  }
}

export function parseTime(text: string, day: Date): Date {
  // <copied from="../../../frontend/Calendar/EditEvent/TimeInput.svelte" onChange()>
  // Also accepts "a.m." and a space before the minutes, as Outlook does
  let parts = text.trim().replace(/\./g, "").match(/^(\d{1,2})(?:[:\s]?(\d\d))?\s*(am?|(pm?))?$/i);
  if (!parts) {
    throw new UserError(gt`Could not interpret value as a time`);
  }
  let hour = Number(parts[1]);
  if (parts[3]) {
    if (hour < 1 || hour > 12) {
      throw new UserError(gt`Hour must be between 1 and 12 when using am or pm`);
    }
    hour %= 12;
    if (parts[4]) {
      hour += 12;
    }
  } else if (hour >= 24) {
    throw new UserError(gt`Hour must be less than 24`);
  }
  let minute = Number(parts[2] || 0);
  if (minute >= 60) {
    throw new UserError(gt`Minute must be less than 60`);
  }
  let time = new Date(day);
  time.setHours(hour, minute, 0, 0);
  return time;
  // </copied>
}
