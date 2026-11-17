import type { Event } from "../../../logic/Calendar/Event";
import type { Participant } from "../../../logic/Calendar/Participant";
import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
import { RecurrencePattern } from "./RecurrencePattern";
import { gt } from "../../../l10n/l10n";

export type InfoKind = "info" | "warning" | "cancelled" | "recurrence";

export interface InfoMessage {
  kind: InfoKind;
  text: string;
}

export type TrackingColumn = "name" | "attendance" | "response" | null;

export interface ResponseCounts {
  accepted: number;
  tentative: number;
  declined: number;
  none: number;
}

export function isMeetingEvent(event: Event): boolean {
  return event.participants.hasItems;
}

export function isSavedEvent(event: Event): boolean {
  return !(event.parentEvent ?? event).isNew;
}

export function eventTabLabel(event: Event): string {
  let isMeeting = event.isIncomingMeeting || isMeetingEvent(event);
  if (event.parentEvent) {
    return isMeeting ? gt`Meeting Occurrence` : gt`Appointment Occurrence`;
  }
  if (event.recurrenceRule) {
    return isMeeting ? gt`Meeting Series` : gt`Appointment Series`;
  }
  return isMeeting ? gt`Meeting` : gt`Appointment *=> Type of calendar item: without attendees`;
}

export function responseCounts(event: Event): ResponseCounts {
  let counts: ResponseCounts = { accepted: 0, tentative: 0, declined: 0, none: 0 };
  for (let participant of event.participants) {
    switch (participant.response) {
    case InvitationResponse.Organizer:
      break;
    case InvitationResponse.Accept:
      counts.accepted++;
      break;
    case InvitationResponse.Tentative:
      counts.tentative++;
      break;
    case InvitationResponse.Decline:
      counts.declined++;
      break;
    default:
      counts.none++;
    }
  }
  return counts;
}

export function responseSummary(event: Event): string {
  let counts = responseCounts(event);
  if (!counts.accepted && !counts.tentative && !counts.declined) {
    return gt`No responses have been received for this meeting`;
  }
  return gt`Attendee responses: ${counts.accepted} accepted, ${counts.tentative} tentatively accepted, ${counts.declined} declined`;
}

export function eventWhenText(event: Event, locale: string): string {
  const kDay: Intl.DateTimeFormatOptions = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
  let start = event.startTime;
  let end = event.endTime;
  if (event.allDay) {
    let lastDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
    if (lastDay <= start) {
      return new Intl.DateTimeFormat(locale, kDay).format(start) + " " + gt`(all day)`;
    }
    return new Intl.DateTimeFormat(locale, kDay).formatRange(start, lastDay) + " " + gt`(all day)`;
  }
  return new Intl.DateTimeFormat(locale, { ...kDay, hour: "numeric", minute: "2-digit" }).formatRange(start, end);
}

export function attendanceLabel(participant: Participant): string {
  return participant.response == InvitationResponse.Organizer
    ? gt`Meeting Organizer`
    : gt`Required Attendee`;
}

export function responseLabel(participant: Participant): string {
  return responseText(participant.response);
}

export function responseText(response: InvitationResponse): string {
  switch (response) {
  case InvitationResponse.Accept:
    return gt`Accepted *=> Agreed to join this business meeting`;
  case InvitationResponse.Tentative:
    return gt`Tentative *=> Not sure to join this business meeting`;
  case InvitationResponse.Decline:
    return gt`Declined *=> Refused to join this business meeting`;
  default:
    return gt`None *=> No response`;
  }
}

export function sortForTracking(participants: Participant[], column: TrackingColumn, ascending: boolean): Participant[] {
  if (!column) {
    return participants;
  }
  let key = (participant: Participant) => column == "name"
    ? participant.name || participant.emailAddress || ""
    : column == "attendance"
      ? attendanceLabel(participant)
      : responseLabel(participant);
  let direction = ascending ? 1 : -1;
  return [...participants].sort((a, b) => key(a).localeCompare(key(b)) * direction);
}

export function myResponseText(response: InvitationResponse): string {
  switch (response) {
  case InvitationResponse.Accept:
    return gt`You accepted this meeting`;
  case InvitationResponse.Tentative:
    return gt`You tentatively accepted this meeting`;
  case InvitationResponse.Decline:
    return gt`You declined this meeting`;
  default:
    return gt`Please respond`;
  }
}

export function blocksTime(event: Event): boolean {
  return !event.allDay && !event.isCancelled && event.myParticipation != InvitationResponse.Decline;
}

export function eventConflict(event: Event, events: Iterable<Event>): "conflict" | "adjacent" | null {
  if (!event.startTime || !event.endTime || !blocksTime(event)) {
    return null;
  }
  let start = event.startTime.getTime();
  let end = event.endTime.getTime();
  let result: "adjacent" | null = null;
  for (let existing of events) {
    if (existing == event || existing.parentEvent == event || existing == event.unedited || existing == event.parentEvent ||
        !existing.startTime || !existing.endTime || !blocksTime(existing)) {
      continue;
    }
    let existingStart = existing.startTime.getTime();
    let existingEnd = existing.endTime.getTime();
    if (existingStart < end && existingEnd > start) {
      return "conflict";
    }
    if (existingEnd == start || existingStart == end) {
      result = "adjacent";
    }
  }
  return result;
}

export function eventInfoMessages(event: Event, events: Iterable<Event>, now = new Date(), pattern = RecurrencePattern.fromEvent(event)): InfoMessage[] {
  let messages: InfoMessage[] = [];
  let isMeeting = isMeetingEvent(event);
  if (event.isIncomingMeeting) {
    if (event.isCancelled) {
      messages.push({ kind: "cancelled", text: gt`This meeting has been cancelled by the organizer` });
    } else if (event.isMoved) {
      messages.push({ kind: "info", text: gt`The organizer changed the time or place of this meeting. Please respond again.` });
    } else {
      messages.push({ kind: "info", text: myResponseText(event.myParticipation) });
    }
  } else if (isMeeting) {
    messages.push(isSavedEvent(event)
      ? { kind: "info", text: responseSummary(event) }
      : { kind: "info", text: gt`You haven't sent this meeting invitation yet` });
  }
  if (event.parentEvent?.recurrenceRule) {
    messages.push({ kind: "recurrence", text: pattern.summary(event) });
  }
  let conflict = eventConflict(event, events);
  if (conflict == "conflict") {
    messages.push({ kind: "warning", text: gt`This appointment conflicts with another one on your calendar` });
  } else if (conflict == "adjacent") {
    messages.push({ kind: "info", text: gt`Adjacent to another appointment on your calendar` });
  }
  if (!event.recurrenceRule && event.endTime && event.endTime < now) {
    messages.push({ kind: "info", text: isMeeting || event.isIncomingMeeting
      ? gt`This meeting occurs in the past`
      : gt`This appointment occurs in the past` });
  }
  return messages;
}
