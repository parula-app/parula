import type { Calendar } from "./Calendar";
import type { Event } from "./Event";
import type { Participant } from "./Participant";
import { FreeBusyEvent, FreeBusyStatus } from "./FreeBusyEvent";
import type { TimeInterval } from "../util/date";
import { ArrayColl, type Collection } from "svelte-collections";

export class FreeBusy {
  readonly rows: AttendeeAvailability[];
  readonly isSupported: boolean;

  constructor(rows: AttendeeAvailability[], isSupported = true) {
    this.rows = rows;
    this.isSupported = isSupported;
  }

  protected static supportedCalendars = new Map<Calendar, boolean>();

  static async isSupported(calendar: Calendar, participants: Participant[]): Promise<boolean> {
    let known = FreeBusy.supportedCalendars.get(calendar);
    if (known != null) {
      return known;
    }
    let from = new Date();
    from.setHours(0, 0, 0, 0);
    let to = new Date(from);
    to.setDate(to.getDate() + 1);
    let freeBusy = await FreeBusy.load(calendar, participants, from, to);
    if (participants.length) {
      FreeBusy.supportedCalendars.set(calendar, freeBusy.isSupported);
    }
    return freeBusy.isSupported;
  }

  static async load(calendar: Calendar, participants: Participant[], from: Date, to: Date): Promise<FreeBusy> {
    if (!participants.length) {
      return new FreeBusy([]);
    }
    let availability = await calendar.arePersonsFree(participants, from, to);
    return FreeBusy.fromAvailability(participants, availability);
  }

  static fromAvailability(participants: Participant[], availability: ArePersonsFreeResult): FreeBusy {
    return new FreeBusy(participants.map(participant => {
      let result = availability.find(entry => entry.participant == participant) ??
        availability.find(entry => entry.participant?.emailAddress == participant.emailAddress);
      if (!result?.availability) {
        return { participant, busy: null, appointments: null };
      }
      let appointments = result.availability
        .filter(appointment => !appointment.isFree)
        .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
      let busy = FreeBusy.merge(appointments.map(appointment => ({ startTime: appointment.startTime, endTime: appointment.endTime })));
      return { participant, busy, appointments };
    }), availability.length > 0);
  }

  /**
   * For the participant who is us, our appointments from all our calendars,
   * instead of what the server knows. They are complete, also without free/busy
   * from the server, and the meeting itself doesn't count.
   * @param meeting The meeting that we organize
   * @param myEvents The events of all our calendars
   */
  withMyEvents(meeting: Event, myEvents: Collection<Event>, from: Date, to: Date): FreeBusy {
    let me = meeting.isOutgoingMeeting ? meeting.organizer : null;
    if (!me) {
      return this;
    }
    let appointments = myEvents.filterOnce(event =>
      event != meeting && !event.allDay && event.busyStatus != FreeBusyStatus.Free &&
      event.startTime < to && event.endTime > from
    ).contents.map(event => {
      let appointment = new FreeBusyEvent(event.startTime, event.endTime, event.busyStatus);
      appointment.title = event.title;
      appointment.location = event.location;
      return appointment;
    });
    let myRow = FreeBusy.fromAvailability([me], [{ participant: me, availability: appointments }]).rows[0];
    return new FreeBusy(this.rows.map(row => row.participant == me ? myRow : row), this.isSupported);
  }

  get hasInformation(): boolean {
    return this.rows.some(row => row.busy);
  }

  get allAttendeesBusy(): TimeInterval[] {
    return FreeBusy.merge(this.rows.flatMap(row => row.busy ?? []));
  }

  rowFor(participant: Participant): AttendeeAvailability | undefined {
    return this.rows.find(row => row.participant == participant) ??
      this.rows.find(row => row.participant.emailAddress == participant.emailAddress);
  }

  status(participant: Participant, start: Date, end: Date): AvailabilityStatus {
    let busy = this.rowFor(participant)?.busy;
    if (!busy) {
      return "unknown";
    }
    return busy.some(interval => interval.startTime < end && interval.endTime > start) ? "busy" : "free";
  }

  /**
   * @returns One slot of `minutes` length after the other,
   *   from `startHour` to `endHour` on each of the `days`.
   *   Leaves out the slots where we know nothing about anybody.
   */
  slots(days: Date[], startHour: number, endHour: number, minutes: number): ArrayColl<FreeBusySlot> {
    let slots = new ArrayColl<FreeBusySlot>();
    for (let day of days) {
      let start = new Date(day);
      start.setHours(startHour, 0, 0, 0);
      let dayEnd = new Date(day);
      dayEnd.setHours(endHour, 0, 0, 0);
      while (start < dayEnd) {
        let end = new Date(start);
        end.setMinutes(end.getMinutes() + minutes);
        let slot = new FreeBusySlot(start, end);
        for (let row of this.rows) {
          slot.add(row.participant, this.status(row.participant, start, end));
        }
        if (slot.hasInformation) {
          slots.add(slot);
        }
        start = end;
      }
    }
    return slots;
  }

  static merge(intervals: TimeInterval[]): TimeInterval[] {
    let sorted = intervals
      .filter(interval => interval.endTime > interval.startTime)
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    let merged: TimeInterval[] = [];
    for (let interval of sorted) {
      let last = merged.at(-1);
      if (last && interval.startTime <= last.endTime) {
        if (interval.endTime > last.endTime) {
          last.endTime = new Date(interval.endTime);
        }
      } else {
        merged.push({ startTime: new Date(interval.startTime), endTime: new Date(interval.endTime) });
      }
    }
    return merged;
  }
}

export interface AttendeeAvailability {
  participant: Participant;
  busy: TimeInterval[] | null;
  appointments: FreeBusyEvent[] | null;
}

export type AvailabilityStatus = "free" | "busy" | "unknown";

type ArePersonsFreeResult = Awaited<ReturnType<Calendar["arePersonsFree"]>>;

/** A time when the participants could meet, and who of them is free then */
export class FreeBusySlot {
  readonly startTime: Date;
  readonly endTime: Date;
  readonly free = new ArrayColl<Participant>();
  readonly busy = new ArrayColl<Participant>();
  readonly unknown = new ArrayColl<Participant>();

  constructor(startTime: Date, endTime: Date) {
    this.startTime = new Date(startTime);
    this.endTime = new Date(endTime);
  }

  add(participant: Participant, status: AvailabilityStatus) {
    let list = status == "free" ? this.free : status == "busy" ? this.busy : this.unknown;
    list.add(participant);
  }

  get hasInformation(): boolean {
    return this.free.hasItems || this.busy.hasItems;
  }

  /** Only the participants whose availability we know count */
  get availability(): SlotAvailability {
    if (this.busy.isEmpty) {
      return SlotAvailability.Free;
    }
    const kMostlyBusy = 0.4;
    if (this.busy.length / (this.free.length + this.busy.length) > kMostlyBusy) {
      return SlotAvailability.Busy;
    }
    return SlotAvailability.Partly;
  }
}

export enum SlotAvailability {
  Free = "free",
  Partly = "partly",
  Busy = "busy",
}
