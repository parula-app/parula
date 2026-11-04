import { getDateTimeLocale, gPlural, gt } from "../../l10n/l10n";

/**
* @returns
* For today: Time, e.g. "15:23"
* This week: Weekday, Time, e.g. "Wed 15:23"
* Other this year: Date without year and time, e.g. "23.11. 15:23"
* Other: Date and time, e.g. "23.11.2018 15:23"
* Each in locale
* See also <https://momentjs.com> for relative time
*/
export function getDateTimeString(date: Date): string {
  if (!date) {
    return "";
  }
  let dateDetails: Intl.DateTimeFormatOptions;
  let today = new Date();
  if (date > today) { // future
    dateDetails = { year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "numeric" };
  } else if (date.getDate() == today.getDate() && today.getTime() - date.getTime() < k1DayMS) { // today
    dateDetails = { hour: "numeric", minute: "numeric" };
  } else if (today.getTime() - date.getTime() < 7 * k1DayMS &&
      today.getTime() - date.getTime() > -7 * k1DayMS) { // this week
    dateDetails = { weekday: "short", hour: "numeric", minute: "numeric" };
  } else if (date.getFullYear() == today.getFullYear()) { // this year
    dateDetails = { month: "2-digit", day: "2-digit", hour: "numeric", minute: "numeric" };
  } else { // full date
    dateDetails = { year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "numeric" };
  }
  return date.toLocaleString(getDateTimeLocale(), dateDetails);
}

/**
* @returns
* For today: "Today"
* This week: Weekday, long, e.g. "Wednesday"
* Other this year: Date, without year, e.g. "23.11."
* Other: Full Date, e.g. "23.11.2018"
* Each in locale
* See also <https://momentjs.com> for relative time
*/
export function getDateString(date: Date, fullDate?: Intl.DateTimeFormatOptions): string {
  if (!date) {
    return "";
  }
  let dateDetails: Intl.DateTimeFormatOptions;
  let today = new Date();
  if (date > today) { // future
    dateDetails = fullDate ?? { year: "numeric", month: "2-digit", day: "2-digit" };
  } else if (date.getDate() == today.getDate() && today.getTime() - date.getTime() < k1DayMS) { // today
    return gt`Today`;
  } else if (today.getTime() - date.getTime() < 7 * k1DayMS &&
      today.getTime() - date.getTime() > -7 * k1DayMS) { // this week
    dateDetails = { weekday: "long" };
  } else if (date.getFullYear() == today.getFullYear()) { // this year
    dateDetails = { month: "2-digit", day: "2-digit" };
    if (fullDate) {
      dateDetails = Object.assign({}, fullDate);
      dateDetails.year = undefined;
    }
  } else { // full date
    dateDetails = fullDate ?? { year: "numeric", month: "2-digit", day: "2-digit" };
  }
  return date.toLocaleString(getDateTimeLocale(), dateDetails);
}

export function getFormattedDateString(date: Date, dateDetails: Intl.DateTimeFormatOptions): string {
  if (!date) {
    return "";
  }
  return date.toLocaleString(getDateTimeLocale(), dateDetails);
}

/** @returns Time, e.g. "15:23" */
export function getTimeString(date: Date): string {
  if (!date) {
    return "";
  }
  return date.toLocaleString(getDateTimeLocale(), { hour: "numeric", minute: "numeric" });
}

/** @returns Time without AM/PM, e.g. "3:23" or "15:23".
 * For where the hour labels next to it already show AM/PM. */
export function getTimeStringWithoutAMPM(date: Date): string {
  if (!date) {
    return "";
  }
  return new Intl.DateTimeFormat(getDateTimeLocale(), { hour: "numeric", minute: "numeric" })
    .formatToParts(date)
    .filter(part => part.type != "dayPeriod")
    .map(part => part.value)
    .join("")
    .trim();
}

/**
 * @param weekday day of the week
 * @param form How long the name should be
 *    narrow = 1 char
 *    short = 2 chars
 *    long = full name
 * @return Name for the weekday, e.g. "Mo" or "Monday" */
export function weekdayLabel(weekday: number, form: "long" | "short" | "narrow") {
  let date = new Date(2010, 2, weekday);
  return date.toLocaleDateString(getDateTimeLocale(), { weekday: form });
};

/** Monday to Sunday, in order (sorted).
 *
 * If we ever want to support Sunday being the first day of the week,
 * simply change this to `[0, 1, 2, 3, 4, 5, 6]` at runtime. */
export const kAllWeekdays = [1, 2, 3, 4, 5, 6, 0];

/**
 * @param ianaTimezone IANA timezone, e.g. "Europe/Berlin"
 * @returns the city in English, for most timezones */
export function getTimezoneDisplay(ianaTimezone: string): string {
  return ianaTimezone.split("/").pop();
}
export function myTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
export function isSameTimezone(ianaTimezone: string, time: Date) {
  if (!ianaTimezone) {
    return true;
  }
  let summer = new Date(time);
  summer.setMonth(summer.getMonth() + 6);
  let tz = {
    timeZone: ianaTimezone,
  };
  return time.toLocaleString("de") == time.toLocaleString("de", tz) &&
    summer.toLocaleString("de") == summer.toLocaleString("de", tz);
}

export function getToday() {
  return getDayStart(new Date());
}

/** @returns The day that contains `date`, at 00:00 */
export function getDayStart(date: Date): Date {
  let startTime = new Date(date);
  startTime.setHours(0, 0, 0, 0);
  return startTime;
}

/** @returns The Monday of the week that contains `date`, at 00:00 */
export function getWeekStart(date: Date): Date {
  let startTime = getDayStart(date);
  // `getDay()` is 0 on Sunday, which still belongs to the Monday before it
  startTime.setDate(startTime.getDate() - (startTime.getDay() + 6) % 7);
  return startTime;
}

/** @returns Mon-Sun around `start` */
export function getWeekDays(start: Date): Date[] {
  let startTime = getWeekStart(start);
  let weekDays = [];
  for (let i = 0; i < 7; i++) {
    weekDays.push(new Date(startTime));
    startTime.setDate(startTime.getDate() + 1)
  }
  return weekDays;
}

export function getDurationString(durationInMS: number): string {
  let durationInSec = durationInMS / 1000;
  if (!durationInMS) {
    return "";
  } else if (durationInSec % k1DayS == 0) {
    let days = durationInSec / k1DayS;
    return Math.round(days) + " " + gPlural(days, { one: 'day', other: 'days' });
  } else if (durationInSec % k1HourS == 0) {
    let hours = durationInSec / k1HourS;
    return Math.round(hours) + " " + gPlural(hours, { one: 'hour', other: 'hours' });
  } else {
    let minutes = durationInSec / k1MinuteS;
    return Math.round(minutes) + " " + gPlural(minutes, { one: 'min', other: 'mins' });
  }
}

/** 1 day, in seconds */
export const k1MinuteS = 60;
export const k1HourS = 3600;
export const k1DayS = 86400;
export const k1WeekS = 7 * k1DayS;
export const k1MonthS = 31 * k1DayS;
/** 1 day, in milliseconds */
export const k1MinuteMS = k1MinuteS * 1000;
export const k1HourMS = k1HourS * 1000;
export const k1DayMS = k1DayS * 1000;
export const k1WeekMS = k1WeekS * 1000;
export const k1MonthMS = k1MonthS * 1000;

export interface TimeInterval {
  startTime: Date;
  endTime: Date;
}
