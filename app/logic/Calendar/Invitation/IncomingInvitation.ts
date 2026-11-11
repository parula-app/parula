import type { Calendar } from "../Calendar";
import type { Event } from "../Event";
import { InvitationMessage, InvitationResponse, type InvitationResponseInMessage } from "../Invitation/InvitationStatus";
import { identityForCalendar } from "./OutgoingInvitation";
import { findIdentityForEMailAddress } from "../../Mail/MailIdentity";
import { getICal } from "../ICal/ICalGenerator";
import type { EMail } from "../../Mail/EMail";
import { AbstractFunction, NotReached, assert } from "../../util/util";

export class IncomingInvitation {
  readonly calendar: Calendar;
  readonly message: EMail;
  readonly invitationMessage: InvitationMessage;
  readonly event: Event;
  myParticipation: InvitationResponse;

  constructor(calendar: Calendar, message: EMail) {
    this.calendar = calendar;
    this.message = message;
    this.invitationMessage = message.invitationMessage;
    this.event = message.event;
    let event = this.calEvent();
    this.myParticipation = event?.myParticipation ||
      (this.amIOrganizer()
        ? InvitationResponse.Organizer
        : InvitationResponse.NoResponseReceived);
  }

  amIOrganizer(): boolean {
    let organizer = this.event.participants.find(participant => participant.response == InvitationResponse.Organizer);
    if (!organizer) {
      return false;
    }
    return this.message.folder.account.isMyEMailAddress(organizer.emailAddress);
  }

  /** `this.event` is from the invitation email, but `calEvent` is the event in the calendar */
  calEvent(): Event | null {
    // First find a standalone event or master.
    let event = this.calendar.events.find(event => event.calUID == this.event.calUID && !event.recurrenceStartTime);
    // If this is an occurrence, find it now.
    // It may have been cancelled and excluded from the calendar already.
    return this.event.recurrenceStartTime ? event?.getOccurrenceByDate(this.event.recurrenceStartTime, false) : event;
    // TODO What if you were only invited to a single exception?
  }

  async respondToInvitationFromMail(response: InvitationResponseInMessage, sendReply = true) {
    throw new AbstractFunction();
  }

  /**
   * Writes an email about a meeting that I was invited to,
   * to its organizer, or to the organizer and all attendees.
   */
  static replyToEventByMail(event: Event, toAll: boolean): EMail {
    let identity = identityForCalendar(event.calendar);
    let mail = identity.newEMailFrom();
    mail.subject = "Re: " + event.title; // Do NOT translate "Re: "
    let recipients = toAll ? event.participants.contents : [event.organizer];
    mail.to.addAll(recipients.filter(participant => participant && !findIdentityForEMailAddress(participant.emailAddress)));
    return mail;
  }

  /**
   * Forwards an event to another person by email.
   *
   * - This is typically used on an event from incoming invitation.
   * - If it was an outgoing invitation, that means you're the organizer, and
   *   you'd simply add participants to the event.
   * - If it was an event without participants, you'd simply add participants.
   */
  static async forwardEventByMail(event: Event): Promise<EMail> {
    let identity = identityForCalendar(event.calendar);
    let mail = identity.newEMailFrom();
    mail.subject = "Fwd: " + event.title; // Do NOT translate "Fwd: "
    mail.event = event;
    // `mail.event` already sends the event, but it's not visible in the composer, so add it a third time
    let icalStr = new TextEncoder().encode(await getICal(event));
    let file = new File([icalStr], "forwarded.ics", { type: "text/calendar" });
    let attachment = mail.newAttachment();
    attachment.fromFile(file);
    mail.attachments.add(attachment);
    return mail;
  }

  /** CancelledEvent: the organiser cancelled an incoming meeting */
  async updateCancelled() {
    assert(this.invitationMessage == InvitationMessage.CancelledEvent, "Not a cancellation");
    let event = this.calEvent();
    assert(event, "Cannot process invitation update: The event was not found in your calendar");
    if (!this.event.isNewerVersionThan(event)) {
      return;
    }
    event.isCancelled = true;
    event.lastUpdateTime = this.event.lastUpdateTime;
    event.sequence = this.event.sequence;
    await event.save();
  }

  /** Invitation: the organiser changed an incoming meeting that is already in your calendar.
   * A new time or place needs a new response, so the meeting becomes unanswered and moved.
   * Other changes keep your response. */
  async updateChangedMeeting() {
    assert(this.invitationMessage == InvitationMessage.Invitation, "Not an invitation");
    let event = this.calEvent();
    if (!event?.isIncomingMeeting ||
        !this.event.startTime ||
        !this.event.isNewerVersionThan(event) ||
        !this.event.organizer?.matches(event.organizer)) {
      return;
    }
    let isMoved = this.isMovedFrom(event);
    let myParticipation = isMoved ? InvitationResponse.NoResponseReceived : event.myParticipation;
    let wasMoved = event.isMoved;
    let alarmBeforeStart = event.alarm ? event.startTime.getTime() - event.alarm.getTime() : null;
    event.startEditing();
    event.copyEditableFieldsFrom(this.event);
    event.recurrenceRule = this.event.recurrenceRule;
    let me = event.participants.find(participant => this.message.folder.account.isMyEMailAddress(participant.emailAddress));
    if (me) {
      me.response = myParticipation;
    }
    event.myParticipation = myParticipation;
    event.isMoved = wasMoved || isMoved;
    event.alarm = alarmBeforeStart == null ? null : new Date(event.startTime.getTime() - alarmBeforeStart);
    await event.adoptAttachmentsFrom(this.event);
    await event.save();
    event.finishEditing();
  }

  /** Whether the invitation has another time or physical place than the `event`
   * in the calendar, so that you need to check again whether you can attend */
  protected isMovedFrom(event: Event): boolean {
    let changed = this.event;
    return changed.startTime?.getTime() != event.startTime?.getTime() ||
      changed.endTime?.getTime() != event.endTime?.getTime() ||
      changed.allDay != event.allDay ||
      !changed.recurrenceRule != !event.recurrenceRule ||
      !!changed.recurrenceRule && !changed.recurrenceRule.matches(event.recurrenceRule) ||
      (changed.location ?? "").trim() != (event.location ?? "").trim();
  }

  /** ParticpantReply: an invitee replied to your outgoing invitation */
  async updateParticipantReply() {
    assert(this.invitationMessage == InvitationMessage.ParticipantReply, "Not a reply");
    let event = this.calEvent();
    assert(event, "Cannot process invitation update: The event was not found in your calendar");
    event.separateParticipantsFromSeries();
    let invitee = this.event.participants.find(participant => participant.response != InvitationResponse.Organizer);
    let participant = event.participants.find(participant => participant.emailAddress == invitee.emailAddress);
    let timestamp = this.event.lastUpdateTime;
    if (participant &&
      (!participant.lastUpdateTime || participant.lastUpdateTime < timestamp)) {
      participant.response = invitee.response;
      participant.lastUpdateTime = timestamp;
      await event.save();
    }
  }

  /** Handle CancelledEvent, ParticpantReply, and a changed Invitation */
  async updateFromOtherInvitationMessage() {
    if (this.invitationMessage == InvitationMessage.CancelledEvent) {
      await this.updateCancelled();
    } else if (this.invitationMessage == InvitationMessage.ParticipantReply) {
      await this.updateParticipantReply();
    } else if (this.invitationMessage == InvitationMessage.Invitation) {
      await this.updateChangedMeeting();
    } else {
      throw new NotReached();
    }
  }
}
