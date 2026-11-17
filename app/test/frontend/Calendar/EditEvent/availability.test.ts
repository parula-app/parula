// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Calendar } from "../../../../logic/Calendar/Calendar";
import { Event } from "../../../../logic/Calendar/Event";
import { Participant } from "../../../../logic/Calendar/Participant";
import { InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { FreeBusyEvent, FreeBusyStatus } from "../../../../logic/Calendar/FreeBusyEvent";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import type { TSMLMeetingTimePoll } from "../../../../logic/Mail/SML/TSML";
import { createMeetingTimePoll } from "../../../../logic/Mail/SML/SMLCreateKind";
import { selectedEvent } from "../../../../frontend/Calendar/selected";
import { notifications } from "../../../../logic/util/Notification";
import FreeSlots from "../../../../frontend/Calendar/EditEvent/Availability/FreeSlots.svelte";
import ParticipantsDayView from "../../../../frontend/Calendar/EditEvent/Availability/ParticipantsDayView.svelte";
import AvailabilityPoll from "../../../../frontend/Calendar/EditEvent/Availability/AvailabilityPoll.svelte";
import Availability from "../../../../frontend/Calendar/EditEvent/Availability/Availability.svelte";
import { CalendarEventMustangApp } from "../../../../frontend/Calendar/CalendarMustangApp";
import { selectedApp } from "../../../../frontend/AppsBar/selectedApp";
import { isDemo } from "../../../../frontend/AppsBar/demo";
import { getDateTimeLocale } from "../../../../l10n/l10n";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

const { composed } = vi.hoisted(() => ({ composed: [] as EMail[] }));
vi.mock("../../../../frontend/Mail/open", () => ({
  openComposer: (mail: EMail) => composed.push(mail),
}));

let identity: MailIdentity;

beforeAll(() => {
  appGlobal.remoteApp = {
    kyCreate: () => { throw new Error("The test should not talk to a server"); },
  } as any;
  let account = new JMAPAccount();
  account.emailAddress = "me@example.com";
  account.realname = "Me";
  identity = new MailIdentity(account);
  identity.emailAddress = account.emailAddress;
  identity.realname = account.realname;
  account.identities.add(identity);
  for (let specialFolder of [SpecialFolder.Inbox, SpecialFolder.Drafts, SpecialFolder.Sent]) {
    let folder = account.newFolder();
    folder.specialFolder = specialFolder;
    account.rootFolders.add(folder);
  }
  appGlobal.emailAccounts.add(account);
});

beforeEach(() => {
  selectedEvent.set(null);
  notifications.clear();
  composed.length = 0;
  localStorage.clear();
  isDemo.set(false);
});

function vacation(from: Date, to: Date): FreeBusyEvent {
  let event = new FreeBusyEvent(from, to, FreeBusyStatus.OutOfOffice);
  event.title = "Vacation";
  event.location = "Beach";
  return event;
}

/** Frida is free, Bob is on vacation, and the server knows nothing about Una */
class TestCalendar extends Calendar {
  constructor() {
    super();
    this.inviteAsIdentityID = identity.id;
  }

  async arePersonsFree(participants: Participant[], from: Date, to: Date) {
    return participants
      .filter(participant => !participant.emailAddress.startsWith("unknown"))
      .map(participant => ({
        participant,
        availability: participant.emailAddress.startsWith("busy")
          ? [vacation(from, to)]
          : [],
      }));
  }
}

const frida = new Participant("free@example.com", "Frida Free", InvitationResponse.NoResponseReceived);
const bob = new Participant("busy@example.com", "Bob Busy", InvitationResponse.NoResponseReceived);
const una = new Participant("unknown@example.com", "Una Unknown", InvitationResponse.NoResponseReceived);

/** Thursday, 10:00 to 11:00 */
/** A calendar whose server doesn't tell the availability of other people */
class NoFreeBusyCalendar extends Calendar {
  constructor() {
    super();
    this.inviteAsIdentityID = identity.id;
  }
}

function newMeeting(calendar: Calendar = new TestCalendar()): Event {
  let event = new Event(calendar);
  event.title = "Planning";
  event.startTime = new Date(2026, 8, 3, 10, 0);
  event.endTime = new Date(2026, 8, 3, 11, 0);
  event.participants.addAll([
    new Participant("me@example.com", "Me", InvitationResponse.Organizer),
    frida, bob, una,
  ]);
  return event;
}

let component: Record<string, any> | null = null;

afterEach(() => {
  if (component) {
    unmount(component);
    component = null;
  }
  document.body.innerHTML = "";
});

async function show(svelteComponent: any, props: Record<string, any>): Promise<void> {
  component = mount(svelteComponent, { target: document.body, props });
  await new Promise(resolve => setTimeout(resolve, 0));
  flushSync();
}

function text(selector: string): string[] {
  return [...document.querySelectorAll(selector)].map(element => element.textContent.trim());
}

test("Free slots: Each slot shows only its start time, and the details on hover", async () => {
  await show(FreeSlots, { event: newMeeting() });
  let slots = document.querySelectorAll(".slot");
  // Mon-Fri, 8:00-18:00
  expect(slots.length).toBe(5 * 10);
  let slot = slots[0];
  // Una's unknown availability doesn't count
  expect(slot.classList).toContain("availability-partly");
  expect(slot.textContent).not.toContain("Bob Busy");
  expect(slot.getAttribute("title")).toContain("Bob Busy");
  expect(slot.getAttribute("title")).toContain("Frida Free");
  expect(slot.getAttribute("title")).toContain("Una Unknown");
});

test("Free slots: Clicking a slot shows who is busy, free and unknown, and neither selects nor opens anything #1430", async () => {
  let event = newMeeting();
  let startTime = event.startTime;
  await show(FreeSlots, { event });
  let monday = document.querySelector(".slot");
  monday.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  monday.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  flushSync();

  expect(monday.classList).toContain("expanded");
  expect(text(".slot.expanded .detail")).toEqual([
    "Busy: Bob Busy",
    "Free: Me, Frida Free",
    "Unknown: Una Unknown",
  ]);
  expect(event.startTime).toBe(startTime);
  expect(notifications.contents.map(notification => notification.message)).toEqual([]);
  expect(get(selectedEvent)).toBeNull();

  monday.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  flushSync();
  expect(document.querySelector(".slot.expanded")).toBeNull();
});

test("Free slots: My appointments in my calendars count, but not the meeting itself", async () => {
  let event = newMeeting();
  event.myParticipation = InvitationResponse.Organizer;
  event.calendar.events.add(event);
  let myCalendar = new Calendar();
  let dentist = myCalendar.newEvent();
  dentist.title = "Dentist";
  dentist.startTime = new Date(2026, 8, 3, 14, 0);
  dentist.endTime = new Date(2026, 8, 3, 15, 0);
  myCalendar.events.add(dentist);
  appGlobal.calendars.addAll([event.calendar, myCalendar]);
  try {
    await show(FreeSlots, { event });
    let slots = document.querySelectorAll(".slot");
    // Rows are hours from 8:00, columns Mon-Fri
    let thursday = (hour: number) => slots[(hour - 8) * 5 + 3];
    expect(thursday(14).getAttribute("title")).toContain("Busy: Me, Bob Busy");
    expect(thursday(10).getAttribute("title")).toContain("Free: Me, Frida Free");
  } finally {
    appGlobal.calendars.removeAll([event.calendar, myCalendar]);
  }
});

test("Free slots: \"Use this time\" moves the meeting there", async () => {
  let event = newMeeting();
  await show(FreeSlots, { event });
  let monday = document.querySelector(".slot");
  monday.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  flushSync();
  (monday.querySelector("button.use-time") as HTMLElement).click();
  await new Promise(resolve => setTimeout(resolve, 0));
  flushSync();

  expect(event.startTime).toEqual(new Date(2026, 7, 31, 8, 0));
  expect(event.durationMinutes).toBe(60);
  expect(monday.classList).toContain("meeting");
});

test("Free slots: \"Week\" shows Saturday and Sunday too, and stays so for the next meeting", async () => {
  let event = newMeeting();
  await show(FreeSlots, { event });
  (document.querySelector('button[title="Week"]') as HTMLElement).click();
  await new Promise(resolve => setTimeout(resolve, 0));
  flushSync();

  let saturday = new Date(2026, 8, 5).toLocaleDateString(getDateTimeLocale(), { weekday: "long" });
  let sunday = new Date(2026, 8, 6).toLocaleDateString(getDateTimeLocale(), { weekday: "long" });
  expect(text(".day-header .weekday").slice(5)).toEqual([saturday, sunday]);
  expect(document.querySelectorAll(".slot").length).toBe(7 * 10);

  unmount(component);
  await show(FreeSlots, { event: newMeeting() });
  expect(text(".day-header .weekday").length).toBe(7);
});

test("Who is free when: One column per participant, with the appointments", async () => {
  await show(ParticipantsDayView, { event: newMeeting() });
  expect(text(".participant-header .name")).toEqual(["Me", "Frida Free", "Bob Busy", "Una Unknown"]);
  expect(text(".participant-header .status")).toEqual(["Available", "Available", "Busy", "No information"]);
  expect(text(".appointment .title")).toEqual(["Vacation"]);
  expect(text(".appointment .location")).toEqual(["Beach"]);
  expect(document.querySelectorAll(".no-info").length).toBe(1);
  expect(document.querySelector(".meeting")).not.toBeNull();
});

test("Who is free when: Clicking a time moves the meeting there", async () => {
  let event = newMeeting();
  await show(ParticipantsDayView, { event });
  let column = document.querySelectorAll(".day-column")[1] as HTMLElement;
  column.getBoundingClientRect = () => ({ top: 100, height: 2400 } as DOMRect);
  let hourSlot = column.querySelector(".hour-slot");
  // 14:40 snaps to 14:30
  hourSlot.dispatchEvent(new MouseEvent("click", { bubbles: true, clientY: 100 + 2400 * (14 * 60 + 40) / (24 * 60) }));
  flushSync();
  expect(event.startTime).toEqual(new Date(2026, 8, 3, 14, 30));
  expect(event.durationMinutes).toBe(60);
});

async function moveMeeting(event: Event, start: Date) {
  let duration = event.duration;
  event.startTime = start;
  event.duration = duration;
  flushSync();
  await new Promise(resolve => setTimeout(resolve, 0));
  flushSync();
}

test("Who is free when: Follows the meeting to another day, and loads the availability only for a new day", async () => {
  let event = newMeeting();
  let loads = vi.spyOn(event.calendar, "arePersonsFree");
  await show(ParticipantsDayView, { event });
  expect(loads).toHaveBeenCalledTimes(1);

  let column = document.querySelectorAll(".day-column")[1] as HTMLElement;
  column.getBoundingClientRect = () => ({ top: 100, height: 2400 } as DOMRect);
  column.querySelector(".hour-slot").dispatchEvent(new MouseEvent("click", { bubbles: true, clientY: 100 + 2400 * 14 / 24 }));
  flushSync();
  await moveMeeting(event, new Date(2026, 8, 3, 16, 0));
  expect(loads).toHaveBeenCalledTimes(1);

  // e.g. in the date field
  await moveMeeting(event, new Date(2026, 8, 4, 9, 0));
  expect(document.querySelector(".meeting")).not.toBeNull();
  expect(loads).toHaveBeenCalledTimes(2);
});

test("Who is free when, Free slots: After going to another day or week, changing the meeting's title doesn't go back", async () => {
  for (let view of [ParticipantsDayView, FreeSlots]) {
    let event = newMeeting();
    await show(view, { event });
    expect(document.querySelector(".meeting, .slot.meeting")).not.toBeNull();
    (document.querySelector("button.next-button") as HTMLElement).click();
    flushSync();
    await new Promise(resolve => setTimeout(resolve, 0));
    flushSync();
    expect(document.querySelector(".meeting, .slot.meeting")).toBeNull();

    event.title = "Planning, 2nd round";
    flushSync();
    expect(document.querySelector(".meeting, .slot.meeting")).toBeNull();
    unmount(component);
    component = null;
  }
});

test("Free slots: Follows the meeting to another week, and loads the availability only for a new week", async () => {
  let event = newMeeting();
  let loads = vi.spyOn(event.calendar, "arePersonsFree");
  await show(FreeSlots, { event });
  expect(loads).toHaveBeenCalledTimes(1);

  (document.querySelectorAll(".slot")[0] as HTMLElement).click();
  flushSync();
  (document.querySelector("button.use-time") as HTMLElement).click();
  flushSync();
  await moveMeeting(event, new Date(2026, 8, 4, 15, 0));
  expect(loads).toHaveBeenCalledTimes(1);

  // e.g. in the date field
  await moveMeeting(event, new Date(2026, 8, 10, 9, 0));
  expect(document.querySelector(".slot.meeting")).not.toBeNull();
  expect(loads).toHaveBeenCalledTimes(2);
});

test("Meeting time poll: Asks only the participants with unknown availability, or all of them", async () => {
  let event = newMeeting();
  let sml = createMeetingTimePoll(identity);
  (sml.sml as TSMLMeetingTimePoll).options.push(new Date(2026, 8, 4, 9, 0));
  await show(AvailabilityPoll, { event, sml });
  expect(text(".recipients .names")).toEqual(["Una Unknown"]);

  (document.querySelector("button.send") as HTMLElement).click();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(composed.length).toBe(1);
  let mail = composed[0];
  expect(mail.to.contents).toEqual([una]);
  expect(mail.subject).toBe("Planning");
  expect(mail.sml).toBe(sml);
  expect((mail.sml.sml as TSMLMeetingTimePoll).name).toBe("Planning");
  expect((mail.sml.sml as TSMLMeetingTimePoll).duration).toBe(60);

  (document.querySelector(".option .checkbox") as HTMLElement).click();
  flushSync();
  expect(text(".recipients .names")).toEqual(["Frida Free, Bob Busy, Una Unknown"]);
});

test("Meeting time poll: Remembers whether to ask only people with unknown availability", async () => {
  await show(AvailabilityPoll, { event: newMeeting() });
  (document.querySelector(".option .checkbox") as HTMLElement).click();
  flushSync();
  unmount(component);
  document.body.innerHTML = "";

  await show(AvailabilityPoll, { event: newMeeting() });
  expect(text(".recipients .names")).toEqual(["Frida Free, Bob Busy, Una Unknown"]);
});

test("Meeting time poll: When the availability of everybody is known, asks everybody", async () => {
  let event = newMeeting();
  event.participants.remove(una);
  await show(AvailabilityPoll, { event });
  await new Promise(resolve => setTimeout(resolve, 0));
  flushSync();
  expect(text(".recipients .names")).toEqual(["Frida Free, Bob Busy"]);
  let checkbox = document.querySelector(".option .checkbox");
  expect(checkbox.classList).toContain("disabled");
  expect(checkbox.getAttribute("title")).toBe("The availability of all participants is known");
  expect(checkbox.querySelector<HTMLInputElement>("input").checked).toBe(false);
});

test("Expanded by default, as soon as the availability of a participant is known", async () => {
  await show(Availability, { event: newMeeting() });
  await new Promise(resolve => setTimeout(resolve, 0));
  flushSync();
  expect(document.querySelector(".availability.expanded")).not.toBeNull();
  expect(document.querySelector(".free-slots")).not.toBeNull();
});

test("Collapsed by default without free/busy, and the view buttons expand it", async () => {
  isDemo.set(true);
  await show(Availability, { event: newMeeting(new NoFreeBusyCalendar()) });
  await new Promise(resolve => setTimeout(resolve, 0));
  flushSync();
  expect(document.querySelector(".availability.expanded")).toBeNull();
  (document.querySelector('button[title="Poll"]') as HTMLElement).click();
  flushSync();
  expect(document.querySelector(".availability.expanded")).not.toBeNull();
  expect(document.querySelector(".availability-poll")).not.toBeNull();
});

test("Without free/busy from the server, only the poll is available", async () => {
  isDemo.set(true);
  await show(Availability, { event: newMeeting(new NoFreeBusyCalendar()), expanded: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  flushSync();
  let reason = "This calendar doesn't provide the availability of other people";
  expect(document.querySelectorAll(`button[title="${reason}"]:disabled`).length).toBe(2);
  expect(document.querySelector(".availability-poll")).not.toBeNull();
  expect(text(".recipients .names")).toEqual(["Frida Free, Bob Busy, Una Unknown"]);
});

test("The poll only in demo mode, and without free/busy from the server no availability at all", async () => {
  await show(Availability, { event: newMeeting(), expanded: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  flushSync();
  expect(document.querySelector(".free-slots")).not.toBeNull();
  expect(document.querySelector('button[title="Poll"]')).toBeNull();
  unmount(component);
  document.body.innerHTML = "";

  await show(Availability, { event: newMeeting(new NoFreeBusyCalendar()), expanded: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  flushSync();
  expect(document.querySelector(".availability")).toBeNull();
});

test("Before anybody is invited, Free slots and Poll say so", async () => {
  let event = newMeeting();
  event.participants.clear();
  await show(FreeSlots, { event });
  await new Promise(resolve => setTimeout(resolve, 0));
  flushSync();
  expect(text(".free-slots .no-info")).toEqual(["Nobody is invited yet"]);
  unmount(component);
  document.body.innerHTML = "";

  await show(AvailabilityPoll, { event });
  await new Promise(resolve => setTimeout(resolve, 0));
  flushSync();
  expect(text(".recipients .names")).toEqual(["Nobody is invited yet"]);
  expect(document.querySelector('button.send[title="Nobody is invited yet"]:disabled')).not.toBeNull();
});

test("Enlarge in the sidebar opens the full window, which keeps the view", async () => {
  isDemo.set(true);
  let event = newMeeting();
  selectedApp.set(null);
  await show(Availability, { event, expanded: true });
  (document.querySelector('button[title="Poll"]') as HTMLElement).click();
  flushSync();
  (document.querySelector('button[title="Enlarge"]') as HTMLElement).click();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(get(selectedApp)).toBeInstanceOf(CalendarEventMustangApp);
  // Not this dialog in the sidebar, but the new one in the full window is enlarged
  expect(document.querySelector(".availability.enlarged")).toBeNull();
  unmount(component);
  document.body.innerHTML = "";

  await show(Availability, { event });
  expect(document.querySelector(".availability.enlarged")).not.toBeNull();
  expect(document.querySelector(".availability-poll")).not.toBeNull();
});
