import { getDateTimeLocale } from "../../../l10n/l10n";

export function getListDateString(date: Date, now = new Date()): string {
  if (!date) {
    return "";
  }
  const k1DayMS = 24 * 60 * 60 * 1000;
  let todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  let options: Intl.DateTimeFormatOptions;
  if (date >= todayStart && date.getTime() < todayStart.getTime() + k1DayMS) {
    options = { hour: "numeric", minute: "2-digit" };
  } else if (date < todayStart && date.getTime() >= todayStart.getTime() - 6 * k1DayMS) {
    options = { weekday: "short", hour: "numeric", minute: "2-digit" };
  } else if (date.getFullYear() == now.getFullYear()) {
    options = { weekday: "short", month: "numeric", day: "numeric" };
  } else {
    options = { year: "numeric", month: "numeric", day: "numeric" };
  }
  return date.toLocaleString(getDateTimeLocale(), options);
}

export function getFullDateString(date: Date): string {
  if (!date) {
    return "";
  }
  return date.toLocaleString(getDateTimeLocale(), {
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
