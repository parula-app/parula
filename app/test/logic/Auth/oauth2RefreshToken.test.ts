import "../../../logic/app"; // app first, to resolve the import cycle around Abstract/Account.ts
import { OAuth2 } from "../../../logic/Auth/OAuth2";
import { OAuth2LoginNeeded } from "../../../logic/Auth/OAuth2Error";
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

function newOAuth2(): TestOAuth2 {
  let account = { id: "1", name: "Test", username: "alice@example.com" } as any;
  return new TestOAuth2(account, "https://login.example.com/token", "https://login.example.com/auth", null, "mail", "client-id");
}

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: "access-token", expires_in: 3600 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
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

test("OAuth2: When the server rejects the refresh token, we forget it", async () => {
  let oAuth2 = newOAuth2();
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "invalid_grant" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  }));

  await expect(oAuth2.login(false)).rejects.toBeInstanceOf(OAuth2LoginNeeded);
  expect(oAuth2.stored).toBeNull();
});
