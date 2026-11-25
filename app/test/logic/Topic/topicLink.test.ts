// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { Topic } from "../../../logic/Topic/Topic";
import type { TopicLink } from "../../../logic/Topic/Link/TopicLink";
import { newTopicLinkForTarget, topicLinksFromJSONLD, topicLinksTo } from "../../../logic/Topic/Link/TopicLinks";
import { TopicAccount } from "../../../logic/Topic/TopicAccount";
import { EMail } from "../../../logic/Mail/EMail";
import { Person, ContactEntry } from "../../../logic/Abstract/Person";
import { Addressbook } from "../../../logic/Contacts/Addressbook";
import { Calendar } from "../../../logic/Calendar/Calendar";
import { Event } from "../../../logic/Calendar/Event";
import { ChatAccount } from "../../../logic/Chat/ChatAccount";
import { ChatRoom } from "../../../logic/Chat/ChatRoom";
import { ChatMessage } from "../../../logic/Chat/ChatMessage";
import { HarddriveFile } from "../../../logic/Files/Harddrive/HarddriveFile";
import * as setStorage from "../../../logic/Mail/Store/setStorage";
import * as fs from "node:fs/promises";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, expect, test, vi } from "vitest";

let topic: Topic;
let account: TopicAccount;

beforeEach(() => {
  appGlobal.remoteApp = { fs } as any;
  appGlobal.topicAccounts.clear();
  account = new TopicAccount();
  account.storage = { saveTopic: async () => {} } as any;
  topic = new Topic();
  topic.account = account;
  topic.name = "Project";
  account.topics.add(topic);
  appGlobal.topicAccounts.add(account);
});

function newEMail(): EMail {
  let email = new EMail(null);
  email.messageID = "abc.123@example.com";
  email.subject = "Offer";
  email.sent = new Date("2026-11-03T10:00:00Z");
  return email;
}

function newPerson(addressbook?: Addressbook): Person {
  let person = new Person(addressbook);
  person.name = "Fred Test";
  person.emailAddresses.add(new ContactEntry("Fred@Example.com"));
  return person;
}

function newEvent(calendar?: Calendar): Event {
  let event = new Event(calendar);
  event.calUID = "uid-4711";
  event.title = "Kick-off";
  event.startTime = new Date("2026-11-04T09:00:00Z");
  return event;
}

function newChatMessage(): ChatMessage {
  let chatAccount = new ChatAccount();
  let room = new ChatRoom(chatAccount);
  room.id = "!room/1:example.org";
  let message = new ChatMessage(room);
  message.id = "$event:example.org";
  message.text = "See the offer";
  return message;
}

/** A new link object from the JSON-LD of `link`, without the target */
function readAgain(link: TopicLink): TopicLink {
  return topicLinksFromJSONLD(topic, [link.toJSONLD()])[0];
}

test("A link to each type survives JSON-LD", () => {
  let file = new HarddriveFile();
  file.setFileName("Offer 2.pdf");
  file.path = file.filepathLocal = "/home/fred/Offer 2.pdf";
  for (let target of [newEMail(), newPerson(), newEvent(), newChatMessage(), file]) {
    let link = newTopicLinkForTarget(topic, target);
    let json = JSON.parse(JSON.stringify(link.toJSONLD()));
    expect(json["@type"]).toBeTruthy();
    let read = readAgain(link);
    expect(read.constructor).toBe(link.constructor);
    expect(read.targetID).toBe(link.targetID);
    expect(read.name).toBe(link.name);
    expect(read.date?.getTime()).toBe(link.date?.getTime());
  }
});

test("The IDs are the same for all users", () => {
  expect(newTopicLinkForTarget(topic, newEMail()).targetID).toBe("mid:abc.123@example.com");
  expect(newTopicLinkForTarget(topic, newPerson()).targetID).toBe("mailto:fred@example.com");
  expect(newTopicLinkForTarget(topic, newEvent()).targetID).toBe("uid-4711");
  let chatID = newTopicLinkForTarget(topic, newChatMessage()).targetID;
  expect(chatID).toContain(encodeURIComponent("!room/1:example.org"));
  expect(chatID).toContain(encodeURIComponent("$event:example.org"));
});

test("An unknown type is ignored", () => {
  let json = [{ "@type": "Recipe", "@id": "https://example.com" }, { "@type": "constructor" }, newTopicLinkForTarget(topic, newEMail()).toJSONLD()];
  expect(topicLinksFromJSONLD(topic, json).map(link => link.targetID)).toEqual(["mid:abc.123@example.com"]);
});

test("Add, find from the target, and remove a link", async () => {
  let email = newEMail();
  let links = topicLinksTo(email);
  expect(links.isEmpty).toBe(true);
  await topic.addLink(email);
  await topic.addLink(email);
  expect(topic.links.length).toBe(1);
  expect(links.first?.topic).toBe(topic);
  let sameEMailInOtherFolder = newEMail();
  expect(topicLinksTo(sameEMailInOtherFolder).first?.topic).toBe(topic);

  await topic.removeLink(topic.links.first);
  expect(links.isEmpty).toBe(true);
});

test("A person needs an email address, phone number or chat ID", async () => {
  let person = new Person();
  person.name = "Nobody";
  await expect(topic.addLink(person)).rejects.toThrow();
  expect(topic.links.isEmpty).toBe(true);

  person.chatAccounts.add(new ContactEntry("@Fred:matrix.org", "primary", "matrix"));
  await topic.addLink(person);
  expect(topic.links.first.targetID).toBe("matrix:@fred:matrix.org");
});

test("Find the email by its Message-ID", async () => {
  let email = newEMail();
  let search = vi.spyOn(setStorage, "findMessageByID").mockImplementation(async id => id == email.messageID ? email : undefined);
  try {
    let link = readAgain(newTopicLinkForTarget(topic, email));
    expect(await link.findTarget()).toBe(email);
  } finally {
    search.mockRestore();
  }
});

test("Find the person, event and file", async () => {
  let addressbook = new Addressbook();
  addressbook.readFromDB = async () => {}; // already in memory
  let person = newPerson(addressbook);
  let chatPerson = new Person(addressbook);
  chatPerson.chatAccounts.add(new ContactEntry("fred@jabber.example.org", "primary", "xmpp"));
  addressbook.persons.addAll([person, chatPerson]);
  appGlobal.addressbooks.add(addressbook);
  let calendar = new Calendar();
  calendar.readFromDB = async () => {};
  let event = newEvent(calendar);
  calendar.events.add(event);
  appGlobal.calendars.add(calendar);
  let dir = mkdtempSync(path.join(tmpdir(), "topic-link-test-"));
  let file = new HarddriveFile();
  file.setFileName("Offer.pdf");
  file.path = file.filepathLocal = path.join(dir, "Offer.pdf");
  writeFileSync(file.path, "PDF");
  try {
    for (let target of [person, chatPerson, event, file]) {
      let link = readAgain(newTopicLinkForTarget(topic, target));
      let found = await link.findTarget();
      if (target instanceof HarddriveFile) {
        expect((found as HarddriveFile).filepathLocal).toBe(file.filepathLocal);
      } else {
        expect(found).toBe(target);
      }
    }
    await fs.rm(file.path);
    let link = newTopicLinkForTarget(topic, file);
    expect(await link.findTarget()).toBeNull();
  } finally {
    appGlobal.addressbooks.remove(addressbook);
    appGlobal.calendars.remove(calendar);
  }
});
