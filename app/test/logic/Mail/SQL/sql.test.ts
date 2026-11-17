import { EMail } from '../../../../logic/Mail/EMail';
import { Folder, SpecialFolder } from '../../../../logic/Mail/Folder';
import { SQLMailAccount } from '../../../../logic/Mail/SQL/SQLMailAccount';
import { SQLEMail } from '../../../../logic/Mail/SQL/SQLEMail';
import { SQLFolder } from '../../../../logic/Mail/SQL/SQLFolder';
import { SQLSearchEMail } from '../../../../logic/Mail/SQL/SQLSearchEMail';
import { readMailAccounts } from '../../../../logic/Mail/AccountsList/MailAccounts';
import { FakeMailAccount, FakeChatPerson, fakePersons, FakeAddressbook } from '../../../../logic/testData';
import { makeTestDatabase } from '../../../../logic/Mail/SQL/SQLDatabase';
import { connectToBackend } from '../../util/backend';
import { appGlobal } from '../../../../logic/app';
import { ArrayColl } from 'svelte-collections';
import { expect, test } from 'vitest';

test("Save and read mails from SQL database", { timeout: 10000 }, async () => {
  await connectToBackend();
  await makeTestDatabase(); // Let SQLFoo classes use the test database

  // Fake data
  appGlobal.me = new FakeChatPerson();
  let addressbook = new FakeAddressbook();
  fakePersons(50, addressbook);
  let originalAccount = new FakeMailAccount(addressbook.persons, appGlobal.me, 30);
  appGlobal.emailAccounts.add(originalAccount);
  expect(originalAccount).toBeDefined();
  let originalFolders = originalAccount.getAllFolders();
  expect(originalFolders.length).toBeGreaterThan(2);
  let originalMessages = new ArrayColl<EMail>();
  for (let folder of originalFolders) {
    originalMessages.addAll(folder.messages);
  }
  expect(originalMessages.length).toBeGreaterThan(10);

  // Save
  await SQLMailAccount.save(originalAccount);
  for (let folder of originalFolders) {
    await SQLFolder.save(folder);
    for (let msg of folder.messages) {
      await SQLEMail.save(msg);
    }
  }

  // Clear
  addressbook.persons.clear();
  appGlobal.emailAccounts.clear();

  // Read
  appGlobal.emailAccounts.addAll(await SQLMailAccount.readAll());
  async function readMsgsAndSubFolders(folder: Folder) {
    await SQLEMail.readAll(folder);
    for (let sub of folder.subFolders) {
      await readMsgsAndSubFolders(sub);
    }
  }
  for (let account of appGlobal.emailAccounts) {
    await SQLFolder.readAllHierarchy(account);
    for (let folder of account.rootFolders) {
      await readMsgsAndSubFolders(folder);
    }
  }

  // Check and verify
  // Account
  let readAccount = appGlobal.emailAccounts.first;
  expect(readAccount).toBeDefined();
  expect(readAccount.emailAddress).toEqual(originalAccount.emailAddress);
  expect(readAccount.username).toEqual(originalAccount.username);
  expect(readAccount.realname).toEqual(originalAccount.realname);
  expect(readAccount.hostname).toEqual(originalAccount.hostname);
  expect(readAccount.port).toEqual(originalAccount.port);
  expect(readAccount.tls).toEqual(originalAccount.tls);
  expect(readAccount.url).toEqual(originalAccount.url);
  expect(readAccount.dbID).toEqual(originalAccount.dbID);

  // Folder
  let readFolders = readAccount.getAllFolders();
  for (let originalFolder of originalFolders) {
    let readFolder = readFolders.find(f =>
      f.path == originalFolder.path &&
      f.account.id == originalFolder.account.id);
    expect(readFolder).toBeDefined();
    expect(readFolder.name).toEqual(originalFolder.name);
    expect(readFolder.parent?.id).toEqual(originalFolder.parent?.id);
    expect(readFolder.countTotal).toEqual(originalFolder.countTotal);
    expect(readFolder.countUnread).toEqual(originalFolder.countUnread);
    expect(readFolder.countNewArrived).toEqual(originalFolder.countNewArrived);
    expect(readFolder.messages.length).toEqual(originalFolder.messages.length);

    // Message
    for (let originalMessage of originalFolder.messages) {
      let readMessage = readFolder.messages.find(msg =>
        msg.id == originalMessage.id);
      expect(readMessage).toBeDefined();
      expect(readMessage.subject).toEqual(originalMessage.subject);
      expect(readMessage.text).toEqual(originalMessage.text);
      expect(readMessage.html).toEqual(originalMessage.html);
      expect(readMessage.from.emailAddress).toEqual(originalMessage.from.emailAddress);
      expect(readMessage.from.name).toEqual(originalMessage.from.name);
      for (let originalTo of originalMessage.to) {
        let readTo = readMessage.to.find(to => to.emailAddress == originalTo.emailAddress);
        expect(readTo).toBeDefined();
        expect(readTo.name).toEqual(originalTo.name);
      }
    }
  }
});

test.skip("Search mails in SQL database", { timeout: 1000 }, async () => {
  let accounts = await readMailAccounts();
  await accounts.first.readFromDB();
  let folder = accounts.first.getSpecialFolder(SpecialFolder.Inbox);
  let search = new SQLSearchEMail();
  search.folder = folder;
  let messages = await search.startSearch();
  expect(messages.length).toBeGreaterThan(0);
});
