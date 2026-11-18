/**
 * Talks to a real wire-server instead of `wireBackendFake`.
 *
 * The server is not started here — bring one up yourself and point the tests at
 * it, see `live.test.ts` for how. This module supplies the two things the app
 * normally gets from its Electron backend, real HTTP and a real WebSocket, and
 * the little bit of administration a test needs before it can log in: creating
 * users, switching MLS on for their team, and connecting two of them.
 *
 * Users are created through brig's *internal* API, the same way wire-server's
 * own integration suite does it: it is the only way to get an activated account
 * without going through email. Everything the client itself does afterwards
 * goes through the public API on nginz, like a real client.
 */
import { appGlobal } from "../../../../logic/app";
import { OAuth2UI } from "../../../../logic/Auth/UI/OAuth2UI";
import type { WireSSO } from "../../../../logic/Chat/Wire/WireSSO";
import type { URLString } from "../../../../logic/util/util";
import ky from "ky";
import { WebSocket as NodeWebSocket } from "ws";
import https from "node:https";

/** nginz, i.e. what a client would be configured with. A host *name*, not an
 * address: nginz passes the `Host` header on as `Z-Host`, and cargohold refuses
 * to parse an IP address as a domain, so assets 400 when reached by IP. */
export const kBackendURL = process.env.WIRE_TEST_BACKEND ?? "http://localhost:8080";
/** brig, bypassing nginz: `/i/…` is not reachable from outside */
export const kBrigInternalURL = process.env.WIRE_TEST_BRIG_INTERNAL ?? "http://127.0.0.1:8082";
/** galley, likewise, for the team feature flags */
export const kGalleyInternalURL = process.env.WIRE_TEST_GALLEY_INTERNAL ?? "http://127.0.0.1:8085";
/** The test SAML identity provider, `idp/idp.mjs`. https, because spar refuses
 * an identity provider whose request URI is not. */
export const kIdPURL = process.env.WIRE_TEST_IDP ?? "https://localhost:9099";

/** Whether there is a backend to test against at all. The live tests skip
 * themselves when there is none, so the normal test run stays offline. */
export async function isBackendReachable(): Promise<boolean> {
  try {
    let response = await fetch(`${kBackendURL}/api-version`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch (ex) {
    return false;
  }
}

/** Gives the app the same HTTP and WebSocket it has in production.
 *
 * `kyCreate` is what `desktop/backend/backend.ts` exposes over JPC; we cannot
 * import that file here because it pulls in Electron, so this repeats the part
 * of it that the chat code uses. */
export function installRealNetwork(): void {
  appGlobal.remoteApp = {
    kyCreate: async (defaultOptions: any) => {
      let kyObj: any = {};
      let kyFunc = ky.create(defaultOptions);
      for (let name of ["get", "put", "post", "patch", "delete", "head"]) {
        kyObj[name] = async (input: string, options: any) => {
          [input, options] = throughJPC([input, options]);
          let kyFetch = (kyFunc as any)[name](input, options);
          let resultType = options?.result ?? defaultOptions?.result;
          if (resultType == "response") {
            return await httpResponse(kyFetch);
          } else if (resultType) {
            return await kyFetch[resultType]();
          }
          return kyFetch;
        };
      }
      return kyObj;
    },
    computerOn: { isSleeping: false, subscribe: () => () => undefined },
    /* `ChatAccount.listRooms()` reads the room table directly, below the
     * storage interface. There is nothing in it. */
    getSQLiteDatabase: async () => ({
      migrate: async () => undefined,
      pragma: async () => undefined,
      all: async () => [],
      get: async () => undefined,
      run: async () => ({ lastInsertRowid: 0 }),
      execute: async () => undefined,
    }),
  };
  (globalThis as any).WebSocket = NodeWebSocket;
  installBrowserGlobals();
}

/** The renderer always has a `window` and a `document`; Node does not, and the
 * event stream listens on both for "the computer woke up, check the socket". */
function installBrowserGlobals(): void {
  (globalThis as any).window ??= new EventTarget();
  (globalThis as any).document ??= Object.assign(new EventTarget(), { hidden: false });
}

/**
 * What JPC does to a call's arguments on the way to the backend.
 *
 * In the app this is not a function call but a message over a socket:
 * `lib/jpc/obj.js` maps the arguments to JSON, carrying `Uint8Array` and `Set`
 * explicitly and leaving the rest to `JSON.stringify`. That is not a detail a
 * test may skip. An argument that is `undefined` arrives as `null`, which is
 * how `kyBody()` returning `undefined` broke every request in the real app
 * while passing every test here.
 */
function throughJPC(args: any[]): any[] {
  const kBytes = "__uint8array__";
  let sent = JSON.stringify(args, function (key, value) {
    let raw = this[key]; // `value` has already been through any `toJSON()`
    if (raw instanceof Uint8Array) {
      return { [kBytes]: [...raw] };
    }
    if (raw instanceof Set) {
      return [...raw];
    }
    return value;
  });
  return JSON.parse(sent, (key, value) =>
    value && Array.isArray(value[kBytes]) ? new Uint8Array(value[kBytes]) : value);
}

/** @see `httpResponse()` in `desktop/backend/backend.ts` */
async function httpResponse(kyFetch: Promise<Response>): Promise<any> {
  let response = await kyFetch;
  let headers: Record<string, string | string[]> = {};
  for (let [name, value] of response.headers) {
    // Node's `fetch` lowercases these and the app relies on that, happy-dom
    // hands them back the way the server spelled them
    headers[name.toLowerCase()] = value;
  }
  let setCookies = (response.headers as any).getSetCookie?.();
  if (setCookies?.length) {
    headers["set-cookie"] = setCookies;
  }
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: headers,
    body: new Uint8Array(await response.arrayBuffer()),
  };
}

/** Whether the test identity provider is running. */
export async function isIdPReachable(): Promise<boolean> {
  try {
    return (await idpFetch(`${kIdPURL}/metadata/probe`)).status == 200;
  } catch (ex) {
    return false;
  }
}

/** The test identity provider's certificate is self-signed, and nothing here
 * is about TLS, so do not check it. */
export function idpFetch(url: string, options: {
  method?: string, headers?: Record<string, string>, body?: string,
} = {}): Promise<{ status: number, body: string }> {
  return new Promise((resolve, reject) => {
    let parsed = new URL(url);
    let request = https.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method ?? "GET",
      headers: options.headers ?? {},
      rejectUnauthorized: false,
    }, response => {
      let chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.end(options.body);
  });
}

/** A user that this test created, and what it takes to log in as them */
export interface TestUser {
  userID: string;
  teamID: string | null;
  name: string;
  email: string;
  password: string;
}

/** The administrative side of a running wire-server: what an operator would do
 * before the users of a test could log in. */
export class WireTestBackend {
  readonly baseURL = kBackendURL;
  domain = "example.com";
  /** The highest API version the backend and we agree on */
  version = 0;

  async start(): Promise<void> {
    let json = await this.json("GET", `${kBackendURL}/api-version`);
    this.domain = json.domain;
    this.version = Math.max(...json.supported);
  }

  /** An activated user, optionally the owner of a fresh team of their own.
   * Teams matter because the MLS feature flag lives on the team. */
  async createUser(values: {
    name: string, email: string, password: string,
    team?: boolean, protocols?: string[],
  }): Promise<TestUser> {
    let body: any = {
      email: values.email,
      name: values.name,
      password: values.password,
      icon: "default",
    };
    if (values.protocols) {
      body.supported_protocols = values.protocols;
    }
    if (values.team ?? true) {
      body.team = { name: `${values.name}'s team`, icon: "default" };
    }
    let json = await this.json("POST", `${kBrigInternalURL}/i/users`, body);
    return {
      userID: json.id,
      teamID: json.team ?? null,
      name: values.name,
      email: values.email,
      password: values.password,
    };
  }

  /** Switches MLS on for a team, the way a team admin would. A team starts
   * with MLS off, and a personal account cannot have it at all: the feature
   * flag lives on the team. */
  async enableMLS(user: TestUser, cipherSuite = 1): Promise<void> {
    if (!user.teamID) {
      throw new Error(`${user.name} has no team, so MLS cannot be enabled`);
    }
    await this.json("PUT", `${kGalleyInternalURL}/i/teams/${user.teamID}/features/mls`, {
      status: "enabled",
      config: {
        protocolToggleUsers: [],
        defaultProtocol: "mls",
        allowedCipherSuites: [cipherSuite],
        defaultCipherSuite: cipherSuite,
        supportedProtocols: ["proteus", "mls"],
      },
    });
  }

  async getTeamFeature(user: TestUser, feature: string): Promise<any> {
    return await this.json("GET",
      `${kGalleyInternalURL}/i/teams/${user.teamID}/features/${feature}`);
  }

  /** Registers the test identity provider for this team, and returns the login
   * code a user would type. `api_version=v2` scopes the issuer to the team, so
   * every run can have its own, and makes the assertion consumer the
   * team-scoped `/sso/finalize-login/<team>`.
   * @param tenant which issuer of the test provider to use, one per run */
  async registerIdP(owner: TestUser, tenant: string): Promise<string> {
    await this.setTeamFeature(owner, "sso", { status: "enabled" });
    let metadata = (await idpFetch(`${kIdPURL}/metadata/${tenant}`)).body;
    let token = await this.login(owner);
    let response = await fetch(`${kBackendURL}/v${this.version}/identity-providers?api_version=v2`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/xml" },
      body: metadata,
    });
    let text = await response.text();
    if (!response.ok) {
      throw new Error(`registering the identity provider -> ${response.status} ${text.slice(0, 400)}`);
    }
    return JSON.parse(text).id;
  }

  /** Tells the test provider who the next login is for, and where the
   * assertion goes: spar leaves the consumer URL out of its AuthnRequest, so a
   * real provider would have it from the service provider's metadata. */
  async setIdPLogin(owner: TestUser, tenant: string, subject: string): Promise<void> {
    let acs = `${kBackendURL}/sso/finalize-login/${owner.teamID}`;
    await idpFetch(`${kIdPURL}/subject/${tenant}?name=${encodeURIComponent(subject)}` +
      `&acs=${encodeURIComponent(acs)}`);
  }

  /** Any other team feature, e.g. `sso` */
  async setTeamFeature(user: TestUser, feature: string, body: any): Promise<any> {
    return await this.json("PUT",
      `${kGalleyInternalURL}/i/teams/${user.teamID}/features/${feature}`, body);
  }

  /** The two become each other's contacts: one asks, the other accepts.
   * Without this they do not appear in each other's roster. */
  async connect(a: TestUser, b: TestUser): Promise<void> {
    let tokenA = await this.login(a);
    let tokenB = await this.login(b);
    await this.json("POST", this.versioned(`/connections/${this.domain}/${b.userID}`),
      null, tokenA);
    await this.json("PUT", this.versioned(`/connections/${this.domain}/${a.userID}`),
      { status: "accepted" }, tokenB);
  }

  /** What the backend knows about a user, including the SAML identity that an
   * SSO login provisioned them with. */
  async getUser(userID: string): Promise<any> {
    let users = await this.json("GET", `${kBrigInternalURL}/i/users?ids=${userID}`);
    return users?.[0];
  }

  /** An access token for the public API, as a client would get one */
  async login(user: TestUser): Promise<string> {
    let json = await this.json("POST", this.versioned("/login"),
      { email: user.email, password: user.password });
    return json.access_token;
  }

  versioned(path: string): string {
    return `${kBackendURL}/v${this.version}${path}`;
  }

  async json(method: string, url: string, body?: any, token?: string): Promise<any> {
    let headers: Record<string, string> = { Accept: "application/json" };
    if (body != null) {
      headers["Content-Type"] = "application/json";
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    let response = await fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    let text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${url} -> ${response.status} ${text.slice(0, 500)}`);
    }
    return text ? JSON.parse(text) : null;
  }
}


/**
 * Stands in for the login window that an SSO login opens.
 *
 * A browser would load `initiate-login`, submit the form it answers with to
 * the identity provider, submit *that* form to spar, and end up at our
 * `wire-…://` URL. There is no browser here, so this walks the same three
 * steps with plain HTTP and hands the URL it lands on to `WireSSO`, which is
 * the only part under test.
 */
export class SSOBrowserFake extends OAuth2UI {
  /** Every URL the "window" went to, for a test to assert on */
  readonly visited: string[] = [];

  override async login(): Promise<string> {
    let sso = this.oAuth2 as WireSSO;
    let startURL = await sso.getAuthURL();
    this.visited.push(startURL);

    // 1. spar answers with a form that posts the AuthnRequest to the provider
    let initiate = await fetch(startURL);
    if (!initiate.ok) {
      throw new Error(`initiate-login -> ${initiate.status} ${(await initiate.text()).slice(0, 300)}`);
    }
    let toIdP = parseAutoPostForm(await initiate.text());
    this.visited.push(toIdP.action);

    // 2. the provider authenticates the user and posts the assertion back
    let idp = await idpFetch(toIdP.action, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(toIdP.fields).toString(),
    });
    let toSpar = parseAutoPostForm(idp.body);
    this.visited.push(toSpar.action);

    // 3. spar checks the assertion and sends the window to our own URL
    let verdict = await fetch(toSpar.action, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(toSpar.fields).toString(),
      redirect: "manual",
    });
    let location = verdict.headers.get("location");
    if (!location) {
      throw new Error(`finalize-login -> ${verdict.status}, no redirect: ` +
        (await verdict.text()).slice(0, 500));
    }
    this.visited.push(location);

    if (!await sso.isAuthDoneURL(location as URLString)) {
      throw new Error(`the login ended somewhere else: ${location}`);
    }
    return sso.getAuthCodeFromDoneURL(location as URLString);
  }
}

/** The `<form>` that both spar and the identity provider answer with, which a
 * browser would submit by itself. */
function parseAutoPostForm(html: string): { action: string, fields: Record<string, string> } {
  let action = /<form[^>]*\saction="([^"]*)"/i.exec(html)?.[1];
  if (!action) {
    throw new Error(`no form to submit in: ${html.slice(0, 500)}`);
  }
  let fields: Record<string, string> = {};
  for (let input of html.matchAll(/<input\b[^>]*>/gi)) {
    let name = /\bname="([^"]*)"/i.exec(input[0])?.[1];
    if (name) {
      fields[name] = decodeEntities(/\bvalue="([^"]*)"/i.exec(input[0])?.[1] ?? "");
    }
  }
  return { action: decodeEntities(action), fields };
}

function decodeEntities(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}
