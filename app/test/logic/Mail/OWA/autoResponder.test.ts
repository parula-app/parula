// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { AutoResponderAudience } from "../../../../logic/Mail/AutoResponder";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// DOMPurify needs a real browser DOM
vi.mock("../../../../logic/util/convertHTML", async importOriginal => ({
  ...await importOriginal() as object,
  sanitizeHTML: (html: string) => html ? "sanitized:" + html : "",
}));

/** The HTTP calls that the account made */
let calls: { url: string, action: string, body: any }[] = [];
/** What the server answers, as JSON */
let response: any;

beforeEach(() => {
  appGlobal.remoteApp = { OWA: {} } as any;
  calls = [];
  vi.stubGlobal("fetch", async (url: string, options: any) => {
    calls.push({ url, action: options.headers.Action, body: JSON.parse(options.body) });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      url,
      headers: new Headers({ "Content-Type": "application/json; charset=utf-8" }),
      text: async () => JSON.stringify(response),
    };
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

class TestOWAAccount extends OWAAccount {
  hasLoggedIn = true;
}

function newAccount(): TestOWAAccount {
  let account = new TestOWAAccount();
  account.url = "https://mail.example.com/owa/";
  account.emailAddress = "user1@example.com";
  account.authorizationHeader = "Bearer TEST";
  return account;
}

// As Exchange 2019 sends it, from a capture of Outlook on the web
const kGetResponse = {
  Header: { ServerVersionInfo: { MajorVersion: 15, MinorVersion: 2, Version: "V2017_07_11" } },
  ErrorCode: 0,
  ErrorMessage: null,
  IsUserError: false,
  UserPrompt: null,
  WasSuccessful: true,
  Options: {
    AutoDeclineFutureRequestsWhenOOF: false,
    AutoReplyState: 2,
    CreateOOFEvent: false,
    DeclineAllEventsForScheduledOOF: false,
    DeclineEventsForScheduledOOF: false,
    DeclineMeetingMessage: "",
    DeclineMeetingMessageText: "\r\n",
    StartTime: "2026-10-05T07:00:00Z",
    EndTime: "2026-10-19T16:00:00Z",
    EventsToDeleteIDs: null,
    ExternalAudience: 1,
    ExternalMessage: "<p>I am out of office.</p>",
    ExternalMessageText: "I am out of office.\r\n",
    InternalMessage: "<html><body><p>Back on the <b>19th</b>.</p></body></html>",
    InternalMessageText: "Back on the 19th.\r\n",
    OOFEventSubject: "",
  },
};

const kSetResponse = {
  Header: { ServerVersionInfo: { MajorVersion: 15 } },
  ErrorCode: 0,
  ErrorMessage: null,
  IsUserError: false,
  UserPrompt: null,
  WasSuccessful: true,
};

test("Reads the settings from the server", async () => {
  let account = newAccount();
  response = kGetResponse;
  let autoResponder = account.autoResponder;
  await autoResponder.load();

  expect(calls.length).toBe(1);
  expect(calls[0].url).toBe("https://mail.example.com/owa/service.svc");
  expect(calls[0].action).toBe("GetMailboxAutoReplyConfiguration");
  expect(calls[0].body).toEqual({});

  expect(autoResponder.enabled).toBe(true);
  expect(autoResponder.scheduled).toBe(true);
  expect(autoResponder.startTime.toISOString()).toBe("2026-10-05T07:00:00.000Z");
  expect(autoResponder.endTime.toISOString()).toBe("2026-10-19T16:00:00.000Z");
  expect(autoResponder.externalAudience).toBe(AutoResponderAudience.Contacts);
  // OWA does not tell us what the admin allows
  expect(autoResponder.maxAudience).toBe(AutoResponderAudience.All);
  // The HTML, not the plaintext that Exchange derives from it
  expect(autoResponder.internalHTML).toBe("sanitized:<html><body><p>Back on the <b>19th</b>.</p></body></html>");
  expect(autoResponder.externalHTML).toBe("sanitized:<p>I am out of office.</p>");
});

test("Exchange 2013", async () => {
  // When Neil captured the response. A disabled responder keeps only times that are not over yet.
  vi.setSystemTime(new Date("2026-10-22T16:36:00Z"));
  let account = newAccount();
  // Exchange 2013 CU23, Neil's capture, unchanged
  response = JSON.parse(String.raw`{"Header":{"ServerVersionInfo":{"MajorVersion":15,"MinorVersion":0,"MajorBuildNumber":1497,"MinorBuildNumber":0,"Version":"V2_23"}},"ErrorCode":0,"ErrorMessage":null,"UserPrompt":null,"WasSuccessful":true,"Options":{"AutoReplyState":0,"EndTime":"2026-10-23T16:00:00Z","ExternalAudience":2,"ExternalMessage":"","ExternalMessageText":"\u000d\u000a","InternalMessage":"","InternalMessageText":"\u000d\u000a","StartTime":"2026-10-22T16:00:00Z"}}`);
  let autoResponder = account.autoResponder;
  await autoResponder.load();

  expect(calls.length).toBe(1);
  expect(calls[0].action).toBe("GetMailboxAutoReplyConfiguration");
  expect(autoResponder.enabled).toBe(false);
  expect(autoResponder.scheduled).toBe(false);
  expect(autoResponder.externalAudience).toBe(AutoResponderAudience.All);
  expect(autoResponder.internalHTML.trim()).toBe("");
  expect(autoResponder.externalHTML.trim()).toBe("");
  expect(autoResponder.startTime.toISOString()).toBe("2026-10-22T16:00:00.000Z");
  expect(autoResponder.endTime.toISOString()).toBe("2026-10-23T16:00:00.000Z");
});

test("Times with a time zone offset", async () => {
  let account = newAccount();
  response = structuredClone(kGetResponse);
  response.Options.StartTime = "2026-10-05T09:00:00+02:00";
  response.Options.EndTime = "2026-10-19T18:00:00+02:00";
  let autoResponder = account.autoResponder;
  await autoResponder.load();

  expect(autoResponder.startTime.toISOString()).toBe("2026-10-05T07:00:00.000Z");
  expect(autoResponder.endTime.toISOString()).toBe("2026-10-19T16:00:00.000Z");
});

test("Old dates of a disabled responder are not kept", async () => {
  let account = newAccount();
  response = structuredClone(kGetResponse);
  response.Options.AutoReplyState = 0;
  response.Options.StartTime = "2006-10-05T07:00:00Z";
  response.Options.EndTime = "2006-10-19T16:00:00Z";
  let autoResponder = account.autoResponder;
  await autoResponder.load();

  expect(autoResponder.enabled).toBe(false);
  expect(autoResponder.scheduled).toBe(false);
  expect(autoResponder.startTime.getTime()).toBeGreaterThan(Date.now());
});

test("Always on, for everybody", async () => {
  let account = newAccount();
  response = structuredClone(kGetResponse);
  response.Options.AutoReplyState = 1;
  response.Options.ExternalAudience = 2;
  let autoResponder = account.autoResponder;
  await autoResponder.load();

  expect(autoResponder.enabled).toBe(true);
  expect(autoResponder.scheduled).toBe(false);
  expect(autoResponder.externalAudience).toBe(AutoResponderAudience.All);
});

test("Unknown values are read as off", async () => {
  let account = newAccount();
  response = structuredClone(kGetResponse);
  response.Options.AutoReplyState = 7;
  response.Options.ExternalAudience = 7;
  let autoResponder = account.autoResponder;
  await autoResponder.load();

  expect(autoResponder.enabled).toBe(false);
  expect(autoResponder.scheduled).toBe(false);
  expect(autoResponder.externalAudience).toBe(AutoResponderAudience.None);
});

test("Writes the settings to the server", async () => {
  let account = newAccount();
  response = kSetResponse;
  let autoResponder = account.autoResponder;
  autoResponder.enabled = true;
  autoResponder.scheduled = true;
  autoResponder.startTime = new Date("2026-10-05T07:00:00Z");
  autoResponder.endTime = new Date("2026-10-19T16:00:00Z");
  autoResponder.externalAudience = AutoResponderAudience.All;
  autoResponder.internalHTML = "<p>Back on the <b>19th</b></p>";
  autoResponder.externalHTML = "<p></p>";
  await autoResponder.save();

  expect(calls[0].action).toBe("SetMailboxAutoReplyConfiguration");
  // Not wrapped in a `Body`
  expect(calls[0].body).toEqual({
    __type: "SetMailboxAutoReplyConfigurationRequest:#Exchange",
    Header: {
      __type: "JsonRequestHeaders:#Exchange",
      RequestServerVersion: "Exchange2013",
    },
    Options: {
      __type: "MailboxAutoReplyConfigurationOptions:#Exchange",
      AutoReplyState: 2,
      StartTime: "2026-10-05T07:00:00.000Z",
      EndTime: "2026-10-19T16:00:00.000Z",
      ExternalAudience: 2,
      InternalMessage: "<p>Back on the <b>19th</b></p>",
      ExternalMessage: "",
    },
  });
});

test("Without time range, there are no times", async () => {
  let account = newAccount();
  response = kSetResponse;
  let autoResponder = account.autoResponder;
  autoResponder.enabled = true;
  autoResponder.scheduled = false;
  autoResponder.externalAudience = AutoResponderAudience.Contacts;
  await autoResponder.save();

  let options = calls[0].body.Options;
  expect(options.AutoReplyState).toBe(1);
  expect(options.ExternalAudience).toBe(1);
  expect("StartTime" in options).toBe(false);
  expect("EndTime" in options).toBe(false);

  autoResponder.enabled = false;
  autoResponder.externalAudience = AutoResponderAudience.None;
  await autoResponder.save();
  expect(calls[1].body.Options.AutoReplyState).toBe(0);
  expect(calls[1].body.Options.ExternalAudience).toBe(0);
});

test("An end before the start is refused", async () => {
  let account = newAccount();
  response = kSetResponse;
  let autoResponder = account.autoResponder;
  autoResponder.enabled = true;
  autoResponder.scheduled = true;
  autoResponder.endTime = new Date(autoResponder.startTime.getTime() - 1000);

  await expect(autoResponder.save()).rejects.toThrow();
  expect(calls.length).toBe(0);
});

test("A server error is shown", async () => {
  let account = newAccount();
  // The error message of `Set-MailboxAutoReplyConfiguration`
  response = {
    ...kSetResponse,
    WasSuccessful: false,
    ErrorCode: 2,
    ErrorMessage: "The end time must be later than the start time.",
  };

  await expect(account.autoResponder.save()).rejects.toThrow("The end time must be later than the start time.");
});

test("Only for our own account, not for shared accounts", () => {
  let account = newAccount();
  expect(account.autoResponder.supported).toBe(true);

  let shared = new OWAAccount();
  shared.initFromMainAccount(account);
  expect(shared.autoResponder.supported).toBe(false);
});

test("OWA sends the numbers of the names that EWS sends", () => {
  let owa = newAccount().autoResponder as any;
  let ews = new EWSAccount().autoResponder as any;
  let states = [
    { enabled: false, scheduled: false, ews: "Disabled", owa: 0 },
    { enabled: true, scheduled: false, ews: "Enabled", owa: 1 },
    { enabled: true, scheduled: true, ews: "Scheduled", owa: 2 },
  ];
  let audiences = [
    { audience: AutoResponderAudience.None, ews: "None", owa: 0 },
    { audience: AutoResponderAudience.Contacts, ews: "Known", owa: 1 },
    { audience: AutoResponderAudience.All, ews: "All", owa: 2 },
  ];
  for (let state of states) {
    for (let audience of audiences) {
      for (let autoResponder of [owa, ews]) {
        autoResponder.enabled = state.enabled;
        autoResponder.scheduled = state.scheduled;
        autoResponder.externalAudience = audience.audience;
      }
      expect(owa.toOWA().AutoReplyState).toBe(state.owa);
      expect(ews.toEWS().t$OofState).toBe(state.ews);
      expect(owa.toOWA().ExternalAudience).toBe(audience.owa);
      expect(ews.toEWS().t$ExternalAudience).toBe(audience.ews);
    }
  }
});
