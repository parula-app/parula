// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../logic/app";
import { ChatAccount } from "../../logic/Chat/ChatAccount";
import { LoginError } from "../../logic/Abstract/Account";
import { ComputerOn } from "../../logic/util/backend-wrapper";
import { loginOnStartup } from "../../logic/startup";
import { sleep, waitTime } from "../../logic/util/util";
import { beforeAll, expect, test } from "vitest";

/** The pauses between the tries become 10, 20, 40, 80, 120 ms */
const kShortWait = 0.002;

/** What the browser `fetch()` throws while there is no network, DNS or VPN */
const networkDown = () => new TypeError("Failed to fetch");

let flaky: TestAccount;
let wrongPassword: TestAccount;
let startupErrors: Error[] = [];
let backgroundErrors: Error[] = [];

// One `loginOnStartup()` for the whole file: it subscribes to the wake-up, too
beforeAll(async () => {
  waitTime.factor = kShortWait;
  // There is no backend process here, so `checkWakeUp()` cannot get the real one
  appGlobal.remoteApp = { computerOn: new ComputerOn() } as any;
  flaky = new TestAccount();
  flaky.failures = [networkDown(), networkDown()]; // the app started before the network was up
  wrongPassword = new TestAccount();
  wrongPassword.failures = [new LoginError(new Error("NO [AUTHENTICATIONFAILED]"), "Check your password")];
  appGlobal.chatAccounts.addAll([flaky, wrongPassword]);
  loginOnStartup(ex => startupErrors.push(ex));
  await sleep(0.5);
  flaky.errorCallback = wrongPassword.errorCallback = ex => backgroundErrors.push(ex);
});

test("When the app starts without network, it keeps trying until the server answers", () => {
  expect(flaky.calls).toEqual(["login", "login", "login", "startup"]);
  expect(flaky.isLoggedIn).toBe(true);
  expect(startupErrors.some(ex => ex instanceof TypeError)).toBe(false);
});

test("A real error, e.g. a wrong password, is shown once, and not tried again", () => {
  expect(wrongPassword.calls).toEqual(["login"]);
  expect(startupErrors).toHaveLength(1);
  expect(startupErrors[0]).toBeInstanceOf(LoginError);
});

test("After waking up, when the network is not back yet, it keeps trying", async () => {
  flaky.loggedIn = false; // the connection died while we slept
  flaky.calls = [];
  flaky.failures = [networkDown(), networkDown(), networkDown()];

  window.dispatchEvent(new Event("online")); // Wi-Fi is up, but without internet yet
  await sleep(0.5);

  expect(flaky.calls).toEqual(["login", "login", "login", "login", "startup"]);
  expect(flaky.isLoggedIn).toBe(true);
  expect(backgroundErrors).toEqual([]);
});

test("When the network comes back, a waiting retry tries at once", async () => {
  waitTime.factor = 1; // the real pause
  try {
    flaky.loggedIn = false;
    flaky.calls = [];
    flaky.failures = [networkDown()];

    window.dispatchEvent(new Event("online"));
    await sleep(0.1);
    expect(flaky.calls).toEqual(["login"]); // now waits 5 s

    window.dispatchEvent(new Event("online"));
    await sleep(0.1);
    expect(flaky.calls).toEqual(["login", "login", "startup"]);
    expect(flaky.isLoggedIn).toBe(true);
  } finally {
    waitTime.factor = kShortWait;
  }
});

test("After the user logged out, it doesn't log in by itself", async () => {
  flaky.stayLoggedOut = true; // like the Log out menu item
  flaky.loggedIn = false;
  flaky.calls = [];

  window.dispatchEvent(new Event("online"));
  await sleep(0.2);
  expect(flaky.calls).toEqual([]);

  await flaky.loginAndStartup(true); // the Login button
  expect(flaky.stayLoggedOut).toBe(false);
  expect(flaky.calls).toEqual(["login", "startup"]);
});

test("A deleted account is no longer tried", async () => {
  let deleted = new TestAccount();
  deleted.failures = Array.from({ length: 1000 }, networkDown);
  appGlobal.chatAccounts.add(deleted);
  let running = deleted.reconnectInBackground();
  await sleep(0.2);

  appGlobal.chatAccounts.remove(deleted);
  await running; // ends without an error
  let tries = deleted.calls.length;
  await sleep(0.2);
  expect(deleted.calls.length).toBe(tries);
  expect(deleted.isLoggedIn).toBe(false);
});

/** `login()` only logs in. The caller runs `syncOnStartup()`. */
class TestAccount extends ChatAccount {
  calls: string[] = [];
  loggedIn = false;
  /** Errors that the next tries to log in throw, one per try */
  failures: Error[] = [];

  get isLoggedIn(): boolean {
    return this.loggedIn;
  }

  async login(interactive: boolean) {
    this.calls.push("login");
    let failure = this.failures.shift();
    if (failure) {
      throw failure;
    }
    this.loggedIn = true;
  }

  async syncOnStartup() {
    this.calls.push("startup");
  }

  async readFromDB() {
  }
}
