import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { EWSItemError } from "../../../../logic/Mail/EWS/EWSError";
import type { EWSFolder } from "../../../../logic/Mail/EWS/EWSFolder";
import type { EWSEMail } from "../../../../logic/Mail/EWS/EWSEMail";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { expect, test } from "vitest";

/** An Exchange server on which somebody else deleted the message meanwhile */
class TestEWSAccount extends EWSAccount {
  readonly reportedErrors: Error[] = [];

  async callEWS(request: any): Promise<any> {
    if (request.m$UpdateItem) {
      throw new EWSItemError({
        ResponseClass: "Error",
        ResponseCode: "ErrorItemNotFound",
        MessageText: "The specified object was not found in the store.",
      }, request);
    }
    throw new Error("Unexpected EWS call " + JSON.stringify(request));
  }
}

function newTestAccount(): TestEWSAccount {
  let account = new TestEWSAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new DummyMailStorage();
  account.contentStorage.clear();
  account.errorCallback = ex => account.reportedErrors.push(ex);
  let inbox = account.newFolder();
  inbox.name = "Inbox";
  inbox.id = "inbox-1";
  inbox.specialFolder = SpecialFolder.Inbox;
  account.rootFolders.add(inbox);
  let email = inbox.newEMail();
  email.itemID = "item-1";
  email.subject = "Deleted meanwhile";
  inbox.messages.add(email);
  return account;
}

test("Reading a message that is gone on the server drops our copy, without an error", async () => {
  let account = newTestAccount();
  let inbox = account.inbox as EWSFolder;
  let email = inbox.messages.first as EWSEMail;

  await email.markRead(true);

  expect(inbox.messages.contents).toEqual([]);
  expect(email.isDeleted).toBe(true);
  expect(account.reportedErrors).toEqual([]);
});

test("Another server error while marking read still reaches the user", async () => {
  let account = newTestAccount();
  let inbox = account.inbox as EWSFolder;
  let email = inbox.messages.first as EWSEMail;
  account.callEWS = async () => {
    throw new EWSItemError({
      ResponseClass: "Error",
      ResponseCode: "ErrorAccessDenied",
      MessageText: "Access is denied.",
    }, {});
  };

  await expect(email.markRead(true)).rejects.toThrow("Access is denied.");

  expect(inbox.messages.contents).toEqual([email]);
});
