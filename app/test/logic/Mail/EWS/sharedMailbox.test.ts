import { beforeAll, expect, test } from "vitest";
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { EWSFolder } from "../../../../logic/Mail/EWS/EWSFolder";
import type { EWSEMail } from "../../../../logic/Mail/EWS/EWSEMail";
import { ExchangeCalendar } from "../../../../logic/Calendar/EWS/ExchangeCalendar";
import { gLicense } from "../../../../logic/util/License";
import { ArrayColl, type Collection } from "svelte-collections";

/** Answers the server calls that a notification triggers */
class TestFolder extends EWSFolder {
  readonly downloaded = new ArrayColl<EWSEMail>();
  /** The notification does not wait for the download, so the test has to */
  readonly downloadedNewMail = Promise.withResolvers<void>();

  async updateChangedMessages(): Promise<ArrayColl<EWSEMail>> {
    let email = this.newEMail();
    email.itemID = "new-mail-" + this.id;
    return new ArrayColl([email]);
  }

  async downloadMessages(emails: Collection<EWSEMail>): Promise<Collection<EWSEMail>> {
    this.downloaded.addAll(emails);
    this.downloadedNewMail.resolve();
    return emails;
  }
}

function newInbox(account: EWSAccount, id: string): TestFolder {
  let inbox = new TestFolder(account);
  inbox.id = id;
  account.folderMap.set(inbox.id, inbox);
  return inbox;
}

// Alice's own mailbox, plus Bob's and Carol's, which they shared with her
let alice = new EWSAccount();
alice.username = "alice@example.com";
let aliceCalendar = new ExchangeCalendar();
aliceCalendar.initFromMainAccount(alice);
aliceCalendar.useForInvitations = true;

let bob = new EWSAccount();
bob.initFromMainAccount(alice);
bob.username = "bob@example.com";
let bobCalendar = new ExchangeCalendar();
bobCalendar.initFromMainAccount(alice);
bobCalendar.username = bob.username;
bobCalendar.useForInvitations = true;

// Carol shared no calendar
let carol = new EWSAccount();
carol.initFromMainAccount(alice);
carol.username = "carol@example.com";

let aliceInbox = newInbox(alice, "alice-inbox");
let bobInbox = newInbox(bob, "bob-inbox");

appGlobal.emailAccounts.addAll([alice, bob, carol]);
appGlobal.calendars.addAll([aliceCalendar, bobCalendar]);

beforeAll(() => gLicense.license = { valid: true });

test("The shared mailbox is logged in, once the account which owns the connection is", async () => {
  let bobShownAsLoggedIn = false; // what `<AccountListItem>` shows
  bob.subscribe(() => bobShownAsLoggedIn = bob.isLoggedIn);

  await alice.login(false);

  expect(bob.isLoggedIn).toBe(true);
  expect(bobShownAsLoggedIn).toBe(true);
});

test("Invitations to the shared mailbox go to the shared calendar", () => {
  expect(bob.calendarsAvailable.length).toBe(1);
  expect(bob.calendarsAvailable.first).toBe(bobCalendar);
  expect(bob.calendar).toBe(bobCalendar);
});

test("Invitations to a shared mailbox without a shared calendar go to our own calendar", () => {
  expect(carol.calendarsAvailable.length).toBe(1);
  expect(carol.calendarsAvailable.first).toBe(aliceCalendar);
  expect(carol.calendar).toBe(aliceCalendar);
});

test("Invitations to our own mailbox do not go to the shared calendar", () => {
  expect(alice.calendarsAvailable.length).toBe(1);
  expect(alice.calendarsAvailable.first).toBe(aliceCalendar);
  expect(alice.calendar).toBe(aliceCalendar);
});

test("New mail in our own mailbox is downloaded as it arrives", async () => {
  await alice.processNotification({ NewMailEvent: { ItemId: { Id: "new-mail-alice-inbox" }, ParentFolderId: { Id: aliceInbox.id } } });
  await aliceInbox.downloadedNewMail.promise;

  expect(aliceInbox.downloaded.length).toBe(1);
});

test("New mail in a mailbox shared with us is downloaded as it arrives", async () => {
  // The notification arrives on Alice's connection, but the folder is Bob's
  await alice.processNotification({ NewMailEvent: { ItemId: { Id: "new-mail-bob-inbox" }, ParentFolderId: { Id: bobInbox.id } } });
  await bobInbox.downloadedNewMail.promise;

  expect(bobInbox.downloaded.length).toBe(1);
});
