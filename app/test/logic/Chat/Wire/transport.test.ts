// @vitest-environment happy-dom
// happy-dom gives us `navigator`, which the client identification headers read.

// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { WireTransport, WireError, WireRateLimitError } from "../../../../logic/Chat/Wire/WireTransport";
import { isTransientError } from "../../../../logic/util/netUtil";
import { expect, test } from "vitest";

const kBaseURL = "https://nginz-https.example.com";

test("negotiates the highest version that we both know, unversioned", async () => {
  let requests = fakeBackend(() => jsonResponse(200, {
    supported: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    development: [9],
    federation: true,
    domain: "example.com",
  }));
  let transport = new WireTransport(kBaseURL);
  await transport.negotiateVersion();

  expect(requests[0].url).toBe(kBaseURL + "/api-version");
  expect(transport.version).toBe(8);
  expect(transport.domain).toBe("example.com");
  expect(transport.federation).toBe(true);
});

test("`development` versions are not offered to us, so we do not take them", async () => {
  fakeBackend(() => jsonResponse(200, { supported: [0, 1, 2], development: [8], domain: "example.com" }));
  let transport = new WireTransport(kBaseURL);
  await expect(transport.negotiateVersion()).rejects.toThrow(/version/);
});

test("prefixes the negotiated version, except where the API forbids it", async () => {
  let requests = fakeBackend(() => jsonResponse(200, {}));
  let transport = new WireTransport(kBaseURL);
  transport.version = 7;
  await transport.get("/self");
  await transport.post("/access", null, { unversioned: true });

  expect(requests[0].url).toBe(kBaseURL + "/v7/self");
  expect(requests[1].url).toBe(kBaseURL + "/access");
});

test("query parameters and the bearer token", async () => {
  let requests = fakeBackend(() => jsonResponse(200, {}));
  let transport = new WireTransport(kBaseURL);
  transport.version = 8;
  transport.accessToken = "token-abc";
  await transport.post("/login", { email: "fred@example.com" }, { query: { persist: true } });

  expect(requests[0].url).toBe(kBaseURL + "/v8/login?persist=true");
  expect(requests[0].options.json).toEqual({ email: "fred@example.com" });
  expect(requests[0].headers.Authorization).toBe("Bearer token-abc");
  // nginz strips these from client requests, so sending them would only be a lie
  expect(requests[0].headers["Z-User"]).toBe(undefined);
  expect(requests[0].headers["Wire-Client"]).toBeTruthy();
});

test("captures the `zuid` cookie and sends it back to `/access`", async () => {
  let requests = fakeBackend(request => request.url.endsWith("/login")
    ? jsonResponse(200, { access_token: "a" }, {
      "set-cookie": [
        "other=value; Path=/",
        "zuid=abc==.v=1.k=1.d=1618838628.t=u.l=.u=39b7f597; Path=/access; HttpOnly; Secure",
      ],
    })
    : jsonResponse(200, { access_token: "b" }));
  let transport = new WireTransport(kBaseURL);
  transport.version = 8;
  await transport.post("/login", { email: "fred@example.com" });

  expect(transport.cookie).toBe("abc==.v=1.k=1.d=1618838628.t=u.l=.u=39b7f597");

  await transport.post("/access", null, { unversioned: true, withCookie: true });
  expect(requests[1].headers.Cookie).toBe("zuid=abc==.v=1.k=1.d=1618838628.t=u.l=.u=39b7f597");
  // Only where it is needed: the cookie is scoped to `/access`
  expect(requests[0].headers.Cookie).toBe(undefined);
});

test("a rotated cookie replaces the old one", async () => {
  fakeBackend(() => jsonResponse(200, {}, { "set-cookie": "zuid=new-cookie; Path=/access" }));
  let transport = new WireTransport(kBaseURL);
  transport.version = 8;
  transport.cookie = "old-cookie";
  await transport.post("/access", null, { unversioned: true, withCookie: true });

  expect(transport.cookie).toBe("new-cookie");
});

test("the error body, not the status, says what went wrong", async () => {
  fakeBackend(() => jsonResponse(403, {
    code: 403,
    label: "code-authentication-required",
    message: "Verification code required",
    other: [1, 2],
  }));
  let transport = new WireTransport(kBaseURL);
  transport.version = 8;

  let ex = await transport.post("/login", {}).catch(ex => ex);
  expect(ex).toBeInstanceOf(WireError);
  expect(ex.httpCode).toBe(403);
  expect(ex.label).toBe("code-authentication-required");
  expect(ex.serverMessage).toBe("Verification code required");
  expect(ex.data).toEqual({ other: [1, 2] });
});

test("a 401 refreshes the token once, and then gives up", async () => {
  let requests = fakeBackend(request => request.headers.Authorization == "Bearer new-token"
    ? jsonResponse(200, { ok: true })
    : jsonResponse(401, { code: 401, label: "invalid-credentials", message: "Zauth token expired" }));
  let transport = new WireTransport(kBaseURL);
  transport.version = 8;
  transport.accessToken = "old-token";
  let refreshed = 0;
  transport.onTokenExpired = async () => {
    refreshed++;
    transport.accessToken = "new-token";
  };

  expect(await transport.get("/self")).toEqual({ ok: true });
  expect(refreshed).toBe(1);
  expect(requests.length).toBe(2);

  // The refresh did not help: do not loop
  transport.onTokenExpired = async () => {
    refreshed++;
    transport.accessToken = "still-bad";
  };
  transport.accessToken = "old-token";
  await expect(transport.get("/self")).rejects.toThrow(WireError);
  expect(refreshed).toBe(2);
  expect(requests.length).toBe(4);
});

test("the refresh call itself does not try to refresh", async () => {
  let requests = fakeBackend(() => jsonResponse(401, { code: 401, label: "invalid-credentials" }));
  let transport = new WireTransport(kBaseURL);
  transport.version = 8;
  transport.onTokenExpired = async () => { throw new Error("Must not refresh"); };

  await expect(transport.post("/access", null, { unversioned: true, noRetryOnExpiry: true }))
    .rejects.toThrow(WireError);
  expect(requests.length).toBe(1);
});

test("both throttles are transient errors, and the wait is the server's", async () => {
  // nginz: the legacy 420, no body, no `Retry-After`
  fakeBackend(() => ({ ok: false, status: 420, statusText: "Enhance Your Calm", headers: {}, body: new Uint8Array() }));
  let transport = new WireTransport(kBaseURL);
  transport.version = 8;

  let ex = await transport.get("/self").catch(ex => ex);
  expect(ex).toBeInstanceOf(WireRateLimitError);
  expect(ex.label).toBe("too-many-requests");
  expect(ex.retryAfterSeconds).toBe(0);
  expect(isTransientError(ex)).toBe(true);

  // The services behind it: 429 with `Retry-After` in whole seconds
  fakeBackend(() => jsonResponse(429, { code: 429, label: "client-error", message: "Logins too frequent" },
    { "retry-after": "86400" }));
  ex = await transport.post("/login", {}).catch(ex => ex);
  expect(ex).toBeInstanceOf(WireRateLimitError);
  expect(ex.retryAfterSeconds).toBe(86400);
  expect(isTransientError(ex)).toBe(true);
});

test("binary bodies", async () => {
  let bytes = new Uint8Array([1, 2, 3]);
  let requests = fakeBackend(() => ({
    ok: true, status: 200, statusText: "OK",
    headers: { "content-type": "message/mls" },
    body: bytes,
  }));
  let transport = new WireTransport(kBaseURL);
  transport.version = 8;
  await transport.postBinary("/mls/messages", bytes, "message/mls");

  expect(requests[0].headers["Content-Type"]).toBe("message/mls");
  expect(requests[0].options.body).toBe(bytes);
  expect(await transport.getBinary("/assets/example.com/3-1-abc")).toEqual(bytes);
});

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

/** Replaces the backend: records every HTTP call and answers it with `answer()`.
 * @returns the calls made since this was set up */
function fakeBackend(answer: (request: FakeRequest) => any): FakeRequest[] {
  let requests: FakeRequest[] = [];
  appGlobal.remoteApp = {
    async kyCreate(defaultOptions: any) {
      let ky: any = {};
      for (let method of ["get", "post", "put", "patch", "delete", "head"]) {
        ky[method] = async (url: string, options: any) => {
          let request = { method: method, url: url, options: options, headers: defaultOptions.headers };
          requests.push(request);
          return answer(request);
        };
      }
      return ky;
    },
  };
  return requests;
}
