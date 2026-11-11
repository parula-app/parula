// @vitest-environment happy-dom
import "../../../../logic/app"; // Avoid import cycle
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { AutoResponderAudience } from "../../../../logic/Mail/AutoResponder";
import { expect, test, vi } from "vitest";

// DOMPurify needs a real browser DOM
vi.mock("../../../../logic/util/convertHTML", async importOriginal => ({
  ...await importOriginal() as object,
  sanitizeHTML: (html: string) => html ? "sanitized:" + html : "",
}));

const kTypesNS = "http://schemas.microsoft.com/exchange/services/2006/types";
const kMessagesNS = "http://schemas.microsoft.com/exchange/services/2006/messages";

/** Parses the real server response, without server */
class TestEWSAccount extends EWSAccount {
  request: any;
  response: string;

  async callEWS(request: any): Promise<any> {
    this.request = request;
    return this.checkResponse({ status: 200, responseXML: this.parseXML(this.response) }, request);
  }
}

function newAccount(): TestEWSAccount {
  let account = new TestEWSAccount();
  account.emailAddress = "user1@example.com";
  return account;
}

function soap(body: string): string {
  return `<?xml version="1.0" encoding="utf-8" ?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Header>
    <t:ServerVersionInfo MajorVersion="15" MinorVersion="2" MajorBuildNumber="1544" MinorBuildNumber="4" xmlns:t="${kTypesNS}" />
  </soap:Header>
  <soap:Body>${body}</soap:Body>
</soap:Envelope>`;
}

// As in the Microsoft docs, with the HTML that Outlook sets
const kGetResponse = soap(`
    <GetUserOofSettingsResponse xmlns="${kMessagesNS}">
      <ResponseMessage ResponseClass="Success">
        <ResponseCode>NoError</ResponseCode>
      </ResponseMessage>
      <OofSettings xmlns="${kTypesNS}">
        <OofState>Scheduled</OofState>
        <ExternalAudience>Known</ExternalAudience>
        <Duration>
          <StartTime>2026-10-05T07:00:00</StartTime>
          <EndTime>2026-10-19T16:00:00</EndTime>
        </Duration>
        <InternalReply xml:lang="en-US">
          <Message>&lt;html&gt;&lt;body&gt;&lt;p&gt;Back on the &lt;b&gt;19th&lt;/b&gt;.&lt;/p&gt;&lt;/body&gt;&lt;/html&gt;</Message>
        </InternalReply>
        <ExternalReply xml:lang="en-US">
          <Message>&lt;p&gt;I am out of office.&lt;/p&gt;</Message>
        </ExternalReply>
      </OofSettings>
      <AllowExternalOof>Known</AllowExternalOof>
    </GetUserOofSettingsResponse>`);

const kSetResponse = soap(`
    <SetUserOofSettingsResponse xmlns="${kMessagesNS}">
      <ResponseMessage ResponseClass="Success">
        <ResponseCode>NoError</ResponseCode>
      </ResponseMessage>
    </SetUserOofSettingsResponse>`);

test("Reads the settings from the server", async () => {
  let account = newAccount();
  account.response = kGetResponse;
  let autoResponder = account.autoResponder;
  await autoResponder.load();

  expect(Object.keys(account.request)).toEqual(["m$GetUserOofSettingsRequest"]);
  expect(account.request.m$GetUserOofSettingsRequest.t$Mailbox.t$Address).toBe("user1@example.com");

  expect(autoResponder.enabled).toBe(true);
  expect(autoResponder.scheduled).toBe(true);
  expect(autoResponder.startTime.toISOString()).toBe("2026-10-05T07:00:00.000Z");
  expect(autoResponder.endTime.toISOString()).toBe("2026-10-19T16:00:00.000Z");
  expect(autoResponder.externalAudience).toBe(AutoResponderAudience.Contacts);
  expect(autoResponder.maxAudience).toBe(AutoResponderAudience.Contacts);
  expect(autoResponder.internalHTML).toBe("sanitized:<html><body><p>Back on the <b>19th</b>.</p></body></html>");
  expect(autoResponder.externalHTML).toBe("sanitized:<p>I am out of office.</p>");
});

test("Old dates of a disabled responder are not kept", async () => {
  let account = newAccount();
  account.response = kGetResponse
    .replace("<OofState>Scheduled", "<OofState>Disabled")
    .replaceAll("2026-10-", "2006-10-");
  let autoResponder = account.autoResponder;
  await autoResponder.load();

  expect(autoResponder.enabled).toBe(false);
  expect(autoResponder.scheduled).toBe(false);
  expect(autoResponder.startTime.getTime()).toBeGreaterThan(Date.now());
  expect(autoResponder.endTime.getTime()).toBeGreaterThan(autoResponder.startTime.getTime());
});

test("Unknown values are read as off, without admin limit", async () => {
  let account = newAccount();
  account.response = kGetResponse
    .replace("<OofState>Scheduled", "<OofState>Sometimes")
    .replace("<ExternalAudience>Known", "<ExternalAudience>Friends")
    .replace("<AllowExternalOof>Known", "<AllowExternalOof>constructor");
  let autoResponder = account.autoResponder;
  await autoResponder.load();

  expect(autoResponder.enabled).toBe(false);
  expect(autoResponder.scheduled).toBe(false);
  expect(autoResponder.externalAudience).toBe(AutoResponderAudience.None);
  expect(autoResponder.maxAudience).toBe(AutoResponderAudience.All);
});

test("Writes the settings to the server, in schema order", async () => {
  let account = newAccount();
  account.response = kSetResponse;
  let autoResponder = account.autoResponder;
  autoResponder.enabled = true;
  autoResponder.scheduled = true;
  autoResponder.startTime = new Date("2026-10-05T07:00:00Z");
  autoResponder.endTime = new Date("2026-10-19T16:00:00Z");
  autoResponder.externalAudience = AutoResponderAudience.All;
  autoResponder.internalHTML = "<p>Back on the <b>19th</b></p>";
  autoResponder.externalHTML = "<p></p>";
  await autoResponder.save();

  let request = account.request.m$SetUserOofSettingsRequest;
  expect(Object.keys(request)).toEqual(["t$Mailbox", "t$UserOofSettings"]);
  expect(request.t$Mailbox.t$Address).toBe("user1@example.com");
  let settings = request.t$UserOofSettings;
  expect(Object.keys(settings)).toEqual(["t$OofState", "t$ExternalAudience", "t$Duration", "t$InternalReply", "t$ExternalReply"]);
  expect(settings.t$OofState).toBe("Scheduled");
  expect(settings.t$ExternalAudience).toBe("All");
  expect(settings.t$Duration).toEqual({ t$StartTime: "2026-10-05T07:00:00.000Z", t$EndTime: "2026-10-19T16:00:00.000Z" });
  expect(settings.t$InternalReply).toEqual({ t$Message: "<p>Back on the <b>19th</b></p>" });
  expect(settings.t$ExternalReply).toEqual({ t$Message: "" });
});

test("Without time range, there is no duration", async () => {
  let account = newAccount();
  account.response = kSetResponse;
  let autoResponder = account.autoResponder;
  autoResponder.enabled = true;
  autoResponder.scheduled = false;
  autoResponder.externalAudience = AutoResponderAudience.Contacts;
  await autoResponder.save();

  let settings = account.request.m$SetUserOofSettingsRequest.t$UserOofSettings;
  expect(settings.t$OofState).toBe("Enabled");
  expect(settings.t$ExternalAudience).toBe("Known");
  expect(settings.t$Duration).toBe(null); // JSON2XML skips it

  autoResponder.enabled = false;
  await autoResponder.save();
  expect(account.request.m$SetUserOofSettingsRequest.t$UserOofSettings.t$OofState).toBe("Disabled");
});

test("An end before the start is refused", async () => {
  let account = newAccount();
  account.response = kSetResponse;
  let autoResponder = account.autoResponder;
  autoResponder.enabled = true;
  autoResponder.scheduled = true;
  autoResponder.endTime = new Date(autoResponder.startTime.getTime() - 1000);

  await expect(autoResponder.save()).rejects.toThrow();
  expect(account.request).toBeUndefined();
});

test("A server error is shown", async () => {
  let account = newAccount();
  account.response = soap(`
    <SetUserOofSettingsResponse xmlns="${kMessagesNS}">
      <ResponseMessage ResponseClass="Error">
        <MessageText>The specified time interval is invalid.</MessageText>
        <ResponseCode>ErrorInvalidScheduledOofDuration</ResponseCode>
      </ResponseMessage>
    </SetUserOofSettingsResponse>`);

  await expect(account.autoResponder.save()).rejects.toThrow("The specified time interval is invalid.");
});

test("Only for our own account, not for shared accounts", () => {
  let account = newAccount();
  expect(account.autoResponder.supported).toBe(true);

  let shared = new EWSAccount();
  shared.initFromMainAccount(account);
  expect(shared.autoResponder.supported).toBe(false);

  expect(new MailAccount().autoResponder.supported).toBe(false);
});
