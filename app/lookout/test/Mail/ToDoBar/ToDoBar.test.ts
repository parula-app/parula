// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { appGlobal } from "../../../../logic/app";
import { Event } from "../../../../logic/Calendar/Event";
import { Calendar } from "../../../../logic/Calendar/Calendar";
import { Addressbook } from "../../../../logic/Contacts/Addressbook";
import { ContactEntry, Person } from "../../../../logic/Abstract/Person";
import ToDoBar, { ToDoBarPart } from "../../../Mail/ToDoBar/ToDoBar.svelte";
import { agendaDays } from "../../../Mail/ToDoBar/ToDoAgenda";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../../../Mail/ToDoBar/ToDoAgenda", async (importOriginal) => {
  let original = await importOriginal<typeof import("../../../Mail/ToDoBar/ToDoAgenda")>();
  return { ...original, agendaDays: vi.fn(original.agendaDays) };
});

let calendar: Calendar;
let addressbook: Addressbook;
let app: Record<string, any> | null = null;

function inDays(days: number, hour: number): Date {
  let today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, hour);
}

function newEvent(title: string, days: number): Event {
  let event = new Event();
  event.title = title;
  event.startTime = inDays(days, 10);
  event.endTime = inDays(days, 11);
  event.calendar = calendar;
  calendar.events.add(event);
  return event;
}

function newPerson(name: string, popularity: number): Person {
  let person = new Person(addressbook);
  person.name = name;
  person.popularity = popularity;
  person.emailAddresses.add(new ContactEntry(name.toLowerCase() + "@example.com", "work"));
  addressbook.persons.add(person);
  return person;
}

function eventTitles(): string[] {
  return [...document.querySelectorAll(".event-title")].map(title => title.textContent.trim());
}

function personNames(): string[] {
  return [...document.querySelectorAll(".person-name")].map(name => name.textContent.trim());
}

beforeEach(() => {
  calendar = new Calendar();
  calendar.id = "todo-test";
  calendar.name = "Work";
  addressbook = new Addressbook();
  addressbook.name = "Personal";
  appGlobal.calendars.add(calendar);
  appGlobal.addressbooks.replaceAll([addressbook]);
});

afterEach(() => {
  if (app) {
    unmount(app);
  }
  app = null;
  document.body.innerHTML = "";
  appGlobal.calendars.remove(calendar);
  vi.mocked(agendaDays).mockClear();
});

function mountToDoBar() {
  let target = document.createElement("div");
  document.body.append(target);
  app = mount(ToDoBar, { target, props: { parts: [ToDoBarPart.Calendar, ToDoBarPart.People] } });
  flushSync();
}

test("The agenda shows the events of the next days, and follows changes of these events", () => {
  newEvent("Standup", 1);
  let review = newEvent("Review", 3);
  let later = newEvent("Offsite", 20);
  mountToDoBar();
  expect(eventTitles()).toEqual(["Standup", "Review"]);
  review.title = "Design review";
  flushSync();
  expect(eventTitles()).toEqual(["Standup", "Design review"]);
  later.startTime = inDays(2, 10);
  later.endTime = inDays(2, 11);
  flushSync();
  expect(eventTitles()).toEqual(["Standup", "Offsite", "Design review"]);
  newEvent("Lunch", 0);
  flushSync();
  expect(eventTitles()).toEqual(["Lunch", "Standup", "Offsite", "Design review"]);
});

test("Changing an event outside the agenda doesn't build the agenda again", () => {
  newEvent("Standup", 1);
  let later = newEvent("Offsite", 20);
  mountToDoBar();
  vi.mocked(agendaDays).mockClear();
  later.title = "Team offsite";
  flushSync();
  expect(agendaDays).not.toHaveBeenCalled();
});

test("The most popular people show first, and only the shown people are observed", () => {
  let rare = newPerson("Rare", 1);
  newPerson("Often", 50);
  newPerson("Sometimes", 10);
  let manyOthers = Array.from({ length: 12 }, (_, i) => newPerson("Contact " + i, 20));
  mountToDoBar();
  let byName = manyOthers.map(person => person.name).sort((a, b) => a.localeCompare(b));
  expect(personNames()).toEqual(["Often", ...byName.slice(0, 9)]);
  expect(rare._observers.length).toBe(0);
  let frequent = newPerson("Frequent", 30);
  flushSync();
  expect(personNames().slice(0, 2)).toEqual(["Often", frequent.name]);
  frequent.name = "Frequent Flyer";
  flushSync();
  expect(personNames()[1]).toBe("Frequent Flyer");
});
