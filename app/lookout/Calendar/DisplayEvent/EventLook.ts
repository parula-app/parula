import type { Event } from "../../../logic/Calendar/Event";
import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
import { gt } from "../../../l10n/l10n";

export type EventStatus = "busy" | "tentative" | "unanswered" | "declined" | "cancelled";

export class EventLook {
  readonly event: Event;

  constructor(event: Event) {
    this.event = event;
  }

  get status(): EventStatus {
    if (this.event.isCancelled) {
      return "cancelled";
    }
    switch (this.event.myParticipation) {
    case InvitationResponse.Decline:
      return "declined";
    case InvitationResponse.Tentative:
      return "tentative";
    case InvitationResponse.NoResponseReceived:
      return "unanswered";
    }
    return "busy";
  }

  get title(): string {
    let title = this.event.title ?? "";
    switch (this.status) {
    case "cancelled":
      return gt`Canceled: ${title}`;
    case "declined":
      return gt`Declined: ${title}`;
    }
    return title;
  }

  get organizerName(): string | null {
    if (!this.event.isIncomingMeeting) {
      return null;
    }
    let organizer = this.event.organizer;
    return organizer?.name || organizer?.emailAddress || null;
  }

  timeText(locale: string): string {
    let start = this.event.startTime;
    let end = this.event.endTime;
    if (this.event.allDay) {
      let lastDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
      if (lastDay <= start) {
        return gt`All day`;
      }
      return new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" }).formatRange(start, lastDay);
    }
    if (start.toDateString() == end.toDateString()) {
      return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).formatRange(start, end);
    }
    return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).formatRange(start, end);
  }

  tooltip(locale: string): string {
    return [ this.timeText(locale), this.title, this.event.location, this.organizerName ]
      .filter(line => line?.trim())
      .join("\n");
  }
}
