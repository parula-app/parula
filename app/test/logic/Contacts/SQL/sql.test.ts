import { makeTestDatabase } from '../../../../logic/Contacts/SQL/SQLDatabase';
import { ContactEntry } from '../../../../logic/Abstract/Person';
import { SQLAddressbook } from '../../../../logic/Contacts/SQL/SQLAddressbook';
import { SQLGroup } from '../../../../logic/Contacts/SQL/SQLGroup';
import { SQLPerson } from '../../../../logic/Contacts/SQL/SQLPerson';
import { FakeAddressbook, FakeChatPerson, fakeGroups, fakePersons } from '../../../../logic/testData';
import { appGlobal } from '../../../../logic/app';
import { connectToBackend } from '../../util/backend';
import { Collection } from 'svelte-collections';
import { expect, test } from 'vitest';

test("Save and read contacts from SQL database", { timeout: 10000 }, async () => {
  await connectToBackend();
  await makeTestDatabase(); // Let SQLFoo classes use the test database

  // Fake data
  appGlobal.me = new FakeChatPerson();
  let originalAddressbook = new FakeAddressbook();
  expect(originalAddressbook).toBeDefined();
  fakePersons(50, originalAddressbook);
  fakeGroups(10, 15, originalAddressbook);
  expect(originalAddressbook.persons.length).toBeGreaterThan(2);
  expect(originalAddressbook.groups.length).toBeGreaterThan(2);

  // Save
  await SQLAddressbook.save(originalAddressbook);
  expect(originalAddressbook.dbID).toBeDefined();
  for (let group of originalAddressbook.groups) {
    await SQLGroup.save(group);
    expect(group.participants.length).toBeGreaterThan(0);
  }
  for (let person of originalAddressbook.persons) {
    await SQLPerson.save(person);
    expect(person.emailAddresses.length).toBeGreaterThan(0);
  }

  // Clear
  originalAddressbook.persons.clear();
  appGlobal.addressbooks.clear();

  // Read
  let readAddressbooks = await SQLAddressbook.readAll();
  expect(readAddressbooks.length).toBeGreaterThan(0);
  for (let readAddressbook of readAddressbooks) {
    expect(readAddressbook.dbID).toBeDefined();
    await SQLGroup.readAll(readAddressbook); // also reads persons
  }
  expect(appGlobal.addressbooks.length).toBe(0);
  appGlobal.addressbooks.addAll(readAddressbooks);
  expect(appGlobal.addressbooks.length).toBeGreaterThan(0);

  // Check and verify
  // Account
  let readAddressbook = appGlobal.addressbooks.first;
  expect(readAddressbook).toBeDefined();
  expect(readAddressbook.dbID).toBeDefined();
  expect(readAddressbook.protocol).toEqual(originalAddressbook.protocol);
  expect(readAddressbook.name).toEqual(originalAddressbook.name);
  expect(readAddressbook.username).toEqual(originalAddressbook.username);
  expect(readAddressbook.realname).toEqual(originalAddressbook.realname);
  expect(readAddressbook.url).toEqual(originalAddressbook.url);

  // Person
  let readPersons = readAddressbook.persons;
  expect(readPersons.length).toBeGreaterThan(0);
  for (let originalPerson of originalAddressbook.persons) {
    let readPerson = readPersons.find(p =>
      p.emailAddresses.first?.value == originalPerson.emailAddresses.first?.value);
    expect(readPerson).toBeDefined();
    expect(readPerson.name).toEqual(originalPerson.name);
    expect(readPerson.firstName).toEqual(originalPerson.firstName);
    expect(readPerson.lastName).toEqual(originalPerson.lastName);
    expect(readPerson.picture).toEqual(originalPerson.picture);
    expect(readPerson.notes).toEqual(originalPerson.notes);
    compareContactEntries(readPerson.emailAddresses, originalPerson.emailAddresses);
    compareContactEntries(readPerson.chatAccounts, originalPerson.chatAccounts);
    compareContactEntries(readPerson.phoneNumbers, originalPerson.phoneNumbers);
    compareContactEntries(readPerson.streetAddresses, originalPerson.streetAddresses);
  }

  // Group
  let readGroups = readAddressbook.groups;
  expect(readGroups.length).toBeGreaterThan(0);
  for (let originalGroup of originalAddressbook.groups) {
    let readGroup = readGroups.find(p => p.name == originalGroup.name);
    expect(readGroup).toBeDefined();
    expect(readGroup.name).toEqual(originalGroup.name);
    expect(readGroup.picture).toEqual(originalGroup.picture);
    expect(readGroup.description).toEqual(originalGroup.description);
    expect(readGroup.participants.length).toEqual(originalGroup.participants.length);
    for (let originalMember of originalGroup.participants) {
      let readMember = readGroup.participants.find(p => p.dbID == originalMember.dbID);
        /*p.emailAddresses.first?.value == originalMember.emailAddresses.first?.value &&
        p.emailAddresses.first?.purpose == originalMember.emailAddresses.first?.purpose);*/
      expect(readMember).toBeDefined();
      expect(readMember.name).toEqual(originalMember.name);
      expect(readMember.picture).toEqual(originalMember.picture);
    }
  }
});

function compareContactEntries(readEntries: Collection<ContactEntry>, originalEntries: Collection<ContactEntry>) {
  expect(readEntries.length).toEqual(originalEntries.length);
  for (let original of originalEntries) {
    let read = readEntries.find(c =>
      c.value == original.value &&
      c.purpose == original.purpose);
    expect(read).toBeDefined();
    expect(read.purpose).toEqual(original.purpose);
    expect(read.preference).toEqual(original.preference);
  }
}

