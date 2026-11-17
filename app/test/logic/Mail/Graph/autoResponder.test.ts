// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { GraphAccount } from "../../../../logic/Mail/Graph/GraphAccount";
import { AutoResponderAudience } from "../../../../logic/Mail/AutoResponder";
import { PermissionMissing } from "../../../../logic/Abstract/Account";
import { getOAuth2BuiltIn } from "../../../../logic/Auth/OAuth2Util";
import { expect, test, vi } from "vitest";

// DOMPurify needs a real browser DOM
vi.mock("../../../../logic/util/convertHTML", async importOriginal => ({
  ...await importOriginal() as object,
  sanitizeHTML: (html: string) => html ? "sanitized:" + html : "",
}));

const kOldScope = "Mail.ReadWrite User.Read offline_access";

/** The HTTP calls that the account made */
let calls: { method: string, url: string, options: any }[] = [];
/** What the server answers */
let response: any;

function setupAccount(): GraphAccount {
  calls = [];
  response = {};
  let ky = {};
  for (let method of ["get", "post", "patch", "delete"]) {
    ky[method] = async (url: string, options: any) => {
      calls.push({ method, url, options });
      if (response instanceof Error) {
        throw response;
      }
      return response;
    };
  }
  appGlobal.remoteApp = { kyCreate: () => ky } as any;
  let account = new GraphAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.url = "https://graph.microsoft.com";
  account.oAuth2 = {
    isLoggedIn: true,
    authorizationHeader: "Bearer TEST",
    scope: kOldScope,
  } as any;
  account.save = async () => {};
  return account;
}

/** As the backend passes it on */
function httpError(httpCode: number): Error {
  return Object.assign(new Error(`HTTP GET <https://graph.microsoft.com/v1.0/me/mailboxSettings/automaticRepliesSetting> failed with ${httpCode}`), {
    name: "HTTPError",
    httpCode,
  });
}

// As in the Microsoft docs, including their inconsistent casing
const kSettings = {
  "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#Me/mailboxSettings/automaticRepliesSetting",
  status: "Scheduled",
  externalAudience: "contactsOnly",
  scheduledStartDateTime: { dateTime: "2026-10-05T07:00:00.0000000", timeZone: "UTC" },
  scheduledEndDateTime: { dateTime: "2026-10-19T16:00:00.0000000", timeZone: "UTC" },
  internalReplyMessage: "<html>\n<body>\n<p>Back on the 19th</p></body>\n</html>\n",
  externalReplyMessage: "<p>I am out of office.</p>",
};

test("Reads the settings from the server", async () => {
  let account = setupAccount();
  response = kSettings;
  let autoResponder = account.autoResponder;
  await autoResponder.load();

  expect(calls.length).toBe(1);
  expect(calls[0].method).toBe("get");
  expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/me/mailboxSettings/automaticRepliesSetting");
  expect(autoResponder.supported).toBe(true);
  expect(autoResponder.enabled).toBe(true);
  expect(autoResponder.scheduled).toBe(true);
  expect(autoResponder.startTime.toISOString()).toBe("2026-10-05T07:00:00.000Z");
  expect(autoResponder.endTime.toISOString()).toBe("2026-10-19T16:00:00.000Z");
  expect(autoResponder.externalAudience).toBe(AutoResponderAudience.Contacts);
  expect(autoResponder.internalHTML).toBe("sanitized:" + kSettings.internalReplyMessage);
  expect(autoResponder.externalHTML).toBe("sanitized:<p>I am out of office.</p>");
});

test("The audience in any casing", async () => {
  let account = setupAccount();
  let autoResponder = account.autoResponder;
  for (let [audience, expected] of [
    ["ContactsOnly", AutoResponderAudience.Contacts],
    ["All", AutoResponderAudience.All],
    ["none", AutoResponderAudience.None],
    ["friends", AutoResponderAudience.None],
  ]) {
    response = { ...kSettings, externalAudience: audience };
    await autoResponder.load();
    expect(autoResponder.externalAudience, audience).toBe(expected);
  }
});

test("Writes the settings to the server", async () => {
  let account = setupAccount();
  let autoResponder = account.autoResponder;
  autoResponder.enabled = true;
  autoResponder.scheduled = true;
  autoResponder.startTime = new Date("2026-10-05T07:00:00Z");
  autoResponder.endTime = new Date("2026-10-19T16:00:00Z");
  autoResponder.externalAudience = AutoResponderAudience.All;
  autoResponder.internalHTML = "<p>Back on the 19th</p>";
  autoResponder.externalHTML = "<p></p>";
  await autoResponder.save();

  expect(calls.length).toBe(1);
  expect(calls[0].method).toBe("patch");
  expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/me/mailboxSettings");
  expect(calls[0].options.json).toEqual({
    automaticRepliesSetting: {
      status: "scheduled",
      externalAudience: "all",
      internalReplyMessage: "<p>Back on the 19th</p>",
      externalReplyMessage: "",
      scheduledStartDateTime: { dateTime: "2026-10-05T07:00:00.000", timeZone: "UTC" },
      scheduledEndDateTime: { dateTime: "2026-10-19T16:00:00.000", timeZone: "UTC" },
    },
  });
});

test("Without time range, there are no times", async () => {
  let account = setupAccount();
  let autoResponder = account.autoResponder;
  autoResponder.enabled = true;
  autoResponder.scheduled = false;
  autoResponder.externalAudience = AutoResponderAudience.Contacts;
  await autoResponder.save();

  let settings = calls[0].options.json.automaticRepliesSetting;
  expect(settings.status).toBe("alwaysEnabled");
  expect(settings.externalAudience).toBe("contactsOnly");
  expect(settings.scheduledStartDateTime).toBeUndefined();

  autoResponder.enabled = false;
  await autoResponder.save();
  expect(calls[1].options.json.automaticRepliesSetting.status).toBe("disabled");
});

test("A login without the permission asks to allow it", async () => {
  let account = setupAccount();
  response = httpError(403);
  let autoResponder = account.autoResponder;

  let error: any;
  try {
    await autoResponder.load();
  } catch (ex) {
    error = ex;
  }
  expect(error).toBeInstanceOf(PermissionMissing);
  expect(error.isUserError).toBe(true);
  expect(error.message).toContain("allow access");
  expect(error.message).not.toContain("https://");
});

test("Other server errors are not about the permission", async () => {
  let account = setupAccount();
  response = httpError(500);
  let autoResponder = account.autoResponder;

  await expect(autoResponder.load()).rejects.not.toBeInstanceOf(PermissionMissing);
});

test("If the login has the scope, a 403 is not about the permission", async () => {
  let account = setupAccount();
  (account.oAuth2 as any).scope = (getOAuth2BuiltIn(account) as any).scope;
  response = httpError(403);

  await expect(account.autoResponder.load()).rejects.not.toBeInstanceOf(PermissionMissing);
});

test("Allowing access logs in with the scopes that we need now", async () => {
  let account = setupAccount();
  let loginScopes: string[] = [];
  (account.oAuth2 as any).loginWithUI = async () => {
    loginScopes.push((account.oAuth2 as any).scope);
  };
  let autoResponder = account.autoResponder;
  await autoResponder.grantPermission();

  expect(loginScopes.length).toBe(1);
  expect(loginScopes[0]).toContain("MailboxSettings.ReadWrite");
  expect((account.oAuth2 as any).scope).toContain("MailboxSettings.ReadWrite");
});

test("If the login has the scopes already, it does not log in again", async () => {
  let account = setupAccount();
  (account.oAuth2 as any).scope = (getOAuth2BuiltIn(account) as any).scope;
  let logins = 0;
  (account.oAuth2 as any).loginWithUI = async () => {
    logins++;
  };
  await account.autoResponder.grantPermission();

  expect(logins).toBe(0);
});

test("If the user does not allow access, the old login stays", async () => {
  let account = setupAccount();
  (account.oAuth2 as any).loginWithUI = async () => {
    throw new Error("Cancelled");
  };

  await expect(account.autoResponder.grantPermission()).rejects.toThrow("Cancelled");
  expect((account.oAuth2 as any).scope).toBe(kOldScope);
});
