export class Timeline {
  readonly day: Date;
  readonly hourWidth: number;
  readonly dayCount: number;

  constructor(day: Date, hourWidth = 88, dayCount = 1) {
    this.day = new Date(day);
    this.day.setHours(0, 0, 0, 0);
    this.hourWidth = hourWidth;
    this.dayCount = Math.max(1, dayCount);
  }

  get width(): number {
    return 24 * this.dayCount * this.hourWidth;
  }

  get dayEnd(): Date {
    let end = new Date(this.day);
    end.setDate(end.getDate() + this.dayCount);
    return end;
  }

  days(): Date[] {
    return Array.from({ length: this.dayCount }, (_, index) =>
      new Date(this.day.getFullYear(), this.day.getMonth(), this.day.getDate() + index));
  }

  hours(): Date[] {
    let hours: Date[] = [];
    for (let day of this.days()) {
      for (let hour = 0; hour < 24; hour++) {
        let time = new Date(day);
        time.setHours(hour);
        hours.push(time);
      }
    }
    return hours;
  }

  x(time: Date): number {
    if (time <= this.day) {
      return 0;
    }
    if (time >= this.dayEnd) {
      return this.width;
    }
    const kDayMS = 24 * 60 * 60 * 1000;
    let startOfDay = new Date(time.getFullYear(), time.getMonth(), time.getDate());
    let dayIndex = Math.round((startOfDay.getTime() - this.day.getTime()) / kDayMS);
    return (dayIndex * 24 + time.getHours() + time.getMinutes() / 60 + time.getSeconds() / 3600) * this.hourWidth;
  }

  span(from: Date, to: Date): { left: number, width: number } | null {
    if (to <= this.day || from >= this.dayEnd || to < from) {
      return null;
    }
    let left = this.x(from);
    return { left, width: Math.max(this.x(to) - left, 0) };
  }

  timeAt(x: number, snapMinutes = 30): Date {
    let minutes = Math.min(Math.max(x, 0), this.width) / this.hourWidth * 60;
    return this.timeAfter(Math.round(minutes / snapMinutes) * snapMinutes);
  }

  slotAt(x: number, snapMinutes = 30): Date {
    let minutes = Math.min(Math.max(x, 0), this.width - 1) / this.hourWidth * 60;
    return this.timeAfter(Math.floor(minutes / snapMinutes) * snapMinutes);
  }

  protected timeAfter(minutes: number): Date {
    const kDayMinutes = 24 * 60;
    let dayIndex = Math.floor(minutes / kDayMinutes);
    let time = new Date(this.day.getFullYear(), this.day.getMonth(), this.day.getDate() + dayIndex);
    time.setMinutes(minutes - dayIndex * kDayMinutes);
    return time;
  }
}
