import { makeTestDatabase } from '../../../../logic/Calendar/SQL/SQLDatabase';
import { SQLCalendar } from '../../../../logic/Calendar/SQL/SQLCalendar';
import { SQLEvent } from '../../../../logic/Calendar/SQL/SQLEvent';
import { FakeAddressbook, FakeCalendar, FakeChatPerson, fakePersons } from '../../../../logic/testData';
import { appGlobal } from '../../../../logic/app';
import { connectToBackend } from '../../util/backend';
import { expect, test } from 'vitest';
import { SQLPerson } from '../../../../logic/Contacts/SQL/SQLPerson';

test("Save and read calendars from SQL database", { timeout: 10000 }, async () => {
  await connectToBackend();
  await makeTestDatabase(); // Let SQLFoo classes use the test database

  // Fake data
  appGlobal.me = new FakeChatPerson();
  let addressbook = new FakeAddressbook();
  fakePersons(50, addressbook);
  appGlobal.addressbooks.add(addressbook);
  let originalCalendar = new FakeCalendar(addressbook.persons);
  expect(originalCalendar).toBeDefined();
  for (let event of originalCalendar.events) {
    if (Math.random() < 0.3) {
      let participantCount = Math.ceil(Math.random() * 8);
      for (let i = 0; i < participantCount; i++) {
        let person = addressbook.persons.getIndex(Math.floor(Math.random() * addressbook.persons.length));
        event.participants.add(person);
      }
    }
  }
  let personID = 0;
  SQLPerson.save = async (p) => { p.dbID = ++personID };

  // Save
  await SQLCalendar.save(originalCalendar);
  expect(originalCalendar.dbID).toBeDefined();
  for (let event of originalCalendar.events) {
    await SQLEvent.save(event);
  }

  // Clear
  appGlobal.calendars.clear();

  // Read
  let readCalendars = await SQLCalendar.readAll();
  expect(readCalendars.length).toBeGreaterThan(0);
  for (let readCalendar of readCalendars) {
    expect(readCalendar.dbID).toBeDefined();
    await SQLEvent.readAll(readCalendar); // also reads persons
  }
  expect(appGlobal.calendars.length).toBe(0);
  appGlobal.calendars.addAll(readCalendars);
  expect(appGlobal.calendars.length).toBeGreaterThan(0);

  // Check and verify
  // Account
  let readCalendar = appGlobal.calendars.first;
  expect(readCalendar).toBeDefined();
  expect(readCalendar.dbID).toBeDefined();
  expect(readCalendar.protocol).toEqual(originalCalendar.protocol);
  expect(readCalendar.name).toEqual(originalCalendar.name);
  expect(readCalendar.username).toEqual(originalCalendar.username);
  expect(readCalendar.realname).toEqual(originalCalendar.realname);
  expect(readCalendar.url).toEqual(originalCalendar.url);

  // Event
  let readEvents = readCalendar.events;
  expect(readEvents.length).toBeGreaterThan(0);
  for (let originalEvent of originalCalendar.events) {
    let readEvent = readEvents.find(p =>
      p.title == originalEvent.title &&
      p.startTime.getTime() == originalEvent.startTime.getTime());
    expect(readEvent).toBeDefined();
    expect(readEvent.title).toEqual(originalEvent.title);
    expect(readEvent.descriptionText).toEqual(originalEvent.descriptionText);
    expect(readEvent.descriptionHTML).toEqual(originalEvent.descriptionHTML);
    expect(readEvent.participants.length).toEqual(originalEvent.participants.length);
    for (let originalParticipant of originalEvent.participants) {
      let readParticipant = readEvent.participants.find(p => p.dbID == originalParticipant.dbID);
      expect(readParticipant).toBeDefined();
      expect(readParticipant.name).toEqual(originalParticipant.name);
      expect(readParticipant.picture).toEqual(originalParticipant.picture);
    }
  }
});

