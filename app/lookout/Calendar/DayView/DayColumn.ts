import type { Event } from "../../../logic/Calendar/Event";

export interface TimedEventItem {
  event: Event;
  startMinute: number;
  endMinute: number;
  lane: number;
  lanes: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export class TimeColumnLayout {
  static readonly kMinutesPerDay = 24 * 60;
  readonly items: TimedEventItem[] = [];

  constructor(events: Event[], day: Date, minDurationMinutes: number) {
    let dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    let dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    let minuteOf = (time: Date) => time.getHours() * 60 + time.getMinutes();
    for (let event of events) {
      if (!(event.startTime < dayEnd && event.endTime > dayStart)) {
        continue;
      }
      let continuesBefore = event.startTime < dayStart;
      let continuesAfter = event.endTime > dayEnd;
      let startMinute = continuesBefore ? 0 : minuteOf(event.startTime);
      let endMinute = continuesAfter || event.endTime.getTime() == dayEnd.getTime()
        ? TimeColumnLayout.kMinutesPerDay
        : minuteOf(event.endTime);
      endMinute = Math.max(endMinute, startMinute + minDurationMinutes);
      if (endMinute > TimeColumnLayout.kMinutesPerDay) {
        startMinute = Math.max(0, TimeColumnLayout.kMinutesPerDay - minDurationMinutes);
        endMinute = TimeColumnLayout.kMinutesPerDay;
      }
      this.items.push({ event, startMinute, endMinute, lane: 0, lanes: 1, continuesBefore, continuesAfter });
    }
    this.assignLanes();
  }

  // <copied from="../../../frontend/Calendar/DayView/DayColumn.ts">, in minutes instead of rows, because short events get a minimum height
  protected assignLanes() {
    this.items.sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);
    let cluster: TimedEventItem[] = [];
    let laneEnds: number[] = [];
    let clusterEnd = 0;
    for (let item of this.items) {
      if (item.startMinute >= clusterEnd) {
        this.setLanes(cluster, laneEnds.length);
        cluster = [];
        laneEnds = [];
      }
      let lane = laneEnds.findIndex(laneEnd => laneEnd <= item.startMinute);
      if (lane < 0) {
        lane = laneEnds.length;
      }
      laneEnds[lane] = item.endMinute;
      item.lane = lane;
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.endMinute);
    }
    this.setLanes(cluster, laneEnds.length);
  }

  protected setLanes(cluster: TimedEventItem[], lanes: number) {
    for (let item of cluster) {
      item.lanes = lanes;
    }
  }
  // </copied>
}
