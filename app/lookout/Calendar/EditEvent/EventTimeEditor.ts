import type { Event } from "../../../logic/Calendar/Event";
import { setNewEventTime } from "../../../frontend/Calendar/event";

export class EventTimeEditor {
  readonly event: Event;
  protected previousTimezone: string = null;
  protected previousStartTime: Date = null;
  protected previousEndTime: Date = null;

  constructor(event: Event) {
    this.event = event;
  }

  static lastDay(event: Event): Date {
    let lastDay = new Date(event.endTime);
    if (event.allDay) {
      lastDay.setDate(lastDay.getDate() - 1);
      if (lastDay < event.startTime) {
        lastDay = new Date(event.startTime);
      }
    }
    return lastDay;
  }

  // <copied from="../../../frontend/Calendar/EditEvent/TimeBox.svelte" onStartTimeChanged()>
  setStart(newStart: Date) {
    let event = this.event;
    let duration = event.duration;
    event.startTime = newStart;
    event.duration = duration;
  }
  // </copied>

  setStartDate(day: Date) {
    let start = new Date(this.event.startTime);
    start.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    this.setStart(start);
  }

  setStartKeepingEnd(newStart: Date) {
    let event = this.event;
    if (newStart.getTime() >= event.endTime.getTime()) {
      return;
    }
    event.startTime = newStart;
  }

  moveTo(newStart: Date) {
    let event = this.event;
    if (event.allDay) {
      let day = new Date(newStart);
      day.setHours(0, 0, 0, 0);
      this.setStart(day);
    } else {
      this.setStart(newStart);
    }
  }

  setEnd(newEnd: Date) {
    let event = this.event;
    event.endTime = newEnd;
    this.checkEndTime();
  }

  setEndDate(day: Date) {
    let event = this.event;
    let end = new Date(event.endTime);
    end.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    if (event.allDay) {
      end.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() + 1);
    }
    this.setEnd(end);
  }

  // <copied from="../../../frontend/Calendar/EditEvent/TimeBox.svelte" checkEndTime()>, but allows appointments of 0 minutes, which the end time list offers
  checkEndTime() {
    let event = this.event;
    if (event.endTime.getTime() < event.startTime.getTime() ||
        event.allDay && event.endTime.getTime() == event.startTime.getTime()) {
      event.endTime.setTime(event.startTime.getTime());
      if (event.allDay) {
        event.durationDays += 1;
      } else {
        event.durationHours += 1;
      }
    }
  }
  // </copied>

  // <copied from="../../../frontend/Calendar/EditEvent/TimeBox.svelte" setAllDay()>
  setAllDay(allDay: boolean) {
    let event = this.event;
    if (event.allDay == allDay) {
      return;
    }
    event.allDay = allDay;
    if (allDay) {
      this.previousTimezone = event.timezone;
      event.timezone = null;
      this.previousStartTime = new Date(event.startTime);
      this.previousEndTime = new Date(event.endTime);
      EventTimeEditor.clearTime(event.startTime);
      EventTimeEditor.clearTime(event.endTime);
      // Advance to next midnight if the time is not already midnight. RFC 5545 section 3.6.1
      if (event.endTime.getTime() < this.previousEndTime.getTime()) {
        event.endTime.setDate(event.endTime.getDate() + 1);
      }
    } else {
      if (this.previousStartTime && this.previousEndTime) {
        EventTimeEditor.copyTimeOnly(event.startTime, this.previousStartTime);
        let endTime = event.endTime.getTime();
        EventTimeEditor.copyTimeOnly(event.endTime, this.previousEndTime);
        // Rewind to the previous day unless the time was midnight.
        if (event.endTime.getTime() > endTime) {
          event.endTime.setDate(event.endTime.getDate() - 1);
        }
      }
      if (this.previousTimezone) {
        event.timezone = this.previousTimezone;
      }
    }
    event.notifyObservers();
  }
  // </copied>

  setTimed() {
    let event = this.event;
    if (this.previousStartTime) {
      this.setAllDay(false);
      return;
    }
    let start = new Date(event.startTime);
    start.setHours(8, 0, 0, 0);
    // let start = WorkingHours.workStartOf(event.calendar, event.startTime);
    event.allDay = false;
    setNewEventTime(event, true, start);
  }

  // <copied from="../../../frontend/Calendar/EditEvent/TimeBox.svelte">

  static copyTimeOnly(target: Date, source: Date) {
    target.setHours(source.getHours());
    target.setMinutes(source.getMinutes());
    target.setSeconds(source.getSeconds());
    target.setMilliseconds(source.getMilliseconds());
  }

  static clearTime(target: Date) {
    target.setHours(0);
    target.setMinutes(0);
    target.setSeconds(0);
    target.setMilliseconds(0);
  }
  // </copied>
}
