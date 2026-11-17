// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Calendar } from "../../../../logic/Calendar/Calendar";
import type { Event } from "../../../../logic/Calendar/Event";
import { MeetAccount } from "../../../../logic/Meet/MeetAccount";
import type { URLString } from "../../../../logic/util/util";
import OnlineMeetingBox from "../../../../frontend/Calendar/EditEvent/OnlineMeetingBox.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, expect, test } from "vitest";

/** Counts the meetings it creates, instead of contacting a meeting server */
class FakeMeetAccount extends MeetAccount {
  canCreateURL = true;
  createdMeetings = 0;
  async createMeetingURL(): Promise<URLString> {
    this.createdMeetings++;
    return "https://meet.example.com/" + this.createdMeetings;
  }
}

let box: Record<string, any> | null = null;

afterEach(() => {
  closeBox();
  appGlobal.meetAccounts.clear();
  document.body.innerHTML = "";
});

/** A new event in a calendar that creates its online meetings with `meetAccount` */
function newEvent(meetAccount: MeetAccount): Event {
  appGlobal.meetAccounts.add(meetAccount);
  let calendar = new Calendar();
  calendar.meetAccount = meetAccount;
  let event = calendar.newEvent();
  event.startTime = new Date(2026, 8, 4, 10, 0);
  event.endTime = new Date(2026, 8, 4, 11, 0);
  return event;
}

/** What `EditEvent` does when the user turns "Online meeting" on:
 * It sets `isOnline`, and that shows the meeting box. */
async function turnOnlineMeetingOn(event: Event) {
  event.isOnline = true;
  await showBox(event);
}

async function showBox(event: Event) {
  box = mount(OnlineMeetingBox, {
    target: document.body,
    props: { event },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  flushSync();
}

/** The user clicks the Delete button in the meeting box.
 * `EditEvent` then hides the box, because `isOnline` is off. */
async function turnOnlineMeetingOff() {
  let deleteButton = document.querySelector<HTMLButtonElement>('button[title="Delete"]');
  expect(deleteButton).toBeTruthy();
  deleteButton.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  flushSync();
  closeBox();
}

function closeBox() {
  if (box) {
    unmount(box);
    box = null;
  }
}

test("Turning online meeting on and off again before saving creates no meeting", async () => {
  let meetAccount = new FakeMeetAccount();
  let event = newEvent(meetAccount);
  await turnOnlineMeetingOn(event);
  expect(event.createOnlineMeetingWithAccount).toBe(meetAccount);

  await turnOnlineMeetingOff();
  expect(event.isOnline).toBe(false);
  expect(event.createOnlineMeetingWithAccount).toBeNull();

  await event.prepareSaveToServer();
  expect(meetAccount.createdMeetings).toBe(0);
  expect(event.onlineMeetingURL).toBeFalsy();
});

test("Turning online meeting on, off and on again creates the meeting", async () => {
  let meetAccount = new FakeMeetAccount();
  let event = newEvent(meetAccount);
  await turnOnlineMeetingOn(event);
  await turnOnlineMeetingOff();
  await turnOnlineMeetingOn(event);
  // The meeting box picks the calendar's meeting account again
  expect(event.createOnlineMeetingWithAccount).toBe(meetAccount);
  closeBox();

  await event.prepareSaveToServer();
  expect(meetAccount.createdMeetings).toBe(1);
  expect(event.onlineMeetingURL).toBe("https://meet.example.com/1");
  expect(event.isOnline).toBe(true);
});

test("Opening an event with an existing meeting URL keeps it", async () => {
  let meetAccount = new FakeMeetAccount();
  let event = newEvent(meetAccount);
  event.isOnline = true;
  event.onlineMeetingURL = "https://teams.example.com/existing";
  await showBox(event);
  closeBox();

  await event.prepareSaveToServer();
  expect(meetAccount.createdMeetings).toBe(0);
  expect(event.onlineMeetingURL).toBe("https://teams.example.com/existing");
  expect(event.isOnline).toBe(true);
});
