import '../../../logic/app'; // Import first, to set up the module graph and dodge the Account import cycle
import { afterEach, expect, test, vi } from 'vitest';
import { Event, RecurrenceCase } from '../../../logic/Calendar/Event';
import { Calendar } from '../../../logic/Calendar/Calendar';
import { Participant } from '../../../logic/Calendar/Participant';
import { InvitationResponse } from '../../../logic/Calendar/Invitation/InvitationStatus';
import { OutgoingInvitation } from '../../../logic/Calendar/Invitation/OutgoingInvitation';
import { DummyCalendarStorage } from '../../../logic/Calendar/SQL/DummyCalendarStorage';
import { Frequency, Weekday } from '../../../logic/Calendar/RecurrenceRule';
import type { Collection } from 'svelte-collections';

/** A weekly meeting series that our user organizes, every Monday at 9:00 */
function meetingSeries(): Event {
  let calendar = new Calendar();
  calendar.storage = new DummyCalendarStorage();
  let master = calendar.newEvent();
  master.calUID = "weekly-meeting";
  master.title = "Weekly";
  master.startTime = new Date(2027, 0, 4, 9, 0);
  master.endTime = new Date(2027, 0, 4, 10, 0);
  // Without it, `startEditing()` sets the user's time zone, which changes the times of the series
  master.timezone = "Europe/Berlin";
  master.myParticipation = InvitationResponse.Organizer;
  master.participants.add(new Participant("organizer@example.com", "Organizer", InvitationResponse.Organizer));
  master.participants.add(new Participant("attendee@example.com", "Attendee", InvitationResponse.Accept));
  master.newRecurrenceRule(Frequency.Weekly, 1, 0, [Weekday.Monday]);
  return master;
}

function addException(master: Event, index: number): Event {
  let exception = master.calendar.newEvent(master);
  exception.recurrenceCase = RecurrenceCase.Exception;
  exception.recurrenceStartTime = master.recurrenceRule.getOccurrenceByIndex(index);
  exception.startTime = new Date(exception.recurrenceStartTime.getTime() + 36e5);
  exception.endTime = new Date(exception.startTime.getTime() + 36e5);
  master.exceptions.add(exception);
  return exception;
}

function spyOnInvitations() {
  return vi.spyOn(OutgoingInvitation.prototype, "sendInvitations").mockResolvedValue();
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** The ends of a series, set as the recurrence dialog sets them */
const kSeriesEnds: Record<string, (master: Event) => Promise<void>> = {
  "no end": master => master.setRecurrenceCount(Infinity),
  "10 times": master => master.setRecurrenceCount(10),
  "5 times": master => master.setRecurrenceCount(5),
  "1 March": master => master.setRecurrenceEndTime(new Date(2027, 2, 1, 23, 59, 59)),
  "1 February": master => master.setRecurrenceEndTime(new Date(2027, 1, 1, 23, 59, 59)),
};

// Only the series end changed, so `hasChanged()` was false, and the attendees
// kept the old end in their calendars.
test.each([
  ["no end", "10 times"],
  ["no end", "1 March"],
  ["10 times", "5 times"],
  ["10 times", "no end"],
  ["1 March", "1 February"],
  ["1 March", "no end"],
  ["10 times", "1 March"],
])("Attendees get an update when the series end changes from %s to %s", async (before, after) => {
  let master = meetingSeries();
  await kSeriesEnds[before](master);
  let sendInvitations = spyOnInvitations();

  master.startEditing();
  await kSeriesEnds[after](master);
  expect(master.hasChanged()).toBe(true);
  await master.save();

  expect(sendInvitations).toHaveBeenCalledTimes(1);
});

test("Attendees get no update when the series is saved unchanged", async () => {
  let master = meetingSeries();
  await master.setRecurrenceCount(10);
  let sendInvitations = spyOnInvitations();

  master.startEditing();
  // The recurrence editor builds a new rule as soon as it opens, which keeps the end
  master.newRecurrenceRule(Frequency.Weekly, 1, 0, [Weekday.Monday]);
  expect(master.hasChanged()).toBe(false);
  await master.save();

  expect(sendInvitations).not.toHaveBeenCalled();
});

// A change of the occurrence times removes all exceptions. A change of only the
// series end must keep them, apart from those that are no longer in the series.
test("A new series end keeps the exceptions within the series", async () => {
  let master = meetingSeries();
  let early = addException(master, 2);
  let late = addException(master, 20);
  spyOnInvitations();

  master.startEditing();
  await master.setRecurrenceCount(10);
  await master.save();
  master.finishEditing();

  expect(master.exceptions.length).toBe(1);
  expect(master.exceptions.contains(early)).toBe(true);
  expect(master.exceptions.contains(late)).toBe(false);
});

// "This and following" and "Delete this and following" shortened the old series
// outside of an editing session, so `hasChanged()` was false, and the attendees
// kept the removed occurrences in their calendars.
test.each([
  ["no end"],
  ["10 times"],
  ["1 March"],
])("Attendees get an update when a series with %s is truncated", async (before) => {
  let master = meetingSeries();
  await kSeriesEnds[before](master);
  let early = addException(master, 1);
  let sendInvitations = spyOnInvitations();

  let instance = master.getOccurrenceByDate(master.recurrenceRule.getOccurrenceByIndex(3));
  await instance.truncateRecurrence();

  expect(sendInvitations).toHaveBeenCalledTimes(1);
  expect(master.recurrenceRule.count).toBe(3);
  expect(master.unedited).toBeNull();
  expect(master.exceptions.contains(early)).toBe(true);
});

/** Records the invitation emails that the organizer sends, instead of sending them */
function spyOnSentInvitations() {
  let sent: { method: string, event: Event, to: string[] }[] = [];
  vi.spyOn(OutgoingInvitation.prototype as any, "send").mockImplementation(async function (this: OutgoingInvitation, method: string, participants: Collection<Participant>) {
    sent.push({ method, event: this.event, to: participants.contents.map(participant => participant.emailAddress) });
  });
  return sent;
}

// The last occurrence was changed, so the series keeps its end, and truncating
// it only adds exclusions. `hasChanged()` and `changesNeedToNotify()` ignored
// the exclusions, so the attendees kept the removed occurrences in their calendars.
test("Attendees get an update when truncating a series only excludes occurrences", async () => {
  let master = meetingSeries();
  await master.setRecurrenceCount(10);
  let rule = master.recurrenceRule;
  addException(master, 9);
  let sent = spyOnSentInvitations();

  let instance = master.getOccurrenceByDate(master.recurrenceRule.getOccurrenceByIndex(5));
  await instance.truncateRecurrence();

  expect(master.recurrenceRule).toBe(rule);
  let excluded = master.exclusions.contents.map(exclusion => rule.getIndexOfOccurrence(exclusion));
  expect(excluded.sort((a, b) => a - b)).toEqual([5, 6, 7, 8]);
  expect(sent).toEqual([{ method: "REQUEST", event: master, to: ["attendee@example.com"] }]);
});
