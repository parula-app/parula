// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { ContactEntry, Person } from "../../../logic/Abstract/Person";
import { Addressbook } from "../../../logic/Contacts/Addressbook";
import { ChatAccount } from "../../../logic/Chat/ChatAccount";
import { ChatRoom } from "../../../logic/Chat/ChatRoom";
import { ChatMessage } from "../../../logic/Chat/ChatMessage";
import { selectedAccount, selectedRoom } from "../../../frontend/Chat/selected";
import { selectedPerson } from "../../../frontend/Contacts/Person/Selected";
import ChatAppD from "../../../frontend/Chat/ChatAppD.svelte";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  appGlobal.remoteApp = {} as any;
});

beforeEach(() => {
  appGlobal.chatAccounts.clear();
  appGlobal.addressbooks.clear();
  selectedPerson.set(null);
  selectedRoom.set(null);
  selectedAccount.set(null); // The chat `Header` selects an account, which outlives the test
});

/** Like the demo mode `FakeChatAccount`: the chat ID is the person ID,
 * which is not listed as chat account of the person, and the contact
 * knows its `Person` object. */
class TestChatAccount extends ChatAccount {
  addRoom(person: Person): ChatRoom {
    let contact = this.getPersonUID(person.id, person.name);
    contact.person = person;
    let room = this.newRoom();
    room.id = person.id + "-room";
    room.contact = contact;
    room.members.replaceAll([contact]);
    let message = new ChatMessage(room);
    message.contact = contact;
    message.text = "Hello, " + person.name;
    message.sent = new Date();
    room.messages.add(message);
    room.lastMessage = message;
    this.roster.add(contact);
    this.rooms.set(contact, room);
    return room;
  }
}

function newTestPerson(name: string, addressbook: Addressbook): Person {
  let person = addressbook.newPerson();
  person.id = name;
  person.name = name;
  person.emailAddresses.add(new ContactEntry(`${name}@example.com`, "work"));
  person.chatAccounts.add(new ContactEntry(`${name}@chat.example.com`, "primary", "Teams"));
  addressbook.persons.add(person);
  return person;
}

function newTestAccount(): TestChatAccount {
  let account = new TestChatAccount();
  account.name = "Test chat";
  appGlobal.chatAccounts.add(account);
  return account;
}

function newTestChats(personNames: string[]): ChatRoom[] {
  let addressbook = new Addressbook();
  appGlobal.addressbooks.add(addressbook);
  let account = newTestAccount();
  return personNames.map(name => account.addRoom(newTestPerson(name, addressbook)));
}

let chatApp: Record<string, any> | null = null;

function mountChatApp(): HTMLElement {
  closeChatApp();
  let target = document.createElement("div");
  document.body.append(target);
  chatApp = mount(ChatAppD, { target });
  flushSync();
  return target;
}

/** The router destroys the app when the user switches to another app.
 * A living app would also keep reacting to the stores of the next test. */
function closeChatApp() {
  chatApp && unmount(chatApp);
  chatApp = null;
}

afterEach(closeChatApp);

test("Shows the chat with the person that the user selected in another app", () => {
  let rooms = newTestChats(["Anna", "Berta", "Charlotte"]);
  // The user read a mail from Anna, which selected her as person
  selectedPerson.set(rooms[0].contact.person);

  let target = mountChatApp();

  expect(get(selectedRoom)).toBe(rooms[0]);
  expect(target.querySelector(".right-pane .person .name")?.textContent).toEqual("Anna");
  expect(target.querySelector(".messages .message .from")?.textContent).toEqual("Anna");
  expect(target.querySelector(".row.selected")?.textContent).toContain("Anna");
});

test("Shows the last chat, when no person is selected in another app", () => {
  let rooms = newTestChats(["Anna", "Berta", "Charlotte"]);

  let target = mountChatApp();

  expect(get(selectedRoom)).toBe(rooms[2]);
  expect(target.querySelector(".messages .message .from")?.textContent).toEqual("Charlotte");
});

test("Keeps the open chat, when the person selected in another app has no chat", () => {
  let rooms = newTestChats(["Anna", "Berta", "Charlotte"]);
  selectedRoom.set(rooms[1]);
  let stranger = appGlobal.addressbooks.first.newPerson();
  stranger.name = "Doris";
  selectedPerson.set(stranger);

  let target = mountChatApp();

  expect(get(selectedRoom)).toBe(rooms[1]);
  expect(target.querySelector(".row.selected")?.textContent).toContain("Berta");
});

test("Shows the person's chat, when the chats load only after the app opened", () => {
  let addressbook = new Addressbook();
  appGlobal.addressbooks.add(addressbook);
  let account = newTestAccount();
  let anna = newTestPerson("Anna", addressbook);
  selectedPerson.set(anna);

  let target = mountChatApp();
  let annaRoom = account.addRoom(anna);
  account.addRoom(newTestPerson("Berta", addressbook));
  flushSync();

  expect(get(selectedRoom)).toBe(annaRoom);
  expect(target.querySelector(".row.selected")?.textContent).toContain("Anna");
});

test("Shows the person's chat again, when the user returns from the other app", () => {
  let rooms = newTestChats(["Anna", "Berta", "Charlotte"]);
  selectedPerson.set(rooms[0].contact.person);
  mountChatApp();
  expect(get(selectedRoom)).toBe(rooms[0]);

  // The user went to the mail app and read a mail from Charlotte
  closeChatApp();
  selectedPerson.set(rooms[2].contact.person);
  let target = mountChatApp();

  expect(get(selectedRoom)).toBe(rooms[2]);
  expect(target.querySelector(".row.selected")?.textContent).toContain("Charlotte");
});
