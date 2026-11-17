import { RecurrenceCase, type Event } from "../../../logic/Calendar/Event";
import { Frequency, ruleAsLabel } from "../../../logic/Calendar/RecurrenceRule";
import { getDateTimeLocale, gt } from "../../../l10n/l10n";

export enum EventTableColumn {
  Subject = "subject",
  Location = "location",
  Start = "start",
  End = "end",
  Recurrence = "recurrence",
  Calendar = "calendar",
}

export enum EventTableGrouping {
  Recurrence = "recurrence",
  None = "none",
}

export class EventTableGroup {
  readonly id: string;
  readonly label: string;
  readonly events: Event[];

  constructor(id: string, label: string, events: Event[]) {
    this.id = id;
    this.label = label;
    this.events = events;
  }
}

export class EventTable {
  static readonly allColumns = [
    EventTableColumn.Subject, EventTableColumn.Location, EventTableColumn.Start, EventTableColumn.End,
    EventTableColumn.Recurrence, EventTableColumn.Calendar,
  ];
  static readonly defaultColumns = [
    EventTableColumn.Subject, EventTableColumn.Location, EventTableColumn.Start, EventTableColumn.End, EventTableColumn.Recurrence,
  ];
  sortColumn: EventTableColumn;
  ascending: boolean;
  grouping: EventTableGrouping;

  constructor(sortColumn = EventTableColumn.Start, ascending = true, grouping = EventTableGrouping.Recurrence) {
    this.sortColumn = sortColumn;
    this.ascending = ascending;
    this.grouping = grouping;
  }

  static isListed(event: Event): boolean {
    return event.recurrenceCase == RecurrenceCase.Normal || event.recurrenceCase == RecurrenceCase.Master;
  }

  groups(events: Event[]): EventTableGroup[] {
    let sorted = this.sorted(events);
    if (this.grouping == EventTableGrouping.None) {
      return [ new EventTableGroup("all", "", sorted) ];
    }
    const kFrequencies = [ Frequency.None, Frequency.Daily, Frequency.Weekly, Frequency.Monthly, Frequency.Yearly ];
    let groups: EventTableGroup[] = [];
    for (let frequency of kFrequencies) {
      let groupEvents = sorted.filter(event => EventTable.frequency(event) == frequency);
      if (groupEvents.length) {
        groups.push(new EventTableGroup(frequency, gt`Recurrence: ${EventTable.frequencyLabel(frequency)}`, groupEvents));
      }
    }
    return groups;
  }

  sorted(events: Event[]): Event[] {
    let direction = this.ascending ? 1 : -1;
    return events.slice().sort((a, b) =>
      direction * this.compare(a, b) || a.startTime.getTime() - b.startTime.getTime());
  }

  toggleSort(column: EventTableColumn) {
    if (this.sortColumn == column) {
      this.ascending = !this.ascending;
    } else {
      this.sortColumn = column;
      this.ascending = true;
    }
  }

  protected compare(a: Event, b: Event): number {
    switch (this.sortColumn) {
    case EventTableColumn.Subject:
      return EventTable.compareText(a.title, b.title);
    case EventTableColumn.Location:
      return EventTable.compareText(a.location, b.location);
    case EventTableColumn.End:
      return a.endTime.getTime() - b.endTime.getTime();
    case EventTableColumn.Recurrence:
      return EventTable.compareText(EventTable.recurrenceLabel(a), EventTable.recurrenceLabel(b));
    case EventTableColumn.Calendar:
      return EventTable.compareText(a.calendar?.name, b.calendar?.name);
    default:
      return a.startTime.getTime() - b.startTime.getTime();
    }
  }

  protected static compareText(a: string | null | undefined, b: string | null | undefined): number {
    if (!a || !b) {
      return (a ? 0 : 1) - (b ? 0 : 1);
    }
    return a.localeCompare(b, getDateTimeLocale(), { sensitivity: "base" });
  }

  static frequency(event: Event): Frequency {
    return event.recurrenceRule?.frequency ?? Frequency.None;
  }

  static frequencyLabel(frequency: Frequency): string {
    switch (frequency) {
    case Frequency.Daily:
      return gt`Daily *=> Repeats every day`;
    case Frequency.Weekly:
      return gt`Weekly *=> Repeats every week`;
    case Frequency.Monthly:
      return gt`Monthly *=> Repeats every month`;
    case Frequency.Yearly:
      return gt`Yearly *=> Repeats every year`;
    default:
      return gt`(none) *=> Recurrence: the event does not repeat`;
    }
  }

  static recurrenceLabel(event: Event): string {
    let rule = event.recurrenceRule;
    return rule ? ruleAsLabel(rule) : "";
  }

  static timeLabel(event: Event, isEnd: boolean, locale: string): string {
    let time = isEnd ? event.endTime : event.startTime;
    if (event.allDay && isEnd) {
      time = new Date(time.getTime() - 1);
    }
    let parts = [
      time.toLocaleDateString(locale, { weekday: "short" }),
      time.toLocaleDateString(locale, { year: "numeric", month: "numeric", day: "numeric" }),
    ];
    if (!event.allDay) {
      parts.push(time.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }));
    }
    return parts.join(" ");
  }

  static columnLabel(column: EventTableColumn): string {
    switch (column) {
    case EventTableColumn.Subject:
      return gt`Subject`;
    case EventTableColumn.Location:
      return gt`Location`;
    case EventTableColumn.Start:
      return gt`Start`;
    case EventTableColumn.End:
      return gt`End *=> End time of the event`;
    case EventTableColumn.Recurrence:
      return gt`Recurrence Pattern`;
    case EventTableColumn.Calendar:
      return gt`In Folder *=> Column with the folder that contains the item`;
    }
  }
}
