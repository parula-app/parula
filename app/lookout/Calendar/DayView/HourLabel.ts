export class HourLabel {
  readonly format: Intl.DateTimeFormat;
  protected readonly withMinutes: Intl.DateTimeFormat;
  protected readonly minuteFormat: Intl.DateTimeFormat;

  constructor(locale: string, timeZone?: string) {
    let hourCycle = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle;
    let is12Hour = hourCycle == "h11" || hourCycle == "h12";
    this.format = is12Hour
      ? new Intl.DateTimeFormat(locale, { hour: "numeric", timeZone })
      : new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
    this.withMinutes = is12Hour
      ? new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone })
      : this.format;
    this.minuteFormat = new Intl.DateTimeFormat("en-US", { minute: "numeric", timeZone });
  }

  label(hour: number): string {
    return this.format.format(new Date(2000, 0, 1, hour));
  }

  labelAt(time: Date): string {
    let minute = parseInt(this.minuteFormat.format(time), 10);
    return minute ? this.withMinutes.format(time) : this.format.format(time);
  }
}
