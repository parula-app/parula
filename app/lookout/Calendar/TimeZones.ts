import { HourLabel } from "./DayView/HourLabel";
import { WindowsToIANATimezone } from "../../logic/Calendar/ICal/WindowsTimezone";
import { getDateTimeLocale, gt } from "../../l10n/l10n";
import { logErrorToServer } from "../../frontend/Util/error";

export class ZoneClock {
  readonly zone: string | undefined;
  protected readonly parts: Intl.DateTimeFormat;

  constructor(zone?: string) {
    this.zone = zone;
    this.parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
    });
  }

  static get systemZone(): string {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  wallClock(time: Date): { year: number, month: number, day: number, hour: number, minute: number } {
    let values: Record<string, number> = {};
    for (let part of this.parts.formatToParts(time)) {
      if (part.type != "literal") {
        values[part.type] = parseInt(part.value, 10);
      }
    }
    return { year: values.year, month: values.month, day: values.day, hour: values.hour % 24, minute: values.minute };
  }

  minuteOfDay(time: Date): number {
    let wall = this.wallClock(time);
    return wall.hour * 60 + wall.minute;
  }

  offsetMinutes(time: Date): number {
    let wall = this.wallClock(time);
    let wallAsUTC = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
    let utcMinute = Math.floor(time.getTime() / 60000) * 60000;
    return Math.round((wallAsUTC - utcMinute) / 60000);
  }

  standardOffsetMinutes(year: number): number {
    return Math.min(
      this.offsetMinutes(new Date(Date.UTC(year, 0, 1))),
      this.offsetMinutes(new Date(Date.UTC(year, 6, 1))));
  }
}

export interface RulerDateSegment {
  startMinute: number;
  endMinute: number;
  time: Date;
}

export class TimeZoneRuler {
  readonly zone: string | null;
  readonly label: string;
  protected readonly clock: ZoneClock;
  protected readonly hourLabel: HourLabel;
  readonly dateFormat: Intl.DateTimeFormat;
  protected readonly offsetFormat: Intl.DateTimeFormat;

  constructor(zone: string | null, label: string, locale: string) {
    this.zone = zone;
    this.label = label;
    this.clock = new ZoneClock(zone ?? undefined);
    this.hourLabel = new HourLabel(locale, zone ?? undefined);
    this.dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: zone ?? undefined });
    this.offsetFormat = new Intl.DateTimeFormat(locale, { timeZoneName: "shortOffset", timeZone: zone ?? undefined });
  }

  shownLabel(time: Date): string {
    return this.label || this.offsetFormat.formatToParts(time).find(part => part.type == "timeZoneName")?.value || "";
  }

  get isPrimary(): boolean {
    return !this.zone;
  }

  hourLabelOn(day: Date, hour: number): string {
    if (this.isPrimary) {
      return this.hourLabel.label(hour);
    }
    return this.hourLabel.labelAt(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour));
  }

  hourLabels(day: Date): string[] {
    return Array.from({ length: 24 }, (_, hour) => this.hourLabelOn(day, hour));
  }

  dateSegments(days: Date[]): RulerDateSegment[] {
    const kMinutesPerDay = 24 * 60;
    let segments: RulerDateSegment[] = [];
    let start = days[0];
    for (let d = 0; d < days.length; d++) {
      for (let hour = 0; hour < 24; hour++) {
        let hourStart = d * kMinutesPerDay + hour * 60;
        let time = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d, hour);
        let toMidnight = this.isPrimary
          ? (hour == 0 ? 0 : -1)
          : (kMinutesPerDay - this.clock.minuteOfDay(time)) % kMinutesPerDay;
        if (hourStart == 0) {
          segments.push({ startMinute: 0, endMinute: 0, time });
        }
        if (toMidnight >= 0 && toMidnight < 60 && hourStart + toMidnight > 0) {
          segments.push({ startMinute: hourStart + toMidnight, endMinute: 0, time: new Date(time.getTime() + toMidnight * 60000) });
        }
      }
    }
    for (let i = 0; i < segments.length; i++) {
      segments[i].endMinute = segments[i + 1]?.startMinute ?? days.length * kMinutesPerDay;
    }
    return segments;
  }

  static ofZones(label: string, extraZones: { shown: boolean, zone: string, label: string }[], locale = getDateTimeLocale()): TimeZoneRuler[] {
    let rulers: TimeZoneRuler[] = [];
    for (let extra of extraZones) {
      if (!extra.shown || !extra.zone) {
        continue;
      }
      try {
        rulers.push(new TimeZoneRuler(extra.zone, extra.label, locale));
      } catch (ex) {
        logErrorToServer(ex);
      }
    }
    rulers.push(new TimeZoneRuler(null, label, locale));
    return rulers;
  }

}

export class TimeZoneChoice {
  readonly zone: string;
  readonly label: string;
  readonly standardOffset: number;

  constructor(zone: string, locale: string, year = new Date().getFullYear()) {
    this.zone = zone;
    this.standardOffset = new ZoneClock(zone).standardOffsetMinutes(year);
    this.label = zone == "Etc/UTC" || zone == "UTC"
      ? `(UTC) ${gt`Coordinated Universal Time`}`
      : `(${TimeZoneChoice.offsetText(this.standardOffset)}) ${TimeZoneChoice.zoneName(zone, locale, year)}`;
  }

  static offsetText(offsetMinutes: number): string {
    let hours = Math.floor(Math.abs(offsetMinutes) / 60);
    let minutes = Math.abs(offsetMinutes) % 60;
    let sign = offsetMinutes < 0 ? "-" : "+";
    return `UTC${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  static zoneName(zone: string, locale: string, year: number): string {
    let city = zone.includes("/") && !zone.startsWith("Etc/")
      ? zone.substring(zone.lastIndexOf("/") + 1).replaceAll("_", " ")
      : null;
    let genericName = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "longGeneric" })
      .formatToParts(new Date(Date.UTC(year, 0, 1)))
      .find(part => part.type == "timeZoneName")?.value;
    let hasName = genericName && !/^(GMT|UTC)([+−-]|$)/.test(genericName);
    if (hasName && city) {
      return gt`${genericName} (${city})`;
    }
    return hasName ? genericName : city ?? zone;
  }

  static all(locale = getDateTimeLocale(), alsoInclude: string[] = []): TimeZoneChoice[] {
    let zones = new Set(Object.values(WindowsToIANATimezone)
      .filter(zone => !zone.startsWith("Etc/") || zone == "Etc/UTC"));
    for (let zone of alsoInclude) {
      if (zone) {
        zones.add(zone);
      }
    }
    let choices: TimeZoneChoice[] = [];
    for (let zone of zones) {
      try {
        choices.push(new TimeZoneChoice(zone, locale));
      } catch (ex) {
        logErrorToServer(ex);
      }
    }
    return choices.sort((a, b) => a.standardOffset - b.standardOffset || a.label.localeCompare(b.label));
  }
}
