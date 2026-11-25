// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { EWSCalendar } from "../../../../logic/Calendar/EWS/EWSCalendar";
import { EWSAddressbook } from "../../../../logic/Contacts/EWS/EWSAddressbook";
import { AuthMethod } from "../../../../logic/Abstract/Account";
import { waitFor } from "../../util/waitFor";
import { afterEach, expect, test } from "vitest";

/** An Exchange server that lost our subscription and reports that on the stream */
class TestEWSAccount extends EWSAccount {
  /** The subscription IDs that the server handed out, in order */
  readonly subscriptionIDs: string[] = [];
  /** The subscription IDs that we asked to stream, in order */
  readonly streamedIDs: string[] = [];
  /** The response code that the first stream fails with */
  responseCode = "ErrorMissedNotificationEvents";
  /** How often we checked the inbox for new mail */
  inboxChecks = 0;

  get inbox(): any {
    return {
      getNewMessages: async () => {
        this.inboxChecks++;
      },
    };
  }

  async callEWS(request: any): Promise<any> {
    if (request.m$Subscribe) {
      let id = "subscription-" + (this.subscriptionIDs.length + 1);
      this.subscriptionIDs.push(id);
      return { SubscriptionId: id };
    }
    throw new Error("Unexpected EWS call " + JSON.stringify(request));
  }

  async stream(body: string): Promise<any> {
    let id = /<t:SubscriptionId>([^<]*)</.exec(body)[1];
    this.streamedIDs.push(id);
    let chunks = this.streamedIDs.length == 1
      ? [subscriptionLostEnvelope(this.responseCode)]
      : [];
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          for (let chunk of chunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        },
      }),
    };
  }
}

/** What `GetStreamingEvents` answers when the subscription is not usable any more */
function subscriptionLostEnvelope(responseCode: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
    <Envelope xmlns="http://schemas.xmlsoap.org/soap/envelope/">
      <Body>
        <GetStreamingEventsResponse xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
          <ResponseMessages>
            <GetStreamingEventsResponseMessage ResponseClass="Error">
              <MessageText>Unable to retrieve events for this subscription.  The subscription must be recreated.</MessageText>
              <ResponseCode>${responseCode}</ResponseCode>
              <ConnectionStatus>Closed</ConnectionStatus>
            </GetStreamingEventsResponseMessage>
          </ResponseMessages>
        </GetStreamingEventsResponse>
      </Body>
    </Envelope>`;
}

function newTestAccount(): TestEWSAccount {
  let account = new TestEWSAccount();
  account.name = "Test";
  account.username = "user@example.com";
  account.emailAddress = account.username;
  account.url = "https://exchange.example.com/EWS/Exchange.asmx";
  account.authMethod = AuthMethod.Unknown; // no credentials needed for the stream request
  account.errorCallback = () => undefined;
  globalThis.fetch = ((_url: string, options: any) => account.stream(options.body)) as any;
  return account;
}

test("The server lost the subscription, so we get a new one and stream that", async () => {
  let account = newTestAccount();

  await account.subscribeToNotifications();

  await waitFor(() => account.streamedIDs.length == 2);
  expect(account.subscriptionIDs).toEqual(["subscription-1", "subscription-2"]);
  expect(account.streamedIDs).toEqual(["subscription-1", "subscription-2"]);
});

test("The server forgot the subscription, so we get a new one and stream that", async () => {
  let account = newTestAccount();
  account.responseCode = "ErrorSubscriptionNotFound";

  await account.subscribeToNotifications();

  await waitFor(() => account.streamedIDs.length == 2);
  expect(account.streamedIDs).toEqual(["subscription-1", "subscription-2"]);
});

test("After the server lost the subscription, we check the inbox for mail that arrived meanwhile", async () => {
  let account = newTestAccount();

  await account.subscribeToNotifications();

  await waitFor(() => account.inboxChecks == 1);
  expect(account.streamedIDs).toEqual(["subscription-1", "subscription-2"]);
});

/** The calendars and address books that were synced, by folder ID */
let synced: string[] = [];

function newCalendar(account: EWSAccount, folderID: string, username = account.username): EWSCalendar {
  let calendar = new EWSCalendar();
  calendar.initFromMainAccount(account);
  calendar.username = username;
  calendar.folderID = folderID;
  calendar.listEvents = async () => {
    synced.push(folderID);
  };
  appGlobal.calendars.add(calendar);
  return calendar;
}

function newAddressbook(account: EWSAccount, folderID: string): EWSAddressbook {
  let addressbook = new EWSAddressbook();
  addressbook.initFromMainAccount(account);
  addressbook.folderID = folderID;
  addressbook.listContacts = async () => {
    synced.push(folderID);
  };
  appGlobal.addressbooks.add(addressbook);
  return addressbook;
}

afterEach(() => {
  appGlobal.calendars.clear();
  appGlobal.addressbooks.clear();
  synced = [];
});

test("After the server lost the subscription, we fetch what changed meanwhile in our calendars and address books", async () => {
  let account = newTestAccount();
  newCalendar(account, "calendar-folder");
  newAddressbook(account, "contacts-folder");

  await account.subscribeToNotifications();

  await waitFor(() => synced.length == 2);
  expect(synced).toContain("calendar-folder");
  expect(synced).toContain("contacts-folder");
  expect(account.inboxChecks).toBe(1);
});

test("After the server lost the subscription for a calendar that another user shared with us, we fetch what changed meanwhile in it", async () => {
  let account = newTestAccount();
  let sharedCalendar = newCalendar(account, "shared-calendar-folder", "bob@example.com");

  await account.subscribeToNotificationsForSubaccount(sharedCalendar);

  await waitFor(() => synced.includes("shared-calendar-folder"));
  expect(account.streamedIDs).toEqual(["subscription-1", "subscription-2"]);
});
