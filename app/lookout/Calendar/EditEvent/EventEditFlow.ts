import { type Event, RecurrenceCase } from "../../../logic/Calendar/Event";
import type { RecurrenceRule } from "../../../logic/Calendar/RecurrenceRule";
import { Participant } from "../../../logic/Calendar/Participant";
import type { PersonUID } from "../../../logic/Abstract/PersonUID";
import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
import { RecurrencePattern } from "./RecurrencePattern";
import { reminderMinutesBefore, setReminderMinutesBefore } from "./Reminder";
import { CalendarActions } from "../CalendarActions";
import { showMessageBox, askYesNo } from "../../Shared/Dialog/MessageBox";
import { calendarMustangApp } from "../../../frontend/Calendar/CalendarMustangApp";
import { selectedEvent } from "../../../frontend/Calendar/selected";
import { goBack } from "../../../frontend/AppsBar/selectedApp";
import { showError } from "../../../frontend/Util/error";
import { gt } from "../../../l10n/l10n";

export type SeriesChoice = "occurrence" | "following" | "series";

export class EventEditFlow {
  readonly event: Event;
  pattern: RecurrencePattern;
  protected onClosed: () => void;

  constructor(event: Event, onClosed: () => void = () => goBack()) {
    this.event = event;
    this.onClosed = onClosed;
    this.pattern = RecurrencePattern.fromEvent(event);
  }

  get master(): Event {
    return this.event.parentEvent ?? this.event;
  }

  get isMeeting(): boolean {
    return this.event.participants.hasItems;
  }

  get isSaved(): boolean {
    return !this.master.isNew;
  }

  get attendees(): Participant[] {
    return this.event.participants.contents.filter(participant => participant.response != InvitationResponse.Organizer);
  }

  get hasMinimalProps(): boolean {
    let event = this.event;
    return !!event.title && !!event.startTime && !!event.endTime &&
      event.startTime.getTime() <= event.endTime.getTime();
  }

  get missingPropsReason(): string | null {
    let event = this.event;
    if (!event.title) {
      return gt`Please enter a title`;
    }
    if (!event.startTime || !event.endTime || event.startTime.getTime() > event.endTime.getTime()) {
      return gt`The end time is before the start time`;
    }
    return null;
  }

  get seriesEndChanged(): boolean {
    return this.pattern.endDiffersFrom(this.master.recurrenceRule);
  }

  get canSaveSeries(): boolean {
    let event = this.event;
    return this.hasMinimalProps && event.hasChanged() && event.recurrenceCase == RecurrenceCase.Instance ||
      !!event.parentEvent?.hasChanged() ||
      this.hasMinimalProps && !!event.parentEvent && this.seriesEndChanged;
  }

  get canSaveSingle(): boolean {
    let event = this.event;
    return this.hasMinimalProps && event.hasChanged() ||
      this.hasMinimalProps && !!event.recurrenceRule && !event.parentEvent;
  }

  get hasChanges(): boolean {
    return this.event.hasChanged() || !!this.event.parentEvent?.hasChanged() || this.seriesEndChanged;
  }

  get willSend(): boolean {
    return this.isMeeting && !this.event.isIncomingMeeting;
  }

  get needsSeriesChoice(): boolean {
    return !!this.event.parentEvent && this.canSaveSeries;
  }

  seriesChoices(): SeriesChoice[] {
    let choices: SeriesChoice[] = [];
    if (this.canSaveSingle) {
      choices.push("occurrence");
    }
    if (this.event.seriesStatus == "middle") {
      choices.push("following");
    }
    choices.push("series");
    return choices;
  }

  async saveWith(choice: SeriesChoice | null) {
    if (choice == "series") {
      await this.changeAll();
    } else if (choice == "following") {
      await this.changeRemainder();
    } else if (choice == "occurrence") {
      await this.saveException();
    } else {
      await this.save();
    }
  }

  protected skippedOccurrences(): number {
    let event = this.event;
    let rule = event.parentEvent?.unedited?.recurrenceRule ?? event.parentEvent?.recurrenceRule;
    if (!rule || !event.recurrenceStartTime) {
      return 0;
    }
    return Math.max(0, rule.getIndexOfOccurrence(event.recurrenceStartTime));
  }

  applyPattern(pattern: RecurrencePattern) {
    this.pattern = pattern;
    pattern.applyTo(this.master);
  }

  removeRecurrence() {
    RecurrencePattern.removeFrom(this.event);
    this.pattern = RecurrencePattern.fromEvent(this.event);
  }

  // <copied from="../../../frontend/Calendar/EditEvent/DialogHeader.svelte">
  async confirmAndChangeRecurrenceRule(): Promise<boolean> {
    let event = this.event;
    let master = event.parentEvent || event;
    if (!master.recurrenceRule && master.unedited?.recurrenceRule) {
      if (!await showMessageBox(gt`Remove Recurrence`,
          gt`The appointment will no longer repeat, and all other occurrences of the series will be deleted. Is this OK?`)) {
        return false;
      }
    } else if (master.recurrenceRule && master.unedited?.recurrenceRule &&
        !master.unedited.recurrenceRule.timesMatch(master.recurrenceRule)) {
      if (!await showMessageBox(gt`Recurrence *=> Repetition of the event`,
          gt`Any exceptions associated with this recurring appointment will be lost. Is this OK?`)) {
        return false;
      }
    }
    return true;
  }

  cancel() {
    let event = this.event;
    event.cancelEditing();
    event.parentEvent?.cancelEditing();
    this.close(true);
  }

  async save() {
    let event = this.event;
    event.parentEvent?.cancelEditing();
    // Lookout: Also moves the recurrence with the series, confirms changes of the series rule here, and sets the series end from the recurrence dialog
    if (!event.parentEvent) {
      this.moveRecurrenceWithSeries();
      if (!await this.confirmAndChangeRecurrenceRule()) {
        return;
      }
    }
    await this.pattern.applyEndTo(event);
    await this.saveEvent(event);
    this.close();
  }

  async saveEvent(event: Event) {
    if (!event.calendar.events.contains(event)) {
      event.calendar.events.add(event);
    }
    await event.save();
  }
  // </copied>

  async changeAll() {
    let event = this.event;
    let master = event.parentEvent;
    let before = master.calendar.newEvent();
    before.copyFrom(master);
    master.startEditing();
    this.applyOccurrenceToSeries();
    if (!await this.confirmAndChangeRecurrenceRule()) {
      master.copyFrom(before);
      return;
    }
    await this.pattern.applyEndTo(master);
    await master.save();
    master.finishEditing();
    this.close();
  }

  // Unlike frontend, the series keeps its first occurrence. A changed day or time of the occurrence moves all occurrences.
  protected applyOccurrenceToSeries() {
    let event = this.event;
    let master = event.parentEvent;
    let original = event.unedited ?? event;
    let dayShift = EventEditFlow.daysBetween(original.startTime, event.startTime);
    let start = EventEditFlow.shift(master.startTime, dayShift, EventEditFlow.minutesOfDayBetween(original.startTime, event.startTime));
    let duration = event.duration != original.duration ? event.duration : master.duration;
    let timesChanged = start.getTime() != master.startTime.getTime() || duration != master.duration ||
      event.allDay != master.allDay || event.timezone != original.timezone;
    let { startTime, endTime, timezone, recurrenceRule: rule } = master;
    master.copyEditableFieldsFrom(event);
    if (timesChanged) {
      master.startTime = start;
      master.duration = duration;
    } else {
      master.startTime = startTime;
      master.endTime = endTime;
      master.timezone = timezone;
    }
    setReminderMinutesBefore(master, reminderMinutesBefore(event));
    if (timesChanged && rule) {
      EventEditFlow.moveRecurrence(master, rule, dayShift);
    }
  }

  // The Scheduling Assistant changes the times of a series directly, without the recurrence dialog
  protected moveRecurrenceWithSeries() {
    let master = this.event;
    let rule = master.recurrenceRule;
    let before = master.unedited;
    if (!rule || !before) {
      return;
    }
    let isRuleBefore = rule == before.recurrenceRule;
    let ruleStart = isRuleBefore ? before.startTime : rule.getOccurrenceByIndex(0);
    let ruleDuration = isRuleBefore ? before.duration : rule.masterDuration;
    if (master.startTime.getTime() == ruleStart.getTime() && master.duration == ruleDuration) {
      return;
    }
    EventEditFlow.moveRecurrence(master, rule, EventEditFlow.daysBetween(ruleStart, master.startTime));
  }

  protected static moveRecurrence(master: Event, rule: RecurrenceRule, dayShift: number) {
    let { frequency, interval, week, weekdays } = rule;
    master.newRecurrenceRule(frequency, interval, week, weekdays?.map(weekday => (weekday + dayShift % 7 + 7) % 7));
  }

  protected applySeriesTimesTo(remainder: Event) {
    let series = this.event.parentEvent;
    let before = series.unedited;
    if (!before) {
      return;
    }
    let duration = series.duration != before.duration ? series.duration : remainder.duration;
    let reminder = reminderMinutesBefore(remainder);
    remainder.startTime = EventEditFlow.shift(remainder.startTime, 0, EventEditFlow.minutesOfDayBetween(before.startTime, series.startTime));
    remainder.duration = duration;
    setReminderMinutesBefore(remainder, reminder);
  }

  static daysBetween(from: Date, to: Date): number {
    return Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
      Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / (24 * 60 * 60 * 1000));
  }

  static minutesOfDayBetween(from: Date, to: Date): number {
    return (to.getHours() - from.getHours()) * 60 + to.getMinutes() - from.getMinutes();
  }

  static shift(time: Date, days: number, minutes: number): Date {
    let shifted = new Date(time);
    shifted.setDate(shifted.getDate() + days);
    shifted.setMinutes(shifted.getMinutes() + minutes);
    return shifted;
  }

  // <copied from="../../../frontend/Calendar/EditEvent/DialogHeader.svelte">, plus the series end and the time from the recurrence dialog
  async changeRemainder() {
    let event = this.event;
    let skipped = this.skippedOccurrences();
    let master = event.calendar.newEvent();
    master.startEditing();
    master.copyEditableFieldsFrom(event);
    this.applySeriesTimesTo(master);
    master.calUID = null;
    if (event.parentEvent.recurrenceRule) {
      let { frequency, interval, week, weekdays } = event.parentEvent.recurrenceRule;
      master.newRecurrenceRule(frequency, interval, week, weekdays);
      await this.pattern.applyEndTo(master, skipped);
    }
    await this.saveEvent(master);
    master.finishEditing();
    event.cancelEditing();
    event.parentEvent.cancelEditing();
    await event.truncateRecurrence();
    this.close();
  }

  async saveException() {
    let event = this.event;
    event.parentEvent?.cancelEditing();
    await this.saveEvent(event);
    this.close();
  }

  close(deselect = false) {
    let event = this.event;
    event.finishEditing();
    calendarMustangApp.closeEvent(event);
    if (deselect) {
      selectedEvent.set(null);
    }
    this.onClosed();
  }
  // </copied>

  async deleteIt() {
    await CalendarActions.deleteOccurrence(this.event);
    this.close(true);
  }

  async deleteAll() {
    // <copied from="../CalendarActions.ts">
    let event = this.event;
    let isConfirmed = await askYesNo(gt`Delete Series`, event.isIncomingMeeting
      ? gt`Do you want to delete all occurrences of the recurring meeting "${event.title ?? ""}"?`
      : gt`Do you want to delete all occurrences of the recurring appointment "${event.title ?? ""}"?`);
    // </copied>
    if (!isConfirmed) {
      return;
    }
    await this.master.deleteIt();
    this.close(true);
  }

  async deleteRemainder() {
    await CalendarActions.deleteRemainder(this.event);
    this.close(true);
  }

  async cancelMeeting() {
    // <copied from="../CalendarActions.ts">
    let event = this.event;
    let isConfirmed = await askYesNo(gt`Cancel Meeting`, event.parentEvent
      ? gt`Do you want to cancel this occurrence of the meeting "${event.title ?? ""}" and send a cancellation to all attendees?`
      : gt`Do you want to cancel the meeting "${event.title ?? ""}" and send a cancellation to all attendees?`);
    // </copied>
    if (!isConfirmed) {
      return;
    }
    await this.deleteIt();
  }

  async cancelMeetingSeries() {
    // <copied from="../CalendarActions.ts">
    let event = this.event;
    let isConfirmed = await askYesNo(gt`Cancel Series`,
      gt`Do you want to cancel all occurrences of the meeting "${event.title ?? ""}" and send a cancellation to all attendees?`);
    // </copied>
    if (!isConfirmed) {
      return;
    }
    await this.master.deleteIt();
    this.close(true);
  }

  // <copied from="../../../frontend/Calendar/EditEvent/ParticipantsBox.svelte" onAddPerson()>
  static addParticipant(event: Event, person: PersonUID) {
    let participant = new Participant(person.emailAddress, person.name, InvitationResponse.Unknown);
    participant.person = person.findPerson(); // GAL entry is in no cached address book
    event.participants.add(participant);
    participant.person?.fetchEncryptionKeys()
      .catch(showError);
  }
  // </copied>

  static sameAddresses(first: PersonUID[], second: PersonUID[]): boolean {
    let addresses = (persons: PersonUID[]) => [...new Set(persons.map(person => person.emailAddress?.toLowerCase()))].sort().join("\n");
    return addresses(first) == addresses(second);
  }

  setAttendees(persons: PersonUID[]) {
    let event = this.event;
    if (persons.length) {
      this.inviteAttendees();
    }
    for (let attendee of this.attendees) {
      if (!persons.some(person => person.emailAddress == attendee.emailAddress)) {
        event.participants.remove(attendee);
      }
    }
    for (let person of persons) {
      if (!event.participants.some(participant => participant.emailAddress == person.emailAddress)) {
        EventEditFlow.addParticipant(event, person);
      }
    }
  }

  inviteAttendees() {
    // <copied from="../../../frontend/Calendar/EditEvent/EditEvent.svelte" expandParticipants()>
    if (this.event.myParticipation == InvitationResponse.Organizer) {
      return;
    }
    this.event.createMeeting();
    // </copied>
  }
}
