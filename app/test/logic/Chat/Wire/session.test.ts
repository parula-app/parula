// @vitest-environment happy-dom
// happy-dom gives us `navigator`, which the device model and label read.

// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { WireSession, WireTooManyClientsError } from "../../../../logic/Chat/Wire/WireSession";
import { WireTransport } from "../../../../logic/Chat/Wire/WireTransport";
import { UserError } from "../../../../logic/util/util";
import { appName } from "../../../../logic/build";
import { expect, test } from "vitest";

const kBaseURL = "https://nginz-https.example.com";
const kUserID = "3f27a1d0-1a0b-4b1e-9d2f-7c5a4e6b8d90";
const kClientID = "4d0d4e0b17f0bd21";

const kAccessToken = jsonResponse(200, {
  user: kUserID,
  access_token: "access-token",
  token_type: "Bearer",
  expires_in: 900,
});
const kSelf = jsonResponse(200, {
  id: kUserID,
  qualified_id: { id: kUserID, domain: "example.com" },
  name: "Fred",
  email: "fred@example.com",
});

test("password login, and the cookie that keeps us logged in", async () => {
  let requests = fakeBackend({
    "POST /v8/login": jsonResponse(200, {
      user: kUserID, access_token: "access-token", token_type: "Bearer", expires_in: 900,
    }, { "set-cookie": "zuid=user-token; Path=/access; HttpOnly; Secure" }),
    "GET /v8/self": kSelf,
  });
  let session = newSession();
  await session.loginWithPassword("  fred@example.com ", "correct horse battery staple");
  session.stop();

  expect(requests[0].url).toBe(kBaseURL + "/v8/login?persist=true"); // a session cookie is never renewed
  expect(requests[0].options.json.email).toBe("fred@example.com");
  expect(requests[0].options.json.label).toBe(session.cookieLabel);
  expect(requests[0].options.json.verification_code).toBe(undefined);
  expect(session.transport.accessToken).toBe("access-token");
  expect(session.transport.cookie).toBe("user-token");
  expect(session.userID).toBe(kUserID);
  expect(session.domain).toBe("example.com"); // only `/self` tells us this
});

test("2FA: ask for the mailed code, and use the same code again", async () => {
  let logins = 0;
  let requests = fakeBackend({
    "POST /v8/login": () => ++logins == 1
      ? jsonResponse(403, {
        code: 403, label: "code-authentication-required", message: "Verification code required",
      })
      : kAccessToken,
    "POST /v8/verification-code/send": jsonResponse(200, {}),
    "GET /v8/self": kSelf,
    "GET /v8/clients": jsonResponse(200, []),
    "POST /v8/clients": jsonResponse(201, { id: kClientID }),
    "POST /access": kAccessToken,
  });
  let session = newSession();
  let asked = 0;
  session.onVerificationCode = async () => {
    asked++;
    return "123456";
  };
  await session.loginWithPassword("fred@example.com", "secret");
  await session.ensureClient({ ed25519: "public-key" });
  session.stop();

  expect(asked).toBe(1);
  expect(requests[1].url).toBe(kBaseURL + "/v8/verification-code/send");
  expect(requests[1].options.json).toEqual({ email: "fred@example.com", action: "login" });
  expect(requests[2].options.json.verification_code).toBe("123456");
  // The device registration during the login needs the *same* code again
  expect(requests.find(request => request.url.endsWith("/v8/clients") && request.method == "post")
    .options.json.verification_code).toBe("123456");
});

test("keeps the device we already have, and binds the session to it", async () => {
  let requests = fakeBackend({
    "GET /v8/clients": jsonResponse(200, [
      { id: "0011223344556677", time: "2026-01-01T00:00:00.000Z" },
      { id: kClientID, time: "2026-02-02T00:00:00.000Z" },
    ]),
    "POST /access": kAccessToken,
  });
  let session = newSession();
  session.clientID = kClientID;
  await session.ensureClient({ ed25519: "public-key" });
  session.stop();

  expect(session.clientID).toBe(kClientID);
  expect(requests.length).toBe(2); // no `POST /clients`
  expect(requests[1].url).toBe(kBaseURL + "/access?client_id=" + kClientID);
});

test("registers a device when ours is gone from the server", async () => {
  let requests = fakeBackend({
    "GET /v8/clients": jsonResponse(200, [{ id: "0011223344556677" }]),
    "POST /v8/clients": jsonResponse(201, { id: kClientID }),
    "POST /access": kAccessToken,
  });
  let session = newSession();
  session.clientID = "deadbeef";
  await session.ensureClient({ ed25519: "public-key" },
    [{ id: 0, key: "zero" }], { id: 65535, key: "last" });
  session.stop();

  let newClient = requests[1].options.json;
  expect(session.clientID).toBe(kClientID);
  expect(newClient.type).toBe("permanent");
  expect(newClient.mls_public_keys).toEqual({ ed25519: "public-key" });
  expect(newClient.lastkey).toEqual({ id: 65535, key: "last" });
  expect(newClient.cookie).toBe(session.cookieLabel);
  expect(newClient.capabilities).toEqual(["legalhold-implicit-consent"]);
  expect(newClient.model).toContain(appName); // we are us, never Wire
});

test("too many devices: the user has to pick one, we delete none", async () => {
  fakeBackend({
    "GET /v8/clients": jsonResponse(200, [
      { id: "bbbb", time: "2026-02-02T00:00:00.000Z" },
      { id: "aaaa", time: "2026-01-01T00:00:00.000Z" },
    ]),
    "POST /v8/clients": jsonResponse(403, {
      code: 403, label: "too-many-clients", message: "Too many clients",
    }),
  });
  let session = newSession();

  let ex = await session.ensureClient({ ed25519: "public-key" }).catch(ex => ex);
  expect(ex).toBeInstanceOf(WireTooManyClientsError);
  expect(ex.clients.map(client => client.id)).toEqual(["aaaa", "bbbb"]); // oldest first
  expect(session.clientID).toBe(null);
});

test("callers that all notice the expiry share one refresh", async () => {
  let requests = fakeBackend({ "POST /access": kAccessToken });
  let session = newSession();
  session.transport.cookie = "user-token";

  await Promise.all([session.refreshToken(), session.refreshToken(), session.refreshToken()]);
  session.stop();

  expect(requests.length).toBe(1);
  expect(requests[0].headers.Cookie).toBe("zuid=user-token");
});

test("what survives a restart", async () => {
  fakeBackend({});
  let session = newSession();
  session.userID = kUserID;
  session.domain = "example.com";
  session.clientID = kClientID;
  session.transport.cookie = "user-token";

  let restored = newSession();
  restored.transport.version = null;
  restored.fromJSON(JSON.parse(JSON.stringify(session.toJSON())));

  expect(restored.userID).toBe(kUserID);
  expect(restored.domain).toBe("example.com");
  expect(restored.clientID).toBe(kClientID);
  expect(restored.cookieLabel).toBe(session.cookieLabel);
  expect(restored.transport.cookie).toBe("user-token");
  expect(restored.transport.version).toBe(8);
});

test("SSO: the login code is an identity provider ID", async () => {
  fakeBackend({});
  let sso = newSession().sso;
  sso.code = " WIRE-CB6E4DFC-a4b0-4c59-a31d-303a7f5eb5ab ";
  expect(sso.idpID).toBe("cb6e4dfc-a4b0-4c59-a31d-303a7f5eb5ab");

  sso.code = "not-a-code";
  expect(() => sso.idpID).toThrow();
});

test("SSO: the login window is sent back to us with the cookie", async () => {
  fakeBackend({});
  let session = newSession();
  let sso = session.sso;
  sso.code = "wire-cb6e4dfc-a4b0-4c59-a31d-303a7f5eb5ab";

  let authURL = new URL(await sso.getAuthURL());
  expect(authURL.origin + authURL.pathname) // unversioned, as the official clients load it
    .toBe(kBaseURL + "/sso/initiate-login/cb6e4dfc-a4b0-4c59-a31d-303a7f5eb5ab");
  let successRedirect = authURL.searchParams.get("success_redirect");
  expect(successRedirect).toContain("$cookie");
  expect(successRedirect.length).toBeLessThanOrEqual(140); // the server refuses longer ones
  expect(authURL.searchParams.get("error_redirect")).toContain("$label");
  expect(authURL.searchParams.get("label")).toBe(session.cookieLabel);

  // The server substitutes an entire `Set-Cookie` header value into the URL
  let secret = new URL(successRedirect).searchParams.get("s");
  let verdictURL = successRedirect
    .replace("$cookie", encodeURIComponent("zuid=user-token; Path=/access; HttpOnly; Secure"))
    .replace("$userid", kUserID);
  expect(await sso.isAuthDoneURL(verdictURL)).toBe(true);
  expect(await sso.isAuthDoneURL(successRedirect.replace(secret, "other-secret"))).toBe(false);
  expect(await sso.isAuthDoneURL("https://evil.example.com/?s=" + secret)).toBe(false);
  expect(sso.getAuthCodeFromDoneURL(verdictURL)).toBe("user-token");
});

test("SSO: a refusal is shown to the user, not swallowed", async () => {
  fakeBackend({});
  let sso = newSession().sso;
  sso.code = "wire-cb6e4dfc-a4b0-4c59-a31d-303a7f5eb5ab";
  let errorRedirect = new URL(await sso.getAuthURL()).searchParams.get("error_redirect");

  expect(() => sso.getAuthCodeFromDoneURL(errorRedirect.replace("$label", "forbidden")))
    .toThrow(UserError);
});

function newSession(): WireSession {
  let transport = new WireTransport(kBaseURL);
  transport.version = 8;
  return new WireSession(transport);
}

/** A response as `kyCreate({ result: "response" })` hands it back */
function jsonResponse(status: number, json: any, headers: Record<string, any> = {}): any {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    statusText: "",
    headers: { "content-type": "application/json", ...headers },
    body: new TextEncoder().encode(JSON.stringify(json)),
  };
}

type FakeRequest = { method: string, url: string, options: any, headers: Record<string, string> };

/** Replaces the backend with a route table, e.g. `{ "GET /v8/self": response }`.
 * A call to a route that the test did not expect fails the test.
 * @returns the calls made since this was set up */
function fakeBackend(routes: Record<string, any>): FakeRequest[] {
  let requests: FakeRequest[] = [];
  appGlobal.remoteApp = {
    async kyCreate(defaultOptions: any) {
      let ky: any = {};
      for (let method of ["get", "post", "put", "patch", "delete", "head"]) {
        ky[method] = async (url: string, options: any) => {
          let request = { method: method, url: url, options: options, headers: defaultOptions.headers };
          requests.push(request);
          let path = url.replace(kBaseURL, "").split("?")[0];
          let route = routes[`${method.toUpperCase()} ${path}`];
          if (!route) {
            throw new Error(`The test did not expect ${method.toUpperCase()} ${path}`);
          }
          return typeof (route) == "function" ? route(request) : route;
        };
      }
      return ky;
    },
  };
  return requests;
}
