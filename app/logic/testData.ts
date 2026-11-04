import { appGlobal } from './app';
import { MailAccount } from './Mail/MailAccount';
import { Folder, SpecialFolder } from './Mail/Folder';
import { ChatAccount } from './Chat/ChatAccount';
import type { MeetAccount } from './Meet/MeetAccount';
import { ChatMessage, DeliveryStatus } from './Chat/ChatMessage';
import { PersonUID } from './Abstract/PersonUID';
import { ContactEntry, Person } from './Abstract/Person';
import { Group } from './Abstract/Group';
import { StreetAddress } from './Contacts/StreetAddress';
import { ChatRoom } from './Chat/ChatRoom';
import { FileSharingAccount } from './Files/FileSharingAccount';
import type { File } from './Files/File';
import { Directory } from './Files/Directory';
import { Calendar } from './Calendar/Calendar';
import { Participant as CalendarParticipant } from './Calendar/Participant';
import { InvitationResponse } from './Calendar/Invitation/InvitationStatus';
import { Addressbook } from './Contacts/Addressbook';
import { Event } from './Calendar/Event';
import { EMail } from './Mail/EMail';
import { ComposeActions } from './Mail/ComposeActions';
import { hookPoints } from './Addons/API/HookPoint';
import { MailIdentity } from './Mail/MailIdentity';
import { FakeMeetAccount } from './Meet/FakeMeeting';
import { DummyMailStorage } from './Mail/Store/DummyMailStorage';
import { DummyChatStorage } from './Chat/SQL/DummyChatStorage';
import { DummyCalendarStorage } from './Calendar/SQL/DummyCalendarStorage';
import { DummyAddressbookStorage } from './Contacts/SQL/DummyAddressbookStorage';
import { fetchJSON } from './util/netUtil';
import { notifyChangedProperty } from './util/Observable';
import { assert } from './util/util';
import { ArrayColl, type Collection } from 'svelte-collections';
import { faker } from '@faker-js/faker';

const realMailAccounts = new ArrayColl<MailAccount>();
const realChatAccounts = new ArrayColl<ChatAccount>();
const realMeetAccounts = new ArrayColl<MeetAccount>();
const realAddressbooks = new ArrayColl<Addressbook>();
const realCalendars = new ArrayColl<Calendar>();
const realFileSharingAccounts = new ArrayColl<FileSharingAccount>();
let realMe: Person;

export async function testDataOn() {
  realAddressbooks.replaceAll(appGlobal.addressbooks);
  realMailAccounts.replaceAll(appGlobal.emailAccounts);
  realChatAccounts.replaceAll(appGlobal.chatAccounts);
  realMeetAccounts.replaceAll(appGlobal.meetAccounts);
  realCalendars.replaceAll(appGlobal.calendars);
  realFileSharingAccounts.replaceAll(appGlobal.fileSharingAccounts);

  appGlobal.addressbooks.clear();
  appGlobal.emailAccounts.clear();
  appGlobal.chatAccounts.clear();
  appGlobal.calendars.clear();
  appGlobal.meetAccounts.clear();
  appGlobal.fileSharingAccounts.clear();

  await readAvatarList();
  realMe = appGlobal.me;
  if (!appGlobal.me?.name) {
    appGlobal.me = new FakeChatPerson();
  }
  let addressbook = new FakeAddressbook();
  let persons = fakePersons(10, addressbook);
  appGlobal.addressbooks.replaceAll([ addressbook ]);
  appGlobal.emailAccounts.replaceAll([ new FakeMailAccount(persons, appGlobal.me) ]);
  appGlobal.chatAccounts.replaceAll([ new FakeChatAccount(persons, appGlobal.me) ]);
  appGlobal.calendars.replaceAll([ new FakeCalendar(persons) ]);
  appGlobal.meetAccounts.replaceAll([ new FakeMeetAccount() ]);
  appGlobal.fileSharingAccounts.replaceAll([new FakeFileSharingAccount()]);

  await appGlobal.emailAccounts.first.login(false);
  await appGlobal.chatAccounts.first.login(false);
}

export async function testDataOff() {
  appGlobal.addressbooks.clear();
  appGlobal.emailAccounts.clear();
  appGlobal.chatAccounts.clear();
  appGlobal.calendars.clear();
  appGlobal.meetAccounts.clear();
  appGlobal.fileSharingAccounts.clear();

  appGlobal.me = realMe;
  appGlobal.addressbooks.replaceAll(realAddressbooks);
  appGlobal.emailAccounts.replaceAll(realMailAccounts);
  appGlobal.chatAccounts.replaceAll(realChatAccounts);
  appGlobal.meetAccounts.replaceAll(realMeetAccounts);
  appGlobal.calendars.replaceAll(realCalendars);
  appGlobal.fileSharingAccounts.replaceAll(realFileSharingAccounts);

  realAddressbooks.clear();
  realMailAccounts.clear();
  realChatAccounts.clear();
  realMeetAccounts.clear();
  realCalendars.clear();
  realFileSharingAccounts.clear();
}

export async function addTestDataToGlobal(): Promise<void> {
  appGlobal.me = new FakeChatPerson();
  let addressbook = new FakeAddressbook();
  let persons = fakePersons(20, addressbook);
  appGlobal.addressbooks.add(addressbook);
  appGlobal.emailAccounts.add(new FakeMailAccount(persons, appGlobal.me));
  appGlobal.chatAccounts.add(new FakeChatAccount(persons, appGlobal.me));
  appGlobal.calendars.add(new FakeCalendar(persons));
  appGlobal.meetAccounts.add(new FakeMeetAccount());
  appGlobal.fileSharingAccounts.add(new FakeFileSharingAccount());
  await appGlobal.emailAccounts.first.login(false);
  await appGlobal.chatAccounts.first.login(false);
}

export class FakeAddressbook extends Addressbook {
  constructor() {
    super();
    this.name = faker.company.name();
    this.url = faker.internet.url();
    this.username = faker.internet.username();
    this.storage = new DummyAddressbookStorage();
  }
}

export function fakePersons(count = 50, addressbook: Addressbook): Collection<Person> {
  let persons = new ArrayColl<Person>();
  for (let i = 1; i <= count; i++) {
    let person = new FakeChatPerson();
    person.addressbook = addressbook;
    persons.add(person);
  }
  if (addressbook) {
    addressbook.persons.addAll(persons);
  }
  return persons;
}

export function fakeGroups(groupCount = 10, maxMemberCount = 20, addressbook: Addressbook): Collection<Group> {
  let groups = new ArrayColl<Group>();
  let persons = addressbook.persons;
  for (let iP = 1; iP <= groupCount; iP++) {
    let group = new Group();
    group.name = unique(faker.person.jobTitle);
    group.addressbook = addressbook;
    let memberCount = 2 + Math.floor(Math.random() * (maxMemberCount - 2));
    for (let iG = 1; iG <= memberCount; iG++) {
      let person = persons.getIndex(Math.floor(Math.random() * persons.length));
      if (group.participants.has(person)) {
        continue;
      }
      group.participants.add(person);
    }
    groups.add(group);
  }
  if (addressbook) {
    addressbook.groups.addAll(groups);
  }
  return groups;
}

export class FakeChatPerson extends Person {
  constructor() {
    super();
    this.id = faker.string.uuid();
    let male = Math.random() < 0.5;
    this.firstName = faker.person.firstName(male ? "male" : "female");
    this.lastName = faker.person.lastName();
    this.name = this.firstName + " " + this.lastName;
    this.emailAddresses.add(new ContactEntry(faker.internet.email({ firstName: this.firstName, lastName: this.lastName }).toLowerCase(), "work"));
    this.emailAddresses.add(new ContactEntry(faker.internet.email({ firstName: this.firstName, lastName: this.lastName }).toLowerCase(), "home"));
    this.phoneNumbers.add(new ContactEntry(faker.helpers.fromRegExp('+49-170-[0-9]{3} [0-9]{4}'), "mobile"));
    this.phoneNumbers.add(new ContactEntry(faker.helpers.fromRegExp('+49-[0-9]{3}-[0-9]{6}'), "work"));
    this.chatAccounts.add(new ContactEntry(this.phoneNumbers.first.value, "WhatsApp"));
    this.chatAccounts.add(new ContactEntry(this.emailAddresses.first.value, "Teams"));
    this.groups.add(new ContactEntry(faker.company.name(), "Mustang"));
    this.groups.add(new ContactEntry(faker.company.name(), "WhatsApp"));
    this.groups.add(new ContactEntry(faker.company.name(), "Teams"));
    let address = new StreetAddress();
    address.street = faker.location.streetAddress();
    address.postalCode = faker.location.zipCode();
    address.city = faker.location.city();
    this.streetAddresses.add(new ContactEntry(address.toString(), "home"));
    this.picture = avatar(male);
    this.company = faker.company.name();
    this.department = faker.commerce.department();
    this.position = faker.person.jobTitle();
  }
}

export class FakeMailAccount extends MailAccount {
  msgCount: number;
  persons: Collection<Person>;
  meUID: PersonUID;
  @notifyChangedProperty
  _isLoggedIn = false;
  constructor(persons: Collection<Person>, me: Person, msgCount = 300) {
    super();
    this.name = "Yahoo Test";
    this.emailAddress = me.emailAddresses.first.value ?? "You";
    this.realname = me.name;
    this.username = this.emailAddress;
    this.password = faker.internet.password();
    this.hostname = "imap." + faker.internet.domainName();
    this.port = 993;
    this.tls = 2;
    this.identities.add(new FakeMailIdentity(this));
    this.storage = new DummyMailStorage();

    me.emailAddresses.add(new ContactEntry(this.emailAddress, "Primary"));
    this.meUID = new PersonUID(this.emailAddress, this.realname);
    this.persons = persons;
    this.msgCount = msgCount;
  }
  async login() {
    await this.listFolders();
    this._isLoggedIn = true;
  }
  get isLoggedIn(): boolean {
    return this._isLoggedIn;
  }
  async listFolders(): Promise<void> {
    if (this.rootFolders.hasItems) {
      return;
    }
    for (let name of ['Inbox', 'Sent', 'Drafts', 'Trash', 'Spam']) {
      let folder = this.newFolder();
      folder.setFakeName(name);
      this.rootFolders.push(folder);
    }
    let inbox = this.rootFolders.first as FakeFolder;
    inbox.specialFolder = SpecialFolder.Inbox;
    await inbox.listMessages();
  }
  newFolder(): FakeFolder {
    return new FakeFolder(this);
  }

  async send(email: EMail): Promise<void> {
    let sentFolder = this.findFolder(acc => acc.specialFolder == SpecialFolder.Sent)!;
    await sentFolder.addMessage(email);
  }
}

class FakeFolder extends Folder {
  declare account: FakeMailAccount;
  setFakeName(name: string) {
    this.name = name;
    this.id = name.toLowerCase();
    this.specialFolder = this.name.toLowerCase() as SpecialFolder;
  }
  async listMessages(): Promise<Collection<EMail>> {
    if (this.messages.hasItems) {
      return this.messages;
    }
    let messages = new ArrayColl<FakeEMail>();
    let lastReadTime = new Date();
    lastReadTime.setHours(lastReadTime.getHours() - 1);
    let emailNr = 0;
    for (let person of this.account.persons) {
      let pUID = PersonUID.fromPerson(person);
      let msgCount = this.account.msgCount * (this.specialFolder == SpecialFolder.Inbox
          ? 0.99
          : 0.01);
      this.countTotal = msgCount;
      for (let i = 1; i <= msgCount; i++) {
        emailNr++;
        let msg = this.newEMail();
        msg.setFake(person, pUID, this.account.meUID, lastReadTime, emailNr);
        messages.add(msg);
      }
    }
    this.messages.addAll(messages.sortBy(msg => msg.received));
    return this.messages;
  }
  async getNewMessages(): Promise<Collection<EMail>> {
    return this.messages;
  }
  async downloadMessages(emails: Collection<EMail>): Promise<Collection<EMail>> {
    return new ArrayColl<EMail>();
  }
  async downloadAllMessages(): Promise<Collection<EMail>> {
    return new ArrayColl<EMail>();
  }
  newEMail(): FakeEMail {
    return new FakeEMail(this);
  }
  async addMessage(message: EMail) {
    this.messages.add(message);
  }
  async moveMessagesHere(messages: Collection<EMail>) {
    let sourceFolder = messages.first.folder;
    sourceFolder.messages.removeAll(messages);
    this.messages.addAll(messages);
  }
  async copyMessagesHere(messages: Collection<EMail>) {
    this.messages.addAll(messages);
  }
}

class FakeEMail extends EMail {
  setFake(person: Person, pUID: PersonUID, meUID: PersonUID, lastReadTime: Date, emailNr: number) {
    this.loadedBody = true;
    this.id = emailNr + '@' + this.folder.account.emailAddress;
    this.sent = faker.date.recent({ days: 30 });
    this.received = new Date(this.sent.getTime() + 500);
    this.size = Math.ceil(Math.random() * 2048 + 200);
    this.isRead = this.received < lastReadTime;
    this.subject = faker.hacker.phrase().replace("!", "").replace(/,.*/, "");
    this.outgoing = Math.random() < 0.4;
    this.contact = person;
    this.from = this.outgoing ? meUID : pUID;
    this.to.add(this.outgoing ? pUID : meUID);
    for (let i = Math.floor(Math.random() * 3); i > 0; i--) {
      this.to.add(new FakeMailPerson());
    }
    for (let i = Math.floor(Math.random() * 10); i > 0; i--) {
      this.cc.add(new FakeMailPerson());
    }
    if (Math.random() < 0.2) {
      this.bcc.add(new FakeMailPerson());
    }
    let paragraphs: string[] = [];
    for (let iP = Math.floor(Math.random() * 7) + 1; iP > 0; iP--) {
      let paragraph = faker.hacker.phrase().replace("!", ".");
      for (let iS = Math.floor(Math.random() * 5); iS > 0; iS--) {
        paragraph += " " + faker.hacker.phrase().replace("!", ".");
      }
      paragraphs.push(paragraph);
    }
    this.text = paragraphs.join("\n\n");
    if (Math.random() > 0.3) {
      this.html = `<p>${paragraphs.join("</p><p>")}</p>`;
    }
  }
  get compose() {
    return new FakeComposeActions(this);
  }
  async download() {}
}

class FakeComposeActions extends ComposeActions {
  declare email: FakeEMail;
  async saveAsDraft(): Promise<void> {
    this.email.sent = new Date();
    await super.saveAsDraft();
  }
  async send() {
    this.email.sent = new Date();
    await this.email.identity.account.send(this.email);
    await this.deleteDrafts();
  }
}
hookPoints.get("mail.send").addSubclass(FakeComposeActions);

export class FakeMailPerson extends PersonUID {
  constructor() {
    super(faker.internet.email().toLowerCase(), faker.person.fullName());
  }
}

class FakeMailIdentity extends MailIdentity {
  constructor(account: FakeMailAccount) {
    super(account);
    this.emailAddress = account.emailAddress;
    this.realname = appGlobal.me.name;
  }
}

export class FakeChatAccount extends ChatAccount {
  me: Person;
  msgCount: number;
  readonly persons: Collection<Person>;
  constructor(persons: Collection<Person>, me: Person, msgCount = 20) {
    super();
    this.name = "Test chat 1";
    this.realname = me.name;
    this.msgCount = msgCount;
    this.me = me;
    this.persons = persons;
    this.storage = new DummyChatStorage();
  }
  async login(interactive: boolean): Promise<void> {
    await this.listRooms();
  }
  async listRooms(): Promise<void> {
    if (this.rooms.hasItems) {
      return;
    }
    for (let person of this.persons) {
      let room = this.newRoom() as FakeChat;
      room.id = person.id + "-" + faker.string.uuid();
      let contact = this.getPersonUID(person.id, person.name);
      contact.person = person;
      room.contact = contact;
      room.members.replaceAll([contact]);
      this.roster.add(contact);
      this.rooms.set(contact, room);
    }
  }
  newRoom(): FakeChat {
    return new FakeChat(this);
  }
}

class FakeChat extends ChatRoom {
  constructor(account: FakeChatAccount) {
    super(account);
  }
  async listMembers(): Promise<void> {
  }
  async listMessages(): Promise<void> {
    if (this.messages.hasItems) {
      return;
    }
    let lastTime = faker.date.recent({ days: 30 });
    let msgCount = (this.account as FakeChatAccount).msgCount;
    for (let i = 1; i <= msgCount; i++) {
      let msg = this.newMessage();
      msg.setFakeTime(lastTime);
      this.messages.add(msg);
      lastTime = msg.sent;
    }
    this.lastMessage = this.messages.sortBy(msg => msg.sent).last as ChatMessage;
  }
  newMessage(): FakeChatMessage {
    return new FakeChatMessage(this);
  }

  async sendMessage(message: ChatMessage) {
    message.deliveryStatus = DeliveryStatus.Sending;
    this.messages.push(message);
  }
}

class FakeChatMessage extends ChatMessage {
  constructor(chat: FakeChat) {
    super(chat);
    this.id = faker.string.uuid();
    this.to = chat;
    this.contact = chat.contact;
    this.outgoing = Math.random() < 0.4;
    this.text = faker.hacker.phrase().replace("!", "");
    this.html = this.text;
  }
  setFakeTime(lastTime: Date) {
    let isFollowup = Math.random() < 0.5;
    this.sent = isFollowup
      ? faker.date.soon({ days: 1, refDate: lastTime })
      : faker.date.recent({ days: 30 });
    this.received = new Date(this.sent.getTime() + 500);
  }
}

export class FakeCalendar extends Calendar {
  randomParticipants: Collection<CalendarParticipant>;
  constructor(persons: Collection<Person>, eventCount = 50) {
    super();
    this.name = faker.company.name();
    this.storage = new DummyCalendarStorage();

    this.randomParticipants = new ArrayColl(persons.contents.map(person => {
      let personUID = PersonUID.fromPerson(person);
      return new CalendarParticipant(personUID.emailAddress, personUID.name, InvitationResponse.NoResponseReceived);
    }));
    for (let i = 1; i <= eventCount; i++) {
      let event = this.newEvent();
      event.setTime(i > 5);
      this.events.add(event);
    }
  }
  newEvent(parentEvent?: FakeEvent): FakeEvent {
    return new FakeEvent(this, parentEvent);
  }
}



class FakeEvent extends Event {
  declare calendar: FakeCalendar;
  constructor(calendar: FakeCalendar, parentEvent?: FakeEvent) {
    super(calendar, parentEvent);
    this.title = faker.company.buzzPhrase();
    this.descriptionText = faker.hacker.phrase() + "\n" + faker.hacker.phrase();
    this.location = faker.datatype.boolean() ? faker.location.streetAddress() : faker.location.nearbyGPSCoordinate().join(", ");
    let participantsCount = Math.random() * 5;
    for (let i = 1; i < participantsCount; i++) {
      let participant = this.calendar.randomParticipants.getIndex(Math.floor(Math.random() * this.calendar.randomParticipants.length));
      this.participants.add(participant);
    }
  }
  setTime(future: boolean) {
    this.startTime = future
      ? faker.date.soon({ days: 60 })
      : faker.date.recent();
    let endTimeMax = new Date(this.startTime);
    endTimeMax.setMinutes(endTimeMax.getMinutes() + 120);
    this.endTime = faker.date.between({ from: this.startTime, to: endTimeMax });
  }
}

export class FakeFileSharingAccount extends FileSharingAccount {
  constructor() {
    super();
    this.name = "G Drive";
    let dirCount = Math.random() * 10;
    let dirs: Directory[] = [];
    for (let i = 0; i < dirCount; i++) {
      let parentDir = this.newDirectory(faker.system.fileName({ extensionCount: 0 }));
      dirs.push(fakeDir(parentDir));
    }
    this.rootDirs.addAll(dirs);
  }
}

export function fakeSharedDir(persons: Collection<Person>): Directory {
  let sharedDirectory = new Directory();
  sharedDirectory.name = "shared";
  sharedDirectory.id = "/shared";
  for (let person of persons) {
    let personDirectory = sharedDirectory.newDirectory(person.name);
    personDirectory.sentToFrom = person;
    personDirectory.lastMod = faker.date.past();
    sharedDirectory.subDirs.add(personDirectory);
    let dirCount = 2 + Math.random() * 10;
    for (let i = 0; i < dirCount; i++) {
      fakeDir(personDirectory).sentToFrom = person;
    }
  }
  return sharedDirectory;
}

export function fakeDir(parentDir: Directory): Directory {
  let name = unique(() => faker.system.fileName({ extensionCount: 0 }));
  let directory = parentDir.newDirectory(name);
  directory.lastMod = faker.date.past();
  let dirCount = Math.random() * 6;
  dirCount -= 4;
  for (let i = 0; i < dirCount; i++) {
    fakeDir(directory);
  }
  let fileCount = 2 + Math.random() * 20;
  for (let i = 0; i < fileCount; i++) {
    fakeFile(directory);
  }
  parentDir.subDirs.add(directory);
  return directory;
}

export function fakeFile(parentDir: Directory): File {
  let name = unique(faker.system.commonFileName)
  let file = parentDir.newFile(name);
  let parts = file.name.split(".");
  file.ext = parts.pop()!;
  file.nameWithoutExt = parts.join(".");
  file.size = faker.number.int({ max: 40000000 });
  file.lastMod = faker.date.past();
  parentDir.files.add(file);
  return file;
}

let avatarFiles = {} as Record<string, ArrayColl<string>>;
async function readAvatarList() {
  const rootURL = "https://avatar.mustang.im";
  for (let listName of ["man", "woman"]) {
    avatarFiles[listName] = new ArrayColl<string>();
    let fileNames = await fetchJSON(`${rootURL}/${listName}/list.json`);
    for (let fileName of fileNames) {
      avatarFiles[listName].add(`${rootURL}/${listName}/${fileName}`);
    }
  }
  console.log(avatarFiles);
}

function avatar(male: boolean): string {
  let listName = male ? "man" : "woman";
  let list = avatarFiles[listName];
  assert(list, "Call readAvatarList() first");
  assert(list?.hasItems, "No avatars found");
  let i = Math.floor(Math.random() * list.length);
  console.log(listName, list.get(i));
  return list.get(i);
}

function unique<T>(func: () => T): T {
  // TODO
  // Please avoid leaks
  return func();
}
