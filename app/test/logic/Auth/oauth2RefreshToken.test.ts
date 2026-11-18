import "../../../logic/app"; // app first, to resolve the import cycle around Abstract/Account.ts
import { OAuth2 } from "../../../logic/Auth/OAuth2";
import { OAuth2LoginNeeded } from "../../../logic/Auth/OAuth2Error";
import { isTransientError } from "../../../logic/util/netUtil";
import { afterEach, expect, test, vi } from "vitest";

/** Keeps the refresh token in memory instead of the encrypted local storage */
class TestOAuth2 extends OAuth2 {
  stored: string | null = "refresh-token";

  protected async getRefreshTokenFromStorage(): Promise<string | null> {
    return this.stored;
  }
  protected async deleteRefreshTokenFromStorage(): Promise<void> {
    this.stored = null;
  }
  protected async storeRefreshToken(refreshToken: string): Promise<void> {
    this.stored = refreshToken;
  }
}

function newOAuth2(hostname = "mail.example.com"): TestOAuth2 {
  let account = { id: "1", name: "Test", username: "alice@example.com", hostname } as any;
  return new TestOAuth2(account, "https://login.example.com/token", "https://login.example.com/auth", null, "mail", "client-id", "client-secret");
}

function jsonResponse(status: number, json: any): Response {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tokenResponse(): Response {
  return jsonResponse(200, { access_token: "access-token", expires_in: 3600 });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test.each([
  ["the network is down", new TypeError("Failed to fetch")],
  ["the token server is too slow", new DOMException("The operation timed out.", "TimeoutError")],
])("OAuth2: When %s, the login fails, but we keep the refresh token", async (_reason, error) => {
  let oAuth2 = newOAuth2();
  vi.stubGlobal("fetch", async () => {
    throw error;
  });

  await expect(oAuth2.login(false)).rejects.toBe(error);
  expect(oAuth2.stored).toBe("refresh-token");

  vi.stubGlobal("fetch", async () => tokenResponse());
  expect(await oAuth2.login(false)).toBe("access-token");
  oAuth2.stop();
});

test.each([
  ["the token server is temporarily unavailable", () => jsonResponse(503, { error: "temporarily_unavailable" })],
  ["the token server has an internal error", () => jsonResponse(500, { error: "internal_failure" })],
  ["the token server reports a server error", () => jsonResponse(400, { error: "server_error" })],
  ["a hotel Wi-Fi login page answers instead", () => new Response("<html>Accept the terms</html>", { status: 200, headers: { "Content-Type": "text/html" } })],
])("OAuth2: When %s, we keep the refresh token, and the caller may try again later", async (_reason, response) => {
  let oAuth2 = newOAuth2();
  vi.stubGlobal("fetch", async () => response());

  let error = await oAuth2.login(false).catch(ex => ex);
  expect(error).not.toBeInstanceOf(OAuth2LoginNeeded);
  expect(isTransientError(error)).toBe(true);
  expect(oAuth2.stored).toBe("refresh-token");

  vi.stubGlobal("fetch", async () => tokenResponse());
  expect(await oAuth2.login(false)).toBe("access-token");
  oAuth2.stop();
});

test("OAuth2: When the server refuses the request for another reason, we keep the refresh token, but need a new login", async () => {
  let oAuth2 = newOAuth2();
  vi.stubGlobal("fetch", async () => jsonResponse(400, { error: "invalid_scope" }));

  await expect(oAuth2.login(false)).rejects.toBeInstanceOf(OAuth2LoginNeeded);
  expect(oAuth2.stored).toBe("refresh-token");
});

test.each([
  ["the refresh token", "invalid_grant"],
  ["our client ID", "invalid_client"],
])("OAuth2: When the server says that %s is no longer valid, we forget the refresh token", async (_what, code) => {
  let oAuth2 = newOAuth2();
  vi.stubGlobal("fetch", async () => jsonResponse(400, { error: code }));

  await expect(oAuth2.login(false)).rejects.toBeInstanceOf(OAuth2LoginNeeded);
  expect(oAuth2.stored).toBeNull();
});

test.each([
  ["Google", "imap.gmail.com", null],
  ["Microsoft", "outlook.office365.com", "mail"],
  ["another server", "mail.example.com", "mail"],
])("OAuth2: A refresh at %s sends the scope only where needed", async (_provider, hostname, expectedScope) => {
  let oAuth2 = newOAuth2(hostname);
  let sent: URLSearchParams;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent = init.body as URLSearchParams;
    return tokenResponse();
  });

  await oAuth2.login(false);
  expect(sent.get("refresh_token")).toBe("refresh-token");
  expect(sent.get("scope")).toBe(expectedScope);
  oAuth2.stop();
});

test("OAuth2: The log doesn't show the refresh token or the client secret", async () => {
  let oAuth2 = newOAuth2();
  vi.stubGlobal("fetch", async () => tokenResponse());
  let log = vi.spyOn(console, "log").mockImplementation(() => {});

  await oAuth2.login(false);
  let logged = JSON.stringify(log.mock.calls);
  expect(logged).toContain("get new access token");
  expect(logged).not.toContain("refresh-token");
  expect(logged).not.toContain("client-secret");
  oAuth2.stop();
});

test("OAuth2: The log doesn't show the auth code", async () => {
  let oAuth2 = newOAuth2();
  vi.stubGlobal("fetch", async () => tokenResponse());
  let log = vi.spyOn(console, "log").mockImplementation(() => {});

  await oAuth2.getAuthURL();
  let doneURL = oAuth2.authDoneURL + "?" + new URLSearchParams({ code: "auth-code", state: oAuth2.verificationToken });
  expect(await oAuth2.isAuthDoneURL(doneURL)).toBeTruthy();
  await oAuth2.getAccessTokenFromAuthCode(oAuth2.getAuthCodeFromDoneURL(doneURL));
  let logged = JSON.stringify(log.mock.calls);
  expect(logged).toContain("OAuth2 page change to");
  expect(logged).not.toContain("auth-code");
  oAuth2.stop();
});

test.each([
  ["with a path", "https://www.example.com/loggedin"],
  ["without a path", "https://mail.example.com"],
  ["on localhost", "http://localhost:5455/login-success"],
])("OAuth2: Only the exact done URL %s finishes the login", async (_case, doneURL) => {
  let oAuth2 = newOAuth2();
  await oAuth2.getAuthURL(doneURL);
  let query = "?" + new URLSearchParams({ code: "auth-code", state: oAuth2.verificationToken });

  expect(await oAuth2.isAuthDoneURL(doneURL + query)).toBeTruthy();
  expect(await oAuth2.isAuthDoneURL(new URL(doneURL).href + query)).toBeTruthy(); // Microsoft adds a `/` to a done URL without path
  expect(await oAuth2.isAuthDoneURL(doneURL + "/superuser" + query)).toBeFalsy();
  expect(await oAuth2.isAuthDoneURL(doneURL + ".evil.net" + query)).toBeFalsy();
  expect(await oAuth2.isAuthDoneURL("https://evil.net/loggedin" + query)).toBeFalsy();
  expect(await oAuth2.isAuthDoneURL(doneURL + "?code=auth-code&state=wrong")).toBeFalsy();
});
