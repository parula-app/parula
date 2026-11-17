// Runs in plain Node, for the same reason as `live.test.ts`: the session rests
// on the `zuid` cookie, which a browser's `fetch` hides from the page.

/**
 * Single sign-on against a **real wire-server and a real SAML identity
 * provider**.
 *
 * Wire's SSO is SAML 2.0 Web SSO — there is no OpenID Connect login path, see
 * `Protocol/03-SSO-Login.md` §11. Our client treats it as one more web-based
 * login: `WireSSO` is a `WebBasedAuth` and drives the same login-window UI that
 * OAuth2 uses. That window is what `SSOBrowserFake` stands in for here; it does
 * exactly what the window does, and nothing of `WireSSO` is faked.
 *
 * Needs the identity provider from `idp/idp.mjs` next to the backend:
 *
 *   node idp.mjs &
 *   WIRE_TEST_BACKEND=http://localhost:8080 yarn test liveSSO
 *
 * Skipped when either is missing.
 */
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Person } from "../../../../logic/Abstract/Person";
import { SSOBrowserFake, WireTestBackend, installRealNetwork, isBackendReachable, isIdPReachable, kBackendURL, type TestUser } from "./liveBackend";
import { MemoryChatStorage } from "./memoryChatStorage";
import { WireAccount } from "../../../../logic/Chat/Wire/WireAccount";
import { LoginError } from "../../../../logic/Abstract/Account";
import { UserError } from "../../../../logic/util/util";
import { afterAll, beforeAll, expect, test } from "vitest";

appGlobal.me = new Person(); // as `startup.ts` does

const kHaveBackend = await isBackendReachable() && await isIdPReachable();
const kRun = kHaveBackend ? test : test.skip;
const kRunID = Math.random().toString(36).slice(2, 10);
/** One issuer of the test provider per run: Wire registers an issuer once. */
const kTenant = `t${kRunID}`;

let backend: WireTestBackend;
let owner: TestUser;
let idpID: string;
let ssoUserEmail: string;
let accounts: WireAccount[] = [];

beforeAll(async () => {
  if (!kHaveBackend) {
    console.warn(`No Wire backend and SAML provider at ${kBackendURL}, skipping the SSO tests`);
    return;
  }
  installRealNetwork();
  backend = new WireTestBackend();
  await backend.start();

  owner = await backend.createUser({
    name: "SSO Owner",
    email: `sso-owner-${kRunID}@example.com`,
    password: `sso-owner-password-${kRunID}`,
  });
  await backend.enableMLS(owner);
  idpID = await backend.registerIdP(owner, kTenant);
  ssoUserEmail = `sso-user-${kRunID}@example.com`;
  await backend.setIdPLogin(owner, kTenant, ssoUserEmail);
}, 300000);

afterAll(async () => {
  for (let account of accounts) {
    await account?.disconnect();
  }
});

kRun("a login code that nobody registered is refused before a window opens", async () => {
  let account = newAccount();
  account.ssoCode = "wire-00000000-0000-4000-8000-000000000000";
  account.setup();
  let ui = new SSOBrowserFake(account.session.sso);
  account.session.sso.ui = ui;
  await expect(account.login(true)).rejects.toThrow(UserError);
  // The pre-check refused it, so the window never went anywhere
  expect(ui.visited).toEqual([]);
}, 60000);

kRun("SSO logs in, provisions the user, and registers a device without a password", async () => {
  let account = newAccount();
  account.ssoCode = `wire-${idpID}`;
  account.setup();
  let ui = new SSOBrowserFake(account.session.sso);
  account.session.sso.ui = ui;

  await account.login(true);

  expect(account.isLoggedIn).toBe(true);
  // spar auto-provisioned the user from the assertion's NameID. Their identity
  // is that assertion, not an email address they proved they own, so `/self`
  // carries no email and our account has none either.
  expect(account.session.userID).toBeTruthy();
  expect(account.session.emailAddress).toBe(null);
  let user = await backend.getUser(account.session.userID);
  expect(user.sso_id.subject).toContain(ssoUserEmail);
  expect(user.team).toBe(owner.teamID);
  // An SSO account has no password, and still got a device
  expect(account.session.clientID).toBeTruthy();
  expect(account.password).toBe(null);
  // The cookie is the only long-lived credential it will ever have
  expect(account.transport.cookie).toBeTruthy();

  // The window went the whole way: our start URL, the provider, spar, and back
  expect(ui.visited.length).toBe(4);
  expect(ui.visited[0]).toContain(`/sso/initiate-login/${idpID}`);
  expect(ui.visited[1]).toContain("/sso/");
  expect(ui.visited[2]).toContain("/sso/finalize-login/");
  expect(ui.visited[3]).toMatch(/^wire-[a-z]+:\/\/sso\//);

  // The team has MLS, so the SSO account set it up like any other
  expect(account.mlsEnabled).toBe(true);
  expect(account.mls).toBeTruthy();
}, 180000);

kRun("the next start resumes from the stored cookie, with no window at all", async () => {
  let first = accounts.at(-1);
  let saved = first.toConfigJSON();
  await first.disconnect();

  let account = newAccount();
  account.fromConfigJSON(saved);
  expect(account.ssoCode).toBe(`wire-${idpID}`);
  account.setup();
  let ui = new SSOBrowserFake(account.session.sso);
  account.session.sso.ui = ui;

  // `interactive: false`: it must not need the user, only the cookie
  await account.login(false);
  expect(account.isLoggedIn).toBe(true);
  expect(ui.visited).toEqual([]);
  expect(account.session.clientID).toBe(saved.wire.clientID ?? account.session.clientID);
}, 120000);

kRun("without a cookie, a non-interactive login says so instead of hanging", async () => {
  let account = newAccount();
  account.ssoCode = `wire-${idpID}`;
  account.setup();
  await expect(account.login(false)).rejects.toThrow(LoginError);
}, 60000);

function newAccount(): WireAccount {
  let account = new WireAccount();
  account.storage = new MemoryChatStorage();
  account.url = kBackendURL;
  account.errorCallback = ex => console.error(ex);
  accounts.push(account);
  return account;
}
