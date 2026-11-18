import type { Event } from "../../../logic/Calendar/Event";
import { k1DayMS } from "../../../logic/util/date";

export class ScheduleItem {
  readonly event: Event;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly continuesBefore: boolean;
  readonly continuesAfter: boolean;
  lane = 0;

  constructor(event: Event, startMinute: number, endMinute: number, continuesBefore: boolean, continuesAfter: boolean) {
    this.event = event;
    this.startMinute = startMinute;
    this.endMinute = endMinute;
    this.continuesBefore = continuesBefore;
    this.continuesAfter = continuesAfter;
  }
}

export class ScheduleLayout {
  static readonly kMinutesPerDay = 24 * 60;
  readonly start: Date;
  readonly dayCount: number;
  readonly items: ScheduleItem[] = [];
  laneCount = 0;

  constructor(events: Event[], days: Date[]) {
    this.start = new Date(days[0].getFullYear(), days[0].getMonth(), days[0].getDate());
    this.dayCount = days.length;
    let totalMinutes = this.totalMinutes;
    for (let event of events) {
      let startMinute = this.minuteOf(event.startTime);
      let endMinute = this.minuteOf(event.endTime);
      if (endMinute <= 0 || startMinute >= totalMinutes) {
        continue;
      }
      endMinute = Math.max(endMinute, startMinute + 1);
      this.items.push(new ScheduleItem(event,
        Math.max(startMinute, 0), Math.min(endMinute, totalMinutes),
        startMinute < 0, endMinute > totalMinutes));
    }
    this.items.sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);
    let laneEnds: number[] = [];
    for (let item of this.items) {
      let lane = laneEnds.findIndex(end => end <= item.startMinute);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      item.lane = lane;
      laneEnds[lane] = item.endMinute;
    }
    this.laneCount = laneEnds.length;
  }

  get totalMinutes(): number {
    return this.dayCount * ScheduleLayout.kMinutesPerDay;
  }

  // Each day counts as 24 hours, also on daylight saving days, so that all days have the same width
  minuteOf(time: Date): number {
    let day = new Date(time.getFullYear(), time.getMonth(), time.getDate());
    let dayIndex = Math.round((day.getTime() - this.start.getTime()) / k1DayMS);
    return dayIndex * ScheduleLayout.kMinutesPerDay + time.getHours() * 60 + time.getMinutes();
  }

  timeAt(minute: number): Date {
    let dayIndex = Math.floor(minute / ScheduleLayout.kMinutesPerDay);
    let minuteOfDay = minute - dayIndex * ScheduleLayout.kMinutesPerDay;
    return new Date(this.start.getFullYear(), this.start.getMonth(), this.start.getDate() + dayIndex, 0, minuteOfDay);
  }
}
