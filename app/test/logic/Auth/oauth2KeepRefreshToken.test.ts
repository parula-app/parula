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

function newOAuth2(tokenURL = "https://login.example.com/token"): TestOAuth2 {
  let account = { id: "1", name: "Test", username: "alice@example.com" } as any;
  return new TestOAuth2(account, tokenURL, "https://login.example.com/auth", null, "mail drive", "client-id", "client-secret");
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
  ["Google is temporarily unavailable", () => jsonResponse(503, { error: "temporarily_unavailable" })],
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
  expect(oAuth2.stored).toBe("refresh-token"); // the next login replaces it
});

test("OAuth2: When the server says that the refresh token is no longer valid, we forget it", async () => {
  let oAuth2 = newOAuth2();
  vi.stubGlobal("fetch", async () => jsonResponse(400, { error: "invalid_grant" }));

  await expect(oAuth2.login(false)).rejects.toBeInstanceOf(OAuth2LoginNeeded);
  expect(oAuth2.stored).toBeNull();
});

test.each([
  ["Google", "https://accounts.google.com/o/oauth2/token", null],
  ["Google, new URL", "https://oauth2.googleapis.com/token", null],
  ["Microsoft", "https://login.microsoftonline.com/common/oauth2/v2.0/token", "mail drive"],
])("OAuth2: Refresh at %s sends the scope only where needed", async (_provider, tokenURL, expectedScope) => {
  let oAuth2 = newOAuth2(tokenURL);
  let sent: URLSearchParams;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent = init.body as URLSearchParams;
    return tokenResponse();
  });

  await oAuth2.login(false);
  expect(sent.get("grant_type")).toBe("refresh_token");
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
