/** Browsers have no date formats for Latin (there is no CLDR data for `la`),
 * so they show month and weekday names, "AM" and "PM" in English.
 *
 * The app passes `getDateTimeLocale()` to `Intl.DateTimeFormat` and
 * `Date.toLocale*String()` in many places, so we wrap these for `la`:
 * They format like British English (day before month, 24 hours),
 * and we replace the month and weekday names with the Latin ones. */
export function addLatinDates() {
  const BrowserDateTimeFormat = Intl.DateTimeFormat;
  function DateTimeFormat(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    return locales == "la"
      ? new LatinDateTimeFormat(options)
      : new BrowserDateTimeFormat(locales, options);
  }
  DateTimeFormat.prototype = BrowserDateTimeFormat.prototype;
  DateTimeFormat.supportedLocalesOf = BrowserDateTimeFormat.supportedLocalesOf;
  Intl.DateTimeFormat = DateTimeFormat as Intl.DateTimeFormatConstructor;

  const { toLocaleString, toLocaleDateString, toLocaleTimeString } = Date.prototype;
  const kDate = ["weekday", "year", "month", "day"];
  const kTime = ["hour", "minute", "second"];
  Date.prototype.toLocaleString = function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    return locales == "la"
      ? new LatinDateTimeFormat(withDefaults(options, kDate.concat(kTime))).format(this)
      : toLocaleString.call(this, locales, options);
  };
  Date.prototype.toLocaleDateString = function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    return locales == "la"
      ? new LatinDateTimeFormat(withDefaults(options, kDate)).format(this)
      : toLocaleDateString.call(this, locales, options);
  };
  Date.prototype.toLocaleTimeString = function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    return locales == "la"
      ? new LatinDateTimeFormat(withDefaults(options, kTime)).format(this)
      : toLocaleTimeString.call(this, locales, options);
  };
}

/** Like `Date.toLocale*String()`: If `options` asks for none of the `fields`,
 * show them all as numbers, except the weekday. */
function withDefaults(options: Intl.DateTimeFormatOptions = {}, fields: string[]): Intl.DateTimeFormatOptions {
  if (options.dateStyle || options.timeStyle || fields.some(field => options[field])) {
    return options;
  }
  let defaults = fields.filter(field => field != "weekday").map(field => [field, "numeric"]);
  return { ...Object.fromEntries(defaults), ...options };
}

class LatinDateTimeFormat extends Intl.DateTimeFormat {
  constructor(options?: Intl.DateTimeFormatOptions) {
    super("en-GB", options);
  }

  format(date?: Date | number): string {
    return this.formatToParts(date).map(part => part.value).join("");
  }

  formatToParts(date?: Date | number): Intl.DateTimeFormatPart[] {
    let parts = super.formatToParts(date);
    return this.latin(parts, new Date(date ?? Date.now()), parts.some(part => part.type == "day"));
  }

  formatRange(start: Date | number, end: Date | number): string {
    return this.formatRangeToParts(start, end).map(part => part.value).join("");
  }

  formatRangeToParts(start: Date | number, end: Date | number): Intl.DateTimeRangeFormatPart[] {
    let parts = super.formatRangeToParts(start, end);
    let withDay = parts.some(part => part.type == "day");
    let startParts = this.latin(parts, new Date(start), withDay);
    let endParts = this.latin(parts, new Date(end), withDay);
    return parts.map((part, i) => part.source == "endRange" ? endParts[i] : startParts[i]);
  }

  /** @param withDay In a date like "15 Novembris", the month is genitive */
  protected latin<Part extends Intl.DateTimeFormatPart>(parts: Part[], date: Date, withDay: boolean): Part[] {
    // With `dateStyle`, the browser doesn't tell the month and weekday form
    let { timeZone, dateStyle, month = dateStyle == "medium" ? "short" : "long", weekday = "long" } = this.resolvedOptions();
    // The day in our time zone, e.g. "2026-11-15", at 00:00 UTC
    let day = new Date(date.toLocaleDateString("lt", { timeZone }));
    let monthNames = {
      long: withDay
        ? ["Ianuarii", "Februarii", "Martii", "Aprilis", "Maii", "Iunii", "Iulii", "Augusti", "Septembris", "Octobris", "Novembris", "Decembris"]
        : ["Ianuarius", "Februarius", "Martius", "Aprilis", "Maius", "Iunius", "Iulius", "Augustus", "September", "October", "November", "December"],
      short: ["Ian.", "Feb.", "Mart.", "Apr.", "Mai.", "Iun.", "Iul.", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."],
      narrow: ["I", "F", "M", "A", "M", "I", "I", "A", "S", "O", "N", "D"],
    };
    // From Sunday, as in `Date.getDay()`
    let weekdayNames = {
      long: ["dies Solis", "dies Lunae", "dies Martis", "dies Mercurii", "dies Iovis", "dies Veneris", "dies Saturni"],
      short: ["Sol.", "Lun.", "Mart.", "Merc.", "Iov.", "Ven.", "Sat."],
      narrow: ["S", "L", "M", "M", "I", "V", "S"],
    };
    return parts.map(part =>
      part.type == "month" && isNaN(Number(part.value)) ? { ...part, value: monthNames[month][day.getUTCMonth()] } :
      part.type == "weekday" ? { ...part, value: weekdayNames[weekday][day.getUTCDay()] } :
      part.type == "literal" && part.value == " at " ? { ...part, value: ", " } : // Between date and time
      part);
  }
}
