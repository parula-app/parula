import { type Event, RecurrenceCase } from "../Event";
import { Participant } from "../Participant";
import { InvitationResponse, type iCalMethod } from "./InvitationStatus";
import { findIdentityForEMailAddress, type MailIdentity} from "../../Mail/MailIdentity";
import type { EMail } from "../../Mail/EMail";
import type { SMLData } from "../../Mail/SML/SMLData";
import type { TSMLMeetingTimePoll } from "../../Mail/SML/TSML";
import type { Calendar } from "../Calendar";
import { MailAccount } from "../../Mail/MailAccount";
import { appGlobal } from "../../app";
import { NotReached, assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import type { Collection } from "svelte-collections";

export class OutgoingInvitation {
  event: Event;

  constructor(event: Event) {
    this.event = event;
  }

  createOrganizer() {
    assert(this.event.participants.isEmpty, "This is already a meeting");
    assert(!this.event.isIncomingMeeting, "This is a meeting you have been invitated to. You cannot be the organizer.");
    this.event.myParticipation = InvitationResponse.Organizer;
    let identity = this.event.calendar.inviteAs;
    assert(identity, gt`No suitable email identity to organise this meeting`);
    this.event.participants.add(new Participant(identity.emailAddress, identity.realname, InvitationResponse.Organizer));
  }

  async sendInvitationsTo(participants: Collection<Participant>) {
    for (let participant of participants) {
      participant.response ||= InvitationResponse.NoResponseReceived;
    }
    let sendTo = participants.filterOnce(participant => participant.isInvitee);
    if (sendTo.isEmpty) {
      return;
    }
    await this.send("REQUEST", sendTo);
  }

  async sendCancellationsTo(participants: Collection<Participant>) {
    let sendTo = participants.filterOnce(participant => participant.isInvitee);
    if (sendTo.isEmpty) {
      return;
    }
    await this.send("CANCEL", sendTo);
  }

  async sendInvitations() {
    let event = this.event;
    let unedited = this.event.unedited;
    let isFuture = event.startTime?.getTime() > Date.now() || event.recurrenceCase == RecurrenceCase.Master;
    if (!isFuture) {
      return;
    }
    let removed = unedited.participants.subtract(event.participants);
    // Use the original event when sending cancellations
    await unedited.outgoingInvitation.sendCancellationsTo(removed);
    let notify = this.changesNeedToNotify()
      ? event.participants
      : event.participants.subtract(unedited.participants);
    await this.sendInvitationsTo(notify);
  }

  async sendCancellations() {
    let isFuture = this.event.startTime?.getTime() > Date.now() || this.event.recurrenceCase == RecurrenceCase.Master;
    if (!isFuture) {
      return;
    }
    let unedited = this.event.unedited;
    if (unedited) {
      await unedited.outgoingInvitation.sendCancellationsTo(unedited.participants);
    } else {
      await this.sendCancellationsTo(this.event.participants);
    }
  }

  protected async send(method: iCalMethod, participants: Collection<Participant>) {
    let email = this.event.calendar.inviteAs.newEMailFrom();
    let organizer = this.event.participants.find(participant => participant.response == InvitationResponse.Organizer);
    assert(email.from.emailAddress == organizer.emailAddress, `Organizer ${organizer.emailAddress} does not match the mail identity for this calendar ${email.from.emailAddress}`);
    email.to.addAll(participants);
    email.iCalMethod = method;
    email.event = this.event;
    let subject = "";
    if (method == "REQUEST") {
      subject = gt`Invitation *=> Suggestion to join the business meeting`
    } else if (method == "CANCEL") {
      subject = gt`Cancelled *=> The business meeting is no longer happening`
    } else {
      throw new NotReached(`You cannot ${method} to this invitation, because you're the organizer`);
    }
    email.subject = subject + ": " + this.event.title;
    if (method == "REQUEST") {
      await this.addAttachments(email);
    }
    if (this.event.descriptionText) {
      email.text = this.event.descriptionText;
      email.html = this.event.descriptionHTML;
    }
    await email.folder.account.send(email);
  }

  /**
   * Sends the files that are attached to the event as attachments of the
   * invitation email, and not inline in the iCal, which is what Exchange,
   * Google and Apple do as well.
   *
   * Exchange puts the invitation into the calendar of the invitee before any
   * mail app ever sees the email, so files inline in the iCal would be lost.
   * @see ICalEMailProcessor for the receiving end.
   */
  protected async addAttachments(email: EMail) {
    await this.event.loadAttachments();
    email.attachments.addAll(this.event.attachments.contents
      .filter(attachment => attachment.content) // We can't send what we don't have
      .map(attachment => attachment.cloneTo(email)));
  }

  /**
   * Has a property changed that we should notify invitees about?
   */
  changesNeedToNotify(): boolean {
    let event = this.event;
    let unedited = this.event.unedited;
    return !!event.unedited && (
      event.startTime?.getTime() != unedited.startTime?.getTime() ||
      event.endTime?.getTime() != unedited.endTime?.getTime() ||
      event.timezone != unedited.timezone ||
      event.allDay != unedited.allDay ||
      event.title != unedited.title ||
      event.rawText != unedited.rawText ||
      event.rawHTMLDangerous != unedited.rawHTMLDangerous ||
      event.location != unedited.location ||
      event.isOnline != unedited.isOnline ||
      event.onlineMeetingURL != unedited.onlineMeetingURL ||
      event.recurrenceCase != unedited.recurrenceCase ||
      event.recurrenceRule != unedited.recurrenceRule ||
      event.exclusions.length != unedited.exclusions.length
    );
  }

  /**
   * Asks the participants by email which of the proposed times suit them.
   * @param poll A `MeetingTimePoll`
   */
  meetingTimePollMail(participants: Collection<Participant>, poll: SMLData): EMail {
    let timePoll = poll.sml as TSMLMeetingTimePoll;
    timePoll.name = this.event.title;
    timePoll.duration = this.event.durationMinutes;
    let email = this.event.calendar.inviteAs.newEMailFrom();
    email.to.addAll(participants);
    email.subject = this.event.title;
    email.sml = poll;
    return email;
  }
}

export function identityForCalendar(calendar: Calendar): MailIdentity {
  if (calendar?.mainAccount instanceof MailAccount) {
    return calendar.mainAccount.identities.first;
  }
  let identity = findIdentityForEMailAddress(calendar?.username);
  identity ??= appGlobal.emailAccounts.first?.identities.first;
  assert(identity, "Please set up an email account first");
  return identity;
}
