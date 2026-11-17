import { MailAccount } from "../../../logic/Mail/MailAccount";
import { MailIdentity } from "../../../logic/Mail/MailIdentity";
import { SpecialFolder, type Folder } from "../../../logic/Mail/Folder";
import { DummyMailStorage } from "../../../logic/Mail/Store/DummyMailStorage";
import type { EMail } from "../../../logic/Mail/EMail";
import { PersonUID } from "../../../logic/Abstract/PersonUID";

/** Stands in for the protocol implementations, and lets the test decide
 * when the server takes the mail. */
export class TestMailAccount extends MailAccount {
  readonly atServer: Promise<void>;
  protected reachedServer: () => void;
  protected serverResponds: (ex?: Error) => void;

  constructor() {
    super();
    this.atServer = new Promise(resolve => this.reachedServer = resolve);
  }

  async send(email: EMail): Promise<void> {
    this.reachedServer();
    await new Promise<void>((resolve, reject) =>
      this.serverResponds = ex => ex ? reject(ex) : resolve());
  }

  serverAccepts() {
    this.serverResponds();
  }
  serverRefuses(ex: Error) {
    this.serverResponds(ex);
  }
}

export function setUpAccount(): TestMailAccount {
  let account = new TestMailAccount();
  account.name = "Test";
  account.emailAddress = "me@example.com";
  account.realname = "Me";
  account.storage = new DummyMailStorage();
  let identity = new MailIdentity(account);
  identity.emailAddress = account.emailAddress;
  identity.realname = account.realname;
  account.identities.add(identity);
  addFolder(account, SpecialFolder.Inbox, "Inbox");
  let sentFolder = addFolder(account, SpecialFolder.Sent, "Sent");
  addFolder(account, SpecialFolder.Drafts, "Drafts");
  sentFolder.messages.addAll([1, 2, 3].map(days => {
    let old = sentFolder.newEMail();
    old.subject = "Sent " + days + " days ago";
    old.sent = old.received = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return old;
  }));
  return account;
}

function addFolder(account: MailAccount, specialFolder: SpecialFolder, name: string): Folder {
  let folder = account.newFolder();
  folder.name = name;
  folder.specialFolder = specialFolder;
  account.rootFolders.add(folder);
  return folder;
}

export function newTestEMail(account: MailAccount): EMail {
  let mail = account.newEMailFrom();
  mail.identity = account.identities.first;
  mail.to.add(new PersonUID("you@example.com", "You"));
  mail.subject = "Hi";
  return mail;
}
