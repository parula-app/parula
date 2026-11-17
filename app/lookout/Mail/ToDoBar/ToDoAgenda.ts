export interface AgendaEvent {
  startTime: Date;
  endTime: Date;
  allDay?: boolean;
}

export interface AgendaDay<T extends AgendaEvent> {
  day: Date;
  events: T[];
}

export function agendaDays<T extends AgendaEvent>(events: Iterable<T>, from: Date, dayCount = 7, maxEvents = 20): AgendaDay<T>[] {
  let result: AgendaDay<T>[] = [];
  let total = 0;
  let all = [...events];
  for (let i = 0; i < dayCount && total < maxEvents; i++) {
    let dayStart = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    let dayEnd = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i + 1);
    let dayEvents = all
      .filter(event => event.startTime < dayEnd && event.endTime > dayStart)
      .sort((a, b) => Number(!!b.allDay) - Number(!!a.allDay) || a.startTime.getTime() - b.startTime.getTime())
      .slice(0, maxEvents - total);
    if (dayEvents.length) {
      result.push({ day: dayStart, events: dayEvents });
      total += dayEvents.length;
    }
  }
  return result;
}
