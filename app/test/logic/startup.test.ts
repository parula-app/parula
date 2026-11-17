// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../logic/app";
import { ChatAccount } from "../../logic/Chat/ChatAccount";
import { ComputerOn } from "../../logic/util/backend-wrapper";
import { loginOnStartup } from "../../logic/startup";
import { sleep } from "../../logic/util/util";
import { k1MinuteMS } from "../../logic/util/date";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

let remote: TestAccount;
let dependent: TestAccount;
let local: TestAccount;
let errors: Error[] = [];

// One `loginOnStartup()` for the whole file: it subscribes to the wake-up, too
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }); // only the 5 minutes retry interval
  // There is no backend process here, so `checkWakeUp()` cannot get the real one
  appGlobal.remoteApp = { computerOn: new ComputerOn() } as any;
  remote = new TestAccount();
  dependent = new TestAccount(); // like a shared mailbox
  dependent.mainAccount = remote;
  local = new TestAccount();
  local.loggedIn = true; // like the local calendar, which is always logged in
  appGlobal.chatAccounts.addAll([remote, dependent, local]);
  loginOnStartup(ex => errors.push(ex));
  await sleep(0.1);
  remote.errorCallback = dependent.errorCallback = local.errorCallback = ex => errors.push(ex);
});

afterAll(() => {
  vi.useRealTimers();
});

test("The app start logs in, then starts up, once", async () => {
  expect(errors).toEqual([]);
  expect(remote.calls).toEqual(["login", "startup"]);
  expect(local.calls).toEqual(["login", "startup"]);
  expect(dependent.calls).toEqual(["startup"]); // by its main account
});

test("When the network comes back, only the accounts that are logged out start again", async () => {
  remote.loggedIn = false; // the connection died while we slept

  window.dispatchEvent(new Event("online"));
  await sleep(0.1);

  expect(errors).toEqual([]);
  expect(remote.calls).toEqual(["login", "startup", "login", "startup"]);
  expect(local.calls).toEqual(["login", "startup"]);
  expect(dependent.calls).toEqual(["startup", "startup"]);
});

test("The Login button of a shared mailbox logs in the main account, which starts up both", async () => {
  await dependent.loginAndStartup(true);
  await sleep(0.01); // `startupDependentAccounts()` does not wait for them

  expect(errors).toEqual([]);
  expect(remote.calls).toEqual(["login", "startup", "login", "startup", "login", "startup"]);
  expect(dependent.calls).toEqual(["startup", "startup", "startup"]);
});

test("While the server can't be reached, e.g. the VPN isn't up yet, we try again every 5 minutes", async () => {
  let unreachable = Object.assign(new Error("getaddrinfo ENOTFOUND imap.example.com"), { code: "ENOTFOUND" });
  remote.loggedIn = false;
  remote.loginErrors = [unreachable, unreachable, unreachable];
  remote.errorCallback = ex => remote.errors.add(ex); // like the app
  remote.calls = [];

  window.dispatchEvent(new Event("online"));
  await sleep(0.5); // 2 quick tries, 4 s * `waitTime.factor` apart
  expect(remote.calls).toEqual(["login", "login"]);
  await vi.advanceTimersByTimeAsync(5 * k1MinuteMS);
  await sleep(0.1);
  expect(remote.calls).toEqual(["login", "login", "login"]);
  await vi.advanceTimersByTimeAsync(5 * k1MinuteMS);
  await sleep(0.1);
  expect(remote.calls).toEqual(["login", "login", "login", "login", "startup"]);

  await vi.advanceTimersByTimeAsync(5 * k1MinuteMS); // logged in: no more tries
  await sleep(0.1);
  expect(remote.calls).toEqual(["login", "login", "login", "login", "startup"]);
});

test("After a wrong password, we don't try again", async () => {
  remote.loggedIn = false;
  remote.loginErrors = [new Error("Check your login, username, and password.")];
  remote.calls = [];

  window.dispatchEvent(new Event("online"));
  await sleep(0.1);
  await vi.advanceTimersByTimeAsync(10 * k1MinuteMS);
  await sleep(0.1);

  expect(remote.calls).toEqual(["login"]);
  expect(remote.loggedIn).toBe(false);
});

/** `login()` only logs in. The caller runs `syncOnStartup()`. */
class TestAccount extends ChatAccount {
  calls: string[] = [];
  loggedIn = false;
  /** `login()` throws these first */
  loginErrors: Error[] = [];

  get isLoggedIn(): boolean {
    return this.loggedIn;
  }

  async login(interactive: boolean) {
    this.calls.push("login");
    await super.login(interactive); // clears the errors
    let ex = this.loginErrors.shift();
    if (ex) {
      throw ex;
    }
    this.loggedIn = true;
  }

  async syncOnStartup() {
    this.calls.push("startup");
    await this.startupDependentAccounts();
  }

  async readFromDB() {
  }
}
