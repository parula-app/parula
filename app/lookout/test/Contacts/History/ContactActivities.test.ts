// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { EMail } from "../../../../logic/Mail/EMail";
import { Event } from "../../../../logic/Calendar/Event";
import { File } from "../../../../logic/Files/File";
import { ActivityKind, ContactActivities } from "../../../Contacts/History/ContactActivities";
import { expect, test } from "vitest";

test("Activities are messages, files and meetings, each with its time", () => {
  let sent = new Date(2026, 9, 1, 10);
  let message = new EMail(null);
  message.sent = sent;
  expect(ContactActivities.kindOf(message)).toBe(ActivityKind.Messages);
  expect(ContactActivities.timeOf(message)).toBe(sent);

  let file = new File();
  file.lastMod = sent;
  expect(ContactActivities.kindOf(file)).toBe(ActivityKind.Files);
  expect(ContactActivities.timeOf(file)).toBe(sent);

  let meeting = new Event();
  meeting.startTime = sent;
  expect(ContactActivities.kindOf(meeting)).toBe(ActivityKind.Meetings);
  expect(ContactActivities.timeOf(meeting)).toBe(sent);
});

test("Show more raises the limit like the frontend's contact history", () => {
  let activities = new ContactActivities(null);
  expect(activities.limit).toBe(200);
  expect(activities.all.isEmpty).toBe(true);
  expect(activities.of(ActivityKind.Messages).isEmpty).toBe(true);
  expect(activities.more().limit).toBe(1000);
  expect(activities.more().more().limit).toBe(2000);
});
