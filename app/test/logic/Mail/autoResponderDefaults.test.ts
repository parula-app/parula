// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import { AutoResponder } from "../../../logic/Mail/AutoResponder";
import { beforeEach, expect, test } from "vitest";

appGlobal.remoteApp = {} as any;

beforeEach(() => {
  localStorage.clear();
});

function timeOfDay(time: Date): string {
  return time.getHours() + ":" + String(time.getMinutes()).padStart(2, "0");
}

function dayOffset(time: Date): number {
  let today = new Date();
  today.setHours(0, 0, 0, 0);
  let day = new Date(time);
  day.setHours(0, 0, 0, 0);
  return Math.round((day.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

test("The default time range is from today 0:00 until tomorrow 23:00", () => {
  let autoResponder = new AutoResponder(new MailAccount());
  expect(timeOfDay(autoResponder.startTime)).toBe("0:00");
  expect(dayOffset(autoResponder.startTime)).toBe(0);
  expect(timeOfDay(autoResponder.endTime)).toBe("23:00");
  expect(dayOffset(autoResponder.endTime)).toBe(1);
});

test("The next default time range has the times of day of the last saved one", () => {
  let autoResponder = new AutoResponder(new MailAccount());
  autoResponder.startTime = new Date(2026, 6, 1, 17, 30);
  autoResponder.endTime = new Date(2026, 6, 15, 8, 0);
  autoResponder.rememberTimes(); // not on: nothing to remember
  expect(timeOfDay(new AutoResponder(new MailAccount()).startTime)).toBe("0:00");

  autoResponder.isOn = true;
  autoResponder.scheduled = true;
  autoResponder.rememberTimes();
  let next = new AutoResponder(new MailAccount());
  expect(timeOfDay(next.startTime)).toBe("17:30");
  expect(dayOffset(next.startTime)).toBe(0);
  expect(timeOfDay(next.endTime)).toBe("8:00");
  expect(dayOffset(next.endTime)).toBe(1);
});
