/** Browsers have no date formats for Latin and Klingon (there is no CLDR data
 * for `la` and `tlh`), so they show month and weekday names, "AM" and "PM" in English.
 *
 * The app passes `getDateTimeLocale()` to `Intl.DateTimeFormat` and
 * `Date.toLocale*String()` in many places, so we wrap these for these languages:
 * They format like British English (day before month, 24 hours),
 * and we replace the month and weekday names with ours.
 *
 * Only when the user chose one of these languages for dates.
 * For all other languages, the browser's functions stay unchanged.
 *
 * @param locale The language for dates */
export function addDateNames(locale: string) {
  if (!dateTimeFormatClass(locale) || Intl.DateTimeFormat != BrowserDateTimeFormat) { // Already added
    return;
  }
  function DateTimeFormat(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    let NamedFormat = dateTimeFormatClass(locales);
    return NamedFormat
      ? new NamedFormat(options)
      : new BrowserDateTimeFormat(locales, options);
  }
  DateTimeFormat.prototype = BrowserDateTimeFormat.prototype;
  DateTimeFormat.supportedLocalesOf = BrowserDateTimeFormat.supportedLocalesOf;
  Intl.DateTimeFormat = DateTimeFormat as Intl.DateTimeFormatConstructor;

  const { toLocaleString, toLocaleDateString, toLocaleTimeString } = Date.prototype;
  const kDate = ["weekday", "year", "month", "day"];
  const kTime = ["hour", "minute", "second"];
  Date.prototype.toLocaleString = function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    let NamedFormat = dateTimeFormatClass(locales);
    return NamedFormat
      ? new NamedFormat(options, kDate.concat(kTime)).format(this)
      : toLocaleString.call(this, locales, options);
  };
  Date.prototype.toLocaleDateString = function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    let NamedFormat = dateTimeFormatClass(locales);
    return NamedFormat
      ? new NamedFormat(options, kDate).format(this)
      : toLocaleDateString.call(this, locales, options);
  };
  Date.prototype.toLocaleTimeString = function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    let NamedFormat = dateTimeFormatClass(locales);
    return NamedFormat
      ? new NamedFormat(options, kTime).format(this)
      : toLocaleTimeString.call(this, locales, options);
  };
}

const BrowserDateTimeFormat = Intl.DateTimeFormat;

/** @returns Our class for this language, or null for the browser's */
function dateTimeFormatClass(locales: Intl.LocalesArgument) {
  return locales == "la" ? LatinDateTimeFormat
    : locales == "tlh" ? KlingonHolDateTimeFormat
    : locales == "tlh-Piqd" ? KlingonPIqaDDateTimeFormat
    : null;
}

/** Formats like British English, with our month and weekday names */
abstract class NamedDateTimeFormat extends Intl.DateTimeFormat {
  /** January to December, by the `month` option. `afterDay` is the long form
   * in a date, e.g. "15 Novembris" in Latin. Missing forms fall back to `long`. */
  protected abstract months: { long: string[], afterDay?: string[], short?: string[], narrow?: string[] };
  /** Sunday to Saturday, as in `Date.getDay()`, by the `weekday` option.
   * Missing forms fall back to `long`. */
  protected abstract weekdays: { long: string[], short?: string[], narrow?: string[] };
  /** For the day in our time zone */
  protected readonly numeric: Intl.DateTimeFormat;

  /** @param defaults Like `Date.toLocale*String()`: If `options` asks for none of these fields,
   * show them all as numbers, except the weekday. */
  constructor(options: Intl.DateTimeFormatOptions = {}, defaults: string[] = []) {
    if (!options.dateStyle && !options.timeStyle && !defaults.some(field => options[field])) {
      options = { ...Object.fromEntries(defaults.filter(field => field != "weekday").map(field => [field, "numeric"])), ...options };
    }
    super("en-GB", options);
    this.numeric = new BrowserDateTimeFormat("en-GB", { timeZone: this.resolvedOptions().timeZone, year: "numeric", month: "numeric", day: "numeric" });
    // Bound, like the browser's, so that `dates.map(formatter.format)` works
    this.format = this.format.bind(this);
  }

  format(date?: Date | number): string {
    return this.formatToParts(date).map(part => part.value).join("");
  }

  formatToParts(date?: Date | number): Intl.DateTimeFormatPart[] {
    let parts = super.formatToParts(date);
    return this.withNames(parts, date, parts.some(part => part.type == "day"));
  }

  formatRange(start: Date | number, end: Date | number): string {
    return this.formatRangeToParts(start, end).map(part => part.value).join("");
  }

  formatRangeToParts(start: Date | number, end: Date | number): Intl.DateTimeRangeFormatPart[] {
    let parts = super.formatRangeToParts(start, end);
    let withDay = parts.some(part => part.type == "day");
    let startParts = this.withNames(parts, start, withDay);
    let endParts = this.withNames(parts, end, withDay);
    return parts.map((part, i) => part.source == "endRange" ? endParts[i] : startParts[i]);
  }

  protected withNames<Part extends Intl.DateTimeFormatPart>(parts: Part[], date: Date | number | undefined, withDay: boolean): Part[] {
    // With `dateStyle`, the browser doesn't tell the month and weekday form
    let { dateStyle, month = dateStyle == "medium" ? "short" : "long", weekday = "long" } = this.resolvedOptions();
    let months = this.months[month == "long" && withDay ? "afterDay" : month] ?? this.months.long;
    let weekdays = this.weekdays[weekday] ?? this.weekdays.long;
    // The day in our time zone, at 00:00 UTC
    let { year, month: monthNumber, day } = Object.fromEntries(this.numeric.formatToParts(date).map(part => [part.type, Number(part.value)]));
    let utcDay = new Date(Date.UTC(year, monthNumber - 1, day));
    return parts.map(part =>
      part.type == "month" && isNaN(Number(part.value)) ? { ...part, value: months[utcDay.getUTCMonth()] } :
      part.type == "weekday" ? { ...part, value: weekdays[utcDay.getUTCDay()] } :
      part.type == "literal" && part.value == " at " ? { ...part, value: ", " } : // Between date and time
      part);
  }
}

class LatinDateTimeFormat extends NamedDateTimeFormat {
  protected months = {
    long: ["Ianuarius", "Februarius", "Martius", "Aprilis", "Maius", "Iunius", "Iulius", "Augustus", "September", "October", "November", "December"],
    afterDay: ["Ianuarii", "Februarii", "Martii", "Aprilis", "Maii", "Iunii", "Iulii", "Augusti", "Septembris", "Octobris", "Novembris", "Decembris"],
    short: ["Ian.", "Feb.", "Mart.", "Apr.", "Mai.", "Iun.", "Iul.", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."],
    narrow: ["I", "F", "M", "A", "M", "I", "I", "A", "S", "O", "N", "D"],
  };
  protected weekdays = {
    // Capital, because they often stand alone, e.g. in the mail list next to "Heri"
    long: ["Dies Solis", "Dies Lunae", "Dies Martis", "Dies Mercurii", "Dies Iovis", "Dies Veneris", "Dies Saturni"],
    short: ["Sol.", "Lun.", "Mart.", "Merc.", "Iov.", "Ven.", "Sat."],
    narrow: ["S", "L", "M", "M", "I", "V", "S"],
  };
}

/** Earth dates in Klingon, as on the invitation to "Star Trek: The Exhibition":
 * "jaj wa', jar wa'" for "Sunday, January". The Klingon week has 6 days,
 * and further days are numbered, so Sunday is "day one".
 * Klingon has no short forms. */
class KlingonHolDateTimeFormat extends NamedDateTimeFormat {
  protected months = {
    long: ["jar wa'", "jar cha'", "jar wej", "jar loS", "jar vagh", "jar jav", "jar Soch", "jar chorgh", "jar Hut", "jar wa'maH", "jar wa'maH wa'", "jar wa'maH cha'"],
  };
  protected weekdays = {
    long: ["jaj wa'", "DaSjaj", "povjaj", "ghItlhjaj", "loghjaj", "buqjaj", "ghInjaj"],
  };
}

/** `KlingonHolDateTimeFormat` in the pIqaD script, see `transliteratePIqaD.ts` */
class KlingonPIqaDDateTimeFormat extends NamedDateTimeFormat {
  protected months = {
    long: ["\uF8D8\uF8D0\uF8E1 \uF8E7\uF8D0\uF8E9", "\uF8D8\uF8D0\uF8E1 \uF8D2\uF8D0\uF8E9", "\uF8D8\uF8D0\uF8E1 \uF8E7\uF8D4\uF8D8", "\uF8D8\uF8D0\uF8E1 \uF8D9\uF8DD\uF8E2", "\uF8D8\uF8D0\uF8E1 \uF8E6\uF8D0\uF8D5", "\uF8D8\uF8D0\uF8E1 \uF8D8\uF8D0\uF8E6", "\uF8D8\uF8D0\uF8E1 \uF8E2\uF8DD\uF8D2", "\uF8D8\uF8D0\uF8E1 \uF8D2\uF8DD\uF8E1\uF8D5", "\uF8D8\uF8D0\uF8E1 \uF8D6\uF8E5\uF8E3", "\uF8D8\uF8D0\uF8E1 \uF8E7\uF8D0\uF8E9\uF8DA\uF8D0\uF8D6", "\uF8D8\uF8D0\uF8E1 \uF8E7\uF8D0\uF8E9\uF8DA\uF8D0\uF8D6 \uF8E7\uF8D0\uF8E9", "\uF8D8\uF8D0\uF8E1 \uF8E7\uF8D0\uF8E9\uF8DA\uF8D0\uF8D6 \uF8D2\uF8D0\uF8E9"],
  };
  protected weekdays = {
    long: ["\uF8D8\uF8D0\uF8D8 \uF8E7\uF8D0\uF8E9", "\uF8D3\uF8D0\uF8E2\uF8D8\uF8D0\uF8D8", "\uF8DE\uF8DD\uF8E6\uF8D8\uF8D0\uF8D8", "\uF8D5\uF8D7\uF8E4\uF8D8\uF8D0\uF8D8", "\uF8D9\uF8DD\uF8D5\uF8D8\uF8D0\uF8D8", "\uF8D1\uF8E5\uF8DF\uF8D8\uF8D0\uF8D8", "\uF8D5\uF8D7\uF8DB\uF8D8\uF8D0\uF8D8"],
  };
}
