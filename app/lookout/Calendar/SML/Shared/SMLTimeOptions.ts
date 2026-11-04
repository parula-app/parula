import type { Event } from "../../../../logic/Calendar/Event";
import type { TSMLMeetingTimeVote, TSMLMeetingTimePreference } from "../../../../logic/Mail/SML/TSML";
import { getDateTimeLocale } from "../../../../l10n/l10n";

export interface TimeOptionDay {
  day: Date;
  times: Date[];
}

export function pollOptionsByDay(options: Date[]): TimeOptionDay[] {
  let days: TimeOptionDay[] = [];
  let sorted = [...options].sort((a, b) => a.getTime() - b.getTime());
  for (let time of sorted) {
    let day = new Date(time.getFullYear(), time.getMonth(), time.getDate());
    let last = days[days.length - 1];
    if (last?.day.getTime() == day.getTime()) {
      last.times.push(time);
    } else {
      days.push({ day, times: [time] });
    }
  }
  return days;
}

export function pollDayLabel(day: Date, locale = getDateTimeLocale()): string {
  return day.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export function pollOptionEnd(start: Date, durationMinutes: number): Date {
  return new Date(start.getTime() + durationMinutes * 60000);
}

export function pollOptionConflicts(start: Date, durationMinutes: number, events: Iterable<Event>): Event[] {
  let end = pollOptionEnd(start, durationMinutes);
  let found: Event[] = [];
  for (let event of events) {
    if (event.allDay || event.isCancelled || !event.startTime || !event.endTime) {
      continue;
    }
    if (event.startTime < end && event.endTime > start) {
      found.push(event);
    }
  }
  return found.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

export function votePreference(votes: TSMLMeetingTimeVote[], time: Date): TSMLMeetingTimePreference | null {
  return votes?.find(vote => vote.time?.getTime() == time.getTime())?.preference ?? null;
}

export function setVote(votes: TSMLMeetingTimeVote[], time: Date, preference: TSMLMeetingTimePreference): void {
  let index = votes.findIndex(vote => vote.time?.getTime() == time.getTime());
  if (index >= 0) {
    votes.splice(index, 1);
  }
  votes.push({ time, preference } as TSMLMeetingTimeVote);
}

export function hasPollOption(options: Date[], time: Date): boolean {
  return options.some(option => option.getTime() == time.getTime());
}

export function addPollOption(options: Date[], time: Date): void {
  if (hasPollOption(options, time)) {
    return;
  }
  options.push(time);
  options.sort((a, b) => a.getTime() - b.getTime());
}

export function removePollOption(options: Date[], time: Date): void {
  let index = options.findIndex(option => option.getTime() == time.getTime());
  if (index >= 0) {
    options.splice(index, 1);
  }
}

export function nextPollOption(options: Date[], durationMinutes: number, now = new Date()): Date {
  if (options.length) {
    let last = options.reduce((latest, option) => option > latest ? option : latest);
    return pollOptionEnd(last, durationMinutes);
  }
  let next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  next.setDate(next.getDate() + 1);
  return next;
}
