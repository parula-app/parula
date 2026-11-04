// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { Event } from "../../../../logic/Calendar/Event";
import { Participant } from "../../../../logic/Calendar/Participant";
import { InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { Frequency } from "../../../../logic/Calendar/RecurrenceRule";
import { EventTable, EventTableColumn, EventTableGrouping } from "../../../Calendar/ListView/EventTable";
import { eventOrganizers } from "../../../Calendar/ListView/CalendarSearch";
import { expect, test } from "vitest";

function newEvent(title: string, day: number, location = ""): Event {
  let event = new Event();
  event.title = title;
  event.location = location;
  event.startTime = new Date(2026, 9, day, 9);
  event.endTime = new Date(2026, 9, day, 10);
  return event;
}

function weekly(title: string, day: number): Event {
  let event = newEvent(title, day);
  event.newRecurrenceRule(Frequency.Weekly);
  return event;
}

test("Groups by recurrence: (none) first, then by frequency", () => {
  let single = newEvent("Dentist", 20);
  let standup = weekly("Standup", 12);
  let review = newEvent("Review", 14);
  let groups = new EventTable().groups([ standup, single, review ]);
  expect(groups.map(group => group.id)).toEqual([ Frequency.None, Frequency.Weekly ]);
  expect(groups[0].label).toBe("Recurrence: (none)");
  expect(groups[0].events).toEqual([ review, single ]);
  expect(groups[1].label).toBe("Recurrence: Weekly");
  expect(groups[1].events).toEqual([ standup ]);
});

test("Without grouping, one group with all events", () => {
  let groups = new EventTable(EventTableColumn.Start, true, EventTableGrouping.None)
    .groups([ weekly("Standup", 12), newEvent("Dentist", 20) ]);
  expect(groups.length).toBe(1);
  expect(groups[0].label).toBe("");
  expect(groups[0].events.length).toBe(2);
});

test("Sorts by the chosen column, a second click reverses", () => {
  let a = newEvent("beta", 3, "Room 2");
  let b = newEvent("Alpha", 2, "");
  let c = newEvent("gamma", 1, "Room 1");
  let table = new EventTable(EventTableColumn.Subject, true, EventTableGrouping.None);
  expect(table.sorted([ a, b, c ])).toEqual([ b, a, c ]);
  table.toggleSort(EventTableColumn.Subject);
  expect(table.ascending).toBe(false);
  expect(table.sorted([ a, b, c ])).toEqual([ c, a, b ]);
  table.toggleSort(EventTableColumn.Location);
  expect(table.sortColumn).toBe(EventTableColumn.Location);
  expect(table.ascending).toBe(true);
  // Empty locations go last
  expect(table.sorted([ a, b, c ])).toEqual([ c, a, b ]);
  table.toggleSort(EventTableColumn.Start);
  expect(table.sorted([ a, b, c ])).toEqual([ c, b, a ]);
});

test("Lists single events and series, not occurrences", () => {
  let series = weekly("Standup", 12);
  expect(EventTable.isListed(series)).toBe(true);
  expect(EventTable.isListed(newEvent("Dentist", 20))).toBe(true);
  let occurrence = new Event(undefined, series);
  expect(EventTable.isListed(occurrence)).toBe(false);
});

test("Recurrence pattern text only for series", () => {
  expect(EventTable.recurrenceLabel(newEvent("Dentist", 20))).toBe("");
  expect(EventTable.recurrenceLabel(weekly("Standup", 12))).toMatch(/^Every week/);
});

test("All-day end shows the last day, not the next day", () => {
  let event = newEvent("Offsite", 20);
  event.allDay = true;
  event.startTime = new Date(2026, 9, 20);
  event.endTime = new Date(2026, 9, 22);
  expect(EventTable.timeLabel(event, true, "en-US")).toBe("Wed 10/21/2026");
  expect(EventTable.timeLabel(event, false, "en-US")).toBe("Tue 10/20/2026");
  expect(EventTable.timeLabel(newEvent("Standup", 12), false, "en-US")).toBe("Mon 10/12/2026 9:00 AM");
});

test("Search organizers: each organizer once", () => {
  let series = weekly("Team standup", 12);
  let single = newEvent("Team lunch", 20);
  single.participants.add(new Participant("wanda@example.com", "Wanda Howard", InvitationResponse.Organizer));
  expect(eventOrganizers([ series, single, single ]).map(person => person.emailAddress)).toEqual([ "wanda@example.com" ]);
});
