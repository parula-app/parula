import { makeTestDatabase } from '../../../../logic/Chat/SQL/SQLDatabase';
import { ChatMessage } from '../../../../logic/Chat/ChatMessage';
import { ChatPersonUID } from '../../../../logic/Chat/ChatPersonUID';
import { SQLChatAccount } from '../../../../logic/Chat/SQL/SQLChatAccount';
import { SQLChatRoom } from '../../../../logic/Chat/SQL/SQLChatRoom';
import { SQLChatMessage } from '../../../../logic/Chat/SQL/SQLChatMessage';
import { FakeChatAccount, FakeChatPerson, FakeAddressbook, fakePersons } from '../../../../logic/testData';
import { SQLPerson } from '../../../../logic/Contacts/SQL/SQLPerson';
import { appGlobal } from '../../../../logic/app';
import { connectToBackend } from '../../util/backend';
import { ArrayColl } from 'svelte-collections';
import { expect, test } from 'vitest';

test("Save and read chats from SQL database", { timeout: 10000 }, async () => {
  await connectToBackend();
  await makeTestDatabase(); // Let SQLFoo classes use the test database

  // Fake data
  appGlobal.me = new FakeChatPerson();
  let addressbook = new FakeAddressbook();
  fakePersons(50, addressbook);
  let originalAccount = new FakeChatAccount(addressbook.persons, appGlobal.me, 30);
  expect(originalAccount).toBeDefined();
  appGlobal.chatAccounts.add(originalAccount);
  await originalAccount.listRooms();
  let originalRooms = originalAccount.rooms.contents;
  expect(originalRooms.length).toBeGreaterThan(2);
  let originalMessages = new ArrayColl<ChatMessage>();
  for (let room of originalRooms) {
    await room.listMessages();
    originalMessages.addAll(room.messages as any as ArrayColl<ChatMessage>);
  }
  expect(originalMessages.length).toBeGreaterThan(10);
  let personID = 0;
  SQLPerson.save = async (p) => { p.dbID = ++personID };

  // Save
  await SQLChatAccount.save(originalAccount);
  for (let room of originalRooms) {
    await SQLChatRoom.save(room);
    for (let msg of room.messages) {
      await SQLChatMessage.save(msg as any as ChatMessage);
    }
  }

  // Clear
  appGlobal.chatAccounts.clear();

  // Read
  appGlobal.chatAccounts.addAll(await SQLChatAccount.readAll());
  for (let account of appGlobal.chatAccounts) {
    await SQLChatRoom.readAll(account);
    for (let room of account.rooms.contents) {
      await SQLChatMessage.readAll(room);
    }
  }

  // Check and verify
  // Account
  let readAccount = appGlobal.chatAccounts.first;
  expect(readAccount).toBeDefined();
  expect(readAccount.username).toEqual(originalAccount.username);
  expect(readAccount.realname).toEqual(originalAccount.realname);
  expect(readAccount.hostname).toEqual(originalAccount.hostname);
  expect(readAccount.port).toEqual(originalAccount.port);
  expect(readAccount.tls).toEqual(originalAccount.tls);
  expect(readAccount.url).toEqual(originalAccount.url);
  expect(readAccount.dbID).toEqual(originalAccount.dbID);

  // Chat room
  let readRooms = readAccount.rooms.contents;
  for (let originalRoom of originalRooms) {
    let readRoom = readRooms.find(f =>
      f.id == originalRoom.id &&
      f.account.id == originalRoom.account.id)!;
    expect(readRoom).toBeDefined();
    expect(readRoom.name).toEqual(originalRoom.name);
    expect(readRoom.messages.length).toEqual(originalRoom.messages.length);

    // Members are restored from the chatContact table as ChatPersonUIDs,
    // and a 1:1 room's contact is its sole member.
    expect(readRoom.members.length).toEqual(originalRoom.members.length);
    expect(readRoom.contact).toBeInstanceOf(ChatPersonUID);
    expect(readRoom.contact.name).toEqual(originalRoom.contact.name);
    expect(readRoom.members.first?.chatID).toEqual(originalRoom.members.first?.chatID);

    // Message
    for (let originalMessage of originalRoom.messages) {
      let readMessage = readRoom.messages.find(msg =>
        msg.id == originalMessage.id)!;
      expect(readMessage).toBeDefined();
      expect(readMessage.text).toEqual(originalMessage.text);
      expect(readMessage.html).toEqual(originalMessage.html);
      expect(readMessage.contact?.name).toEqual(originalMessage.contact?.name);
    }
  }
});
