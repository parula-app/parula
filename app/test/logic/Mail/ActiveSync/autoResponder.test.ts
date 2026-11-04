// @vitest-environment happy-dom
import "../../../../logic/app"; // Avoid import cycle
import { ActiveSyncAccount } from "../../../../logic/Mail/ActiveSync/ActiveSyncAccount";
import { request2WBXML, WBXML2JSON } from "../../../../logic/Mail/ActiveSync/WBXML";
import { AutoResponderAudience } from "../../../../logic/Mail/AutoResponder";
import { expect, test, vi } from "vitest";

// DOMPurify needs a real browser DOM
vi.mock("../../../../logic/util/convertHTML", async importOriginal => ({
  ...await importOriginal() as object,
  sanitizeHTML: (html: string) => html ? "sanitized:" + html : "",
}));

/** Encodes the request and decodes the server response, without server */
class TestActiveSyncAccount extends ActiveSyncAccount {
  request: any;
  response: Uint8Array;

  async callEAS(command: string, request: any): Promise<any> {
    this.request = WBXML2JSON(new Uint8Array(await request2WBXML({ [command]: request })));
    return WBXML2JSON(this.response);
  }
}

// Tokens of code page 18, Settings, from [MS-ASWBXML]
const T = {
  Settings: 0x05, Status: 0x06, Get: 0x07, Set: 0x08, Oof: 0x09, OofState: 0x0A,
  StartTime: 0x0B, EndTime: 0x0C, OofMessage: 0x0D, AppliesToInternal: 0x0E,
  AppliesToExternalKnown: 0x0F, AppliesToExternalUnknown: 0x10, Enabled: 0x11,
  ReplyMessage: 0x12, BodyType: 0x13,
};
const kHeader = [0x03, 0x01, 0x6A, 0x00, 0x00, 18];
const kEnd = 0x01;
const open = (tag: number) => tag | 0x40;
const empty = (tag: number) => tag;
function text(tag: number, value: string): number[] {
  return [open(tag), 0x03, ...new TextEncoder().encode(value), 0x00, kEnd];
}
function oofMessage(appliesTo: number, enabled: string, message: string): number[] {
  return [open(T.OofMessage), empty(appliesTo), ...text(T.Enabled, enabled),
    ...text(T.ReplyMessage, message), ...text(T.BodyType, "HTML"), kEnd];
}
function settingsResponse(...oof: number[]): Uint8Array {
  return Uint8Array.from([...kHeader, open(T.Settings), ...text(T.Status, "1"),
    open(T.Oof), ...text(T.Status, "1"), ...oof, kEnd, kEnd]);
}

// As Exchange sends it
const kGetResponse = settingsResponse(
  open(T.Get),
  ...text(T.OofState, "2"),
  ...text(T.StartTime, "2026-10-05T07:00:00.000Z"),
  ...text(T.EndTime, "2026-10-19T16:00:00.000Z"),
  ...oofMessage(T.AppliesToInternal, "1", "<p>Back on the 19th</p>"),
  ...oofMessage(T.AppliesToExternalKnown, "1", "<p>I am out of office.</p>"),
  ...oofMessage(T.AppliesToExternalUnknown, "0", "<p>I am out of office.</p>"),
  kEnd);

const kSetResponse = settingsResponse();

function newAccount(): TestActiveSyncAccount {
  let account = new TestActiveSyncAccount();
  account.emailAddress = "user1@example.com";
  return account;
}

test("The request uses the Settings code page", async () => {
  let wbxml = new Uint8Array(await request2WBXML({ Settings: { Oof: { Get: { BodyType: "HTML" } } } }));

  expect([...wbxml]).toEqual([...kHeader, open(T.Settings), open(T.Oof), open(T.Get),
    ...text(T.BodyType, "HTML"), kEnd, kEnd, kEnd]);
});

test("Reads the settings from the server", async () => {
  let account = newAccount();
  account.response = kGetResponse;
  let autoResponder = account.autoResponder;
  await autoResponder.load();

  expect(account.request).toEqual({ Oof: { Get: { BodyType: "HTML" } } });
  expect(autoResponder.enabled).toBe(true);
  expect(autoResponder.scheduled).toBe(true);
  expect(autoResponder.startTime.toISOString()).toBe("2026-10-05T07:00:00.000Z");
  expect(autoResponder.endTime.toISOString()).toBe("2026-10-19T16:00:00.000Z");
  expect(autoResponder.externalAudience).toBe(AutoResponderAudience.Contacts);
  expect(autoResponder.maxAudience).toBe(AutoResponderAudience.All);
  expect(autoResponder.internalHTML).toBe("sanitized:<p>Back on the 19th</p>");
  expect(autoResponder.externalHTML).toBe("sanitized:<p>I am out of office.</p>");
});

test("Audiences that the admin disallowed are missing", async () => {
  let account = newAccount();
  account.response = settingsResponse(
    open(T.Get),
    ...text(T.OofState, "0"),
    ...oofMessage(T.AppliesToInternal, "1", "Away"),
    kEnd);
  let autoResponder = account.autoResponder;
  await autoResponder.load();

  expect(autoResponder.enabled).toBe(false);
  expect(autoResponder.externalAudience).toBe(AutoResponderAudience.None);
  expect(autoResponder.maxAudience).toBe(AutoResponderAudience.None);
});

test("Writes the settings to the server", async () => {
  let account = newAccount();
  account.response = kSetResponse;
  let autoResponder = account.autoResponder;
  autoResponder.enabled = true;
  autoResponder.scheduled = true;
  autoResponder.startTime = new Date("2026-10-05T07:00:00Z");
  autoResponder.endTime = new Date("2026-10-19T16:00:00Z");
  autoResponder.externalAudience = AutoResponderAudience.All;
  autoResponder.internalHTML = "<p>Back on the 19th</p>";
  autoResponder.externalHTML = "<p>Away</p>";
  await autoResponder.save();

  let set = account.request.Oof.Set;
  expect(Object.keys(set)).toEqual(["OofState", "StartTime", "EndTime", "OofMessage"]);
  expect(set.OofState).toBe("2");
  expect(set.StartTime).toBe("2026-10-05T07:00:00.000Z");
  expect(set.EndTime).toBe("2026-10-19T16:00:00.000Z");
  expect(set.OofMessage).toEqual([
    { AppliesToInternal: {}, Enabled: "1", ReplyMessage: "<p>Back on the 19th</p>", BodyType: "HTML" },
    { AppliesToExternalKnown: {}, Enabled: "1", ReplyMessage: "<p>Away</p>", BodyType: "HTML" },
    { AppliesToExternalUnknown: {}, Enabled: "1", ReplyMessage: "<p>Away</p>", BodyType: "HTML" },
  ]);
});

test("Only to contacts, without time range", async () => {
  let account = newAccount();
  account.response = kSetResponse;
  let autoResponder = account.autoResponder;
  autoResponder.enabled = true;
  autoResponder.scheduled = false;
  autoResponder.externalAudience = AutoResponderAudience.Contacts;
  await autoResponder.save();

  let set = account.request.Oof.Set;
  expect(set.OofState).toBe("1");
  expect(set.StartTime).toBeUndefined();
  expect(set.OofMessage.map(message => message.Enabled)).toEqual(["1", "1", "0"]);

  autoResponder.enabled = false;
  await autoResponder.save();
  expect(account.request.Oof.Set.OofState).toBe("0");
});

test("A server error is shown", async () => {
  let account = newAccount();
  account.response = Uint8Array.from([...kHeader, open(T.Settings), ...text(T.Status, "1"),
    open(T.Oof), ...text(T.Status, "3"), kEnd, kEnd]);

  await expect(account.autoResponder.load()).rejects.toThrow("Access is denied");
});

test("An unknown state is read as off", async () => {
  let account = newAccount();
  account.response = settingsResponse(
    open(T.Get),
    ...text(T.OofState, "7"),
    ...oofMessage(T.AppliesToInternal, "1", "<p>Away</p>"),
    kEnd);
  let autoResponder = account.autoResponder;
  await autoResponder.load();

  expect(autoResponder.enabled).toBe(false);
  expect(autoResponder.scheduled).toBe(false);
});

test("Supported", () => {
  expect(newAccount().autoResponder.supported).toBe(true);
});
