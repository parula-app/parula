import { getDateTimeLocale, gt } from "../../../l10n/l10n";
import { UserError } from "../../../logic/util/util";

export function formatDateText(date: Date, locale = getDateTimeLocale()): string {
  if (!date || isNaN(date.getTime())) {
    return "";
  }
  let weekday = date.toLocaleDateString(locale, { weekday: "short" });
  let day = date.toLocaleDateString(locale, { year: "numeric", month: "numeric", day: "numeric" });
  return weekday + " " + day;
}

export function parseDateText(text: string, reference: Date, locale = getDateTimeLocale()): Date {
  let numbers = text.replace(/^\s*[^\d\s]+[.,]?\s*/u, "").match(/\d+/g)?.map(Number) ?? [];
  if (!numbers.length || numbers.length > 3) {
    throw new UserError(gt`Could not interpret ${text} as a date`);
  }
  let order = dateFieldOrder(locale).filter(field => numbers.length == 3 || field != "year");
  let parts = { year: reference.getFullYear(), month: reference.getMonth() + 1, day: numbers[0] };
  if (numbers.length > 1) {
    order.forEach((field, i) => parts[field] = numbers[i]);
  }
  if (numbers.length == 3 && parts.year < 100) {
    parts.year += 2000;
  }
  let date = new Date(reference);
  date.setFullYear(parts.year, parts.month - 1, parts.day);
  if (date.getDate() != parts.day || date.getMonth() != parts.month - 1) {
    throw new UserError(gt`Could not interpret ${text} as a date`);
  }
  return date;
}

export function dateFieldOrder(locale: string): ("year" | "month" | "day")[] {
  let parts = new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(new Date(2001, 10, 22));
  return parts
    .map(part => part.type)
    .filter(type => type == "year" || type == "month" || type == "day") as ("year" | "month" | "day")[];
}
