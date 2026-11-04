export function dateTimeFormats(date: Date, locale: string): string[] {
  const kOptions: Intl.DateTimeFormatOptions[] = [
    { dateStyle: "short" },
    { dateStyle: "full" },
    { dateStyle: "long" },
    { dateStyle: "medium" },
    { day: "numeric", month: "long", year: "numeric" },
    { day: "2-digit", month: "short", year: "2-digit" },
    { month: "long", year: "numeric" },
    { month: "short", year: "2-digit" },
    { dateStyle: "short", timeStyle: "short" },
    { dateStyle: "short", timeStyle: "medium" },
    { timeStyle: "short" },
    { timeStyle: "medium" },
    { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
    { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" },
  ];
  let formats = kOptions.map(options => new Intl.DateTimeFormat(locale, options).format(date));
  formats.splice(4, 0, isoDate(date));
  return [...new Set(formats)];
}

function isoDate(date: Date): string {
  let month = String(date.getMonth() + 1).padStart(2, "0");
  let day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
