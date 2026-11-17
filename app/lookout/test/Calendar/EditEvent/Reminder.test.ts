// @vitest-environment happy-dom
import "../../../../logic/app"; // first, to resolve the import cycle around Abstract/Account.ts
import { Event } from "../../../../logic/Calendar/Event";
import { reminderMinutesBefore, setReminderMinutesBefore, reminderChoicesWith, reminderMinutesLabel } from "../../../Calendar/EditEvent/Reminder";
import { expect, test } from "vitest";

function newEvent(): Event {
  let event = new Event();
  event.startTime = new Date(2026, 9, 15, 10, 0);
  event.endTime = new Date(2026, 9, 15, 11, 0);
  return event;
}

test("Minutes before the start", () => {
  let event = newEvent();
  expect(reminderMinutesBefore(event)).toBe(null);
  event.alarm = new Date(2026, 9, 15, 9, 45);
  expect(reminderMinutesBefore(event)).toBe(15);
  event.alarm = new Date(2026, 9, 15, 10, 0);
  expect(reminderMinutesBefore(event)).toBe(0);
});

test("Set the reminder", () => {
  let event = newEvent();
  setReminderMinutesBefore(event, 30);
  expect(event.alarm).toEqual(new Date(2026, 9, 15, 9, 30));
  setReminderMinutesBefore(event, 1440);
  expect(event.alarm).toEqual(new Date(2026, 9, 14, 10, 0));
  setReminderMinutesBefore(event, null);
  expect(event.alarm).toBe(null);
});

test("Labels like Outlook", () => {
  expect(reminderMinutesLabel(null)).toBe("None");
  expect(reminderMinutesLabel(0)).toBe("0 minutes");
  expect(reminderMinutesLabel(1)).toBe("1 minute");
  expect(reminderMinutesLabel(15)).toBe("15 minutes");
  expect(reminderMinutesLabel(60)).toBe("1 hour");
  expect(reminderMinutesLabel(90)).toBe("1.5 hours");
  expect(reminderMinutesLabel(120)).toBe("2 hours");
  expect(reminderMinutesLabel(720)).toBe("0.5 days");
  expect(reminderMinutesLabel(1080)).toBe("18 hours");
  expect(reminderMinutesLabel(1440)).toBe("1 day");
  expect(reminderMinutesLabel(2880)).toBe("2 days");
  expect(reminderMinutesLabel(10080)).toBe("1 week");
  expect(reminderMinutesLabel(20160)).toBe("2 weeks");
  expect(reminderMinutesLabel(45)).toBe("45 minutes");
  expect(reminderMinutesLabel(100)).toBe("100 minutes");
});

test("Choices contain a custom current value, in order", () => {
  let standard = reminderChoicesWith(15);
  expect(standard[0]).toBe(null);
  expect(standard).toContain(15);
  expect(standard).toContain(1080);
  let custom = reminderChoicesWith(45);
  expect(custom.length).toBe(standard.length + 1);
  expect(custom.indexOf(45)).toBe(custom.indexOf(30) + 1);
  expect(reminderChoicesWith(null)).toEqual(standard);
});

test("The list of Outlook classic", () => {
  expect(reminderChoicesWith(15).map(minutes => reminderMinutesLabel(minutes))).toEqual([
    "None", "0 minutes", "5 minutes", "10 minutes", "15 minutes", "30 minutes",
    "1 hour", "2 hours", "3 hours", "4 hours", "5 hours", "6 hours", "7 hours", "8 hours", "9 hours", "10 hours", "11 hours",
    "0.5 days", "18 hours", "1 day", "2 days", "3 days", "4 days", "1 week", "2 weeks",
  ]);
});
