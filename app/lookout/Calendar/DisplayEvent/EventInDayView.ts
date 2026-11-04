import type { Event } from "../../../logic/Calendar/Event";
import { TimeColumnLayout } from "../DayView/DayColumn";
import { EventLook } from "./EventLook";
import { k1DayMS } from "../../../logic/util/date";

export interface DayPreviewItem {
  event: Event;
  look: EventLook;
  isCurrent: boolean;
  lane: number;
  lanes: number;
  top: number;
  height: number;
}

export class DayPreviewLayout {
  readonly event: Event;
  readonly day: Date;
  readonly hours: number[] = [];
  readonly timedItems: DayPreviewItem[] = [];
  readonly allDayItems: DayPreviewItem[] = [];

  constructor(event: Event, calendarEvents: Iterable<Event>, hourHeight: number) {
    this.event = event;
    let start = event.startTime;
    this.day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    let events = this.eventsOfDay(calendarEvents);
    this.fillHours();
    this.layOut(events, hourHeight);
  }

  isCurrent(dayEvent: Event): boolean {
    let event = this.event;
    return dayEvent == event ||
      dayEvent.isSameUID(event) && dayEvent.startTime?.getTime() == event.startTime.getTime();
  }

  protected eventsOfDay(calendarEvents: Iterable<Event>): Event[] {
    let day = this.day;
    let dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    let events: Event[] = [];
    for (let dayEvent of calendarEvents) {
      if (dayEvent.startTime < dayEnd && dayEvent.endTime > day && !dayEvent.recurrenceRule) {
        events.push(dayEvent);
      }
    }
    if (!events.some(dayEvent => this.isCurrent(dayEvent))) {
      events.push(this.event);
    }
    return events;
  }

  protected fillHours() {
    const kMinHours = 3;
    let event = this.event;
    if (event.allDay) {
      return;
    }
    let startHour = event.startTime.getHours();
    let endMinutes = (event.endTime.getTime() - this.day.getTime()) / 60000;
    let endHour = Math.min(24, Math.ceil(endMinutes / 60));
    let first = Math.max(0, startHour - 1);
    let last = Math.min(24, Math.max(endHour + 1, first + kMinHours));
    first = Math.max(0, Math.min(first, last - kMinHours));
    for (let hour = first; hour < last; hour++) {
      this.hours.push(hour);
    }
  }

  protected layOut(events: Event[], hourHeight: number) {
    const kMinDurationMinutes = 20;
    let timedEvents: Event[] = [];
    for (let dayEvent of events) {
      // <copied from="../DayView/DayViewGrid.svelte">
      let isInAllDayArea = dayEvent.allDay || dayEvent.endTime.getTime() - dayEvent.startTime.getTime() >= k1DayMS;
      // </copied>
      if (isInAllDayArea) {
        this.allDayItems.push({ event: dayEvent, look: new EventLook(dayEvent), isCurrent: this.isCurrent(dayEvent), lane: 0, lanes: 1, top: 0, height: 0 });
      } else {
        timedEvents.push(dayEvent);
      }
    }
    if (!this.hours.length) {
      return;
    }
    let pxPerMinute = hourHeight / 60;
    let firstMinute = this.hours[0] * 60;
    let lastMinute = (this.hours[this.hours.length - 1] + 1) * 60;
    for (let item of new TimeColumnLayout(timedEvents, this.day, kMinDurationMinutes).items) {
      if (item.endMinute <= firstMinute || item.startMinute >= lastMinute) {
        continue;
      }
      let start = Math.max(item.startMinute, firstMinute);
      let end = Math.min(item.endMinute, lastMinute);
      this.timedItems.push({
        event: item.event,
        look: new EventLook(item.event),
        isCurrent: this.isCurrent(item.event),
        lane: item.lane,
        lanes: item.lanes,
        top: (start - firstMinute) * pxPerMinute,
        height: (end - start) * pxPerMinute,
      });
    }
  }
}
