// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { setUpAccount } from "./TestMailAccount";
import { SpecialFolder } from "../../../logic/Mail/Folder";
import { PersonUID } from "../../../logic/Abstract/PersonUID";
import { Addressbook } from "../../../logic/Contacts/Addressbook";
import { beforeEach, expect, test } from "vitest";

/* The user allowed pictures from the Internet for a sender.
 * All mails from that sender then load them, until the user stops it. */

beforeEach(() => {
  localStorage.clear();
  appGlobal.addressbooks.clear();
  appGlobal.collectedAddressbook = new Addressbook();
  appGlobal.addressbooks.add(appGlobal.collectedAddressbook);
});

function newMail(fromAddress: string | null, specialFolder = SpecialFolder.Inbox) {
  let account = setUpAccount();
  let folder = account.getSpecialFolder(specialFolder) ?? account.newFolder();
  folder.specialFolder = specialFolder;
  let mail = folder.newEMail();
  mail.from = fromAddress ? new PersonUID(fromAddress, "News") : new PersonUID();
  return mail;
}

test("Pictures are allowed in all mails from that sender, and only from that sender", () => {
  newMail("news@example.com").setLoadExternalImagesFromSender(true);

  expect(newMail("news@example.com").loadExternalImagesFromSender()).toBe(true);
  expect(newMail("News@Example.COM").loadExternalImagesFromSender()).toBe(true);
  expect(newMail("other@example.com").loadExternalImagesFromSender()).toBe(false);
});

test("The user stops pictures from the sender", () => {
  newMail("news@example.com").setLoadExternalImagesFromSender(true);
  newMail("news@example.com").setLoadExternalImagesFromSender(false);

  expect(newMail("news@example.com").loadExternalImagesFromSender()).toBe(false);
});

test("The sender is not added to the contacts", () => {
  newMail("noreply@example.com").setLoadExternalImagesFromSender(true);

  expect(appGlobal.collectedAddressbook.persons.isEmpty).toBe(true);
});

test("Junk does not load pictures, because spammers forge the sender address", () => {
  newMail("news@example.com").setLoadExternalImagesFromSender(true);

  expect(newMail("news@example.com", SpecialFolder.Spam).loadExternalImagesFromSender()).toBe(false);
  let markedAsJunk = newMail("news@example.com");
  markedAsJunk.isSpam = true;
  expect(markedAsJunk.loadExternalImagesFromSender()).toBe(false);
});

test("A mail without sender allows nothing for other mails without sender", () => {
  newMail(null).setLoadExternalImagesFromSender(true);

  expect(newMail(null).loadExternalImagesFromSender()).toBe(false);
});
