import type { Event } from "../../../logic/Calendar/Event";

export const kMinutesPerRow = 5;
export const kRowsPerHour = 60 / kMinutesPerRow;

export interface EventInTimeColumn {
  event: Event;
  startRow: number;
  endRow: number;
  lane: number;
  lanes: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export function layoutTimeColumn(events: Event[], day: Date, startHour = 0, endHour = 24): EventInTimeColumn[] {
  let columnStart = new Date(day);
  columnStart.setHours(startHour, 0, 0, 0);
  let columnEnd = new Date(day);
  columnEnd.setHours(endHour, 0, 0, 0);
  let rows = (endHour - startHour) * kRowsPerHour;
  let rowOf = (time: Date) => ((time.getHours() - startHour) * 60 + time.getMinutes()) / kMinutesPerRow;

  let items: EventInTimeColumn[] = [];
  for (let event of events) {
    if (!(event.startTime < columnEnd && event.endTime > columnStart)) {
      continue;
    }
    let continuesBefore = event.startTime < columnStart;
    let continuesAfter = event.endTime > columnEnd;
    let startRow = continuesBefore ? 0 : Math.min(Math.floor(rowOf(event.startTime)), rows - 1);
    let endRow = event.endTime >= columnEnd ? rows : Math.ceil(rowOf(event.endTime));
    endRow = Math.max(endRow, startRow + 1);
    items.push({ event, startRow, endRow, lane: 0, lanes: 1, continuesBefore, continuesAfter });
  }

  items.sort((a, b) => a.startRow - b.startRow || b.endRow - a.endRow);
  let cluster: EventInTimeColumn[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = 0;
  for (let item of items) {
    if (item.startRow >= clusterEnd) {
      setLanes(cluster, laneEnds.length);
      cluster = [];
      laneEnds = [];
    }
    let lane = laneEnds.findIndex(laneEnd => laneEnd <= item.startRow);
    if (lane < 0) {
      lane = laneEnds.length;
    }
    laneEnds[lane] = item.endRow;
    item.lane = lane;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endRow);
  }
  setLanes(cluster, laneEnds.length);
  return items;
}

function setLanes(cluster: EventInTimeColumn[], lanes: number) {
  for (let item of cluster) {
    item.lanes = lanes;
  }
}
