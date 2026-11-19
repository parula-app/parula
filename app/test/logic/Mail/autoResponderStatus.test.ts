// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import { AutoResponder } from "../../../logic/Mail/AutoResponder";
import { expect, test } from "vitest";

appGlobal.remoteApp = {} as any;

class TestAutoResponder extends AutoResponder {
  loaded = 0;
  fail = false;

  get supported() {
    return true;
  }

  async load() {
    this.loaded++;
    if (this.fail) {
      throw new Error("Server down");
    }
  }
}

class TestMailAccount extends MailAccount {
  loggedIn = true;

  get isLoggedIn() {
    return this.loggedIn;
  }

  newAutoResponder() {
    return new TestAutoResponder(this);
  }
}

function newAutoResponder(isOn: boolean, scheduled: boolean): AutoResponder {
  let autoResponder = new AutoResponder(new MailAccount());
  autoResponder.isOn = isOn;
  autoResponder.scheduled = scheduled;
  autoResponder.startTime = new Date(2026, 6, 1, 17, 0);
  autoResponder.endTime = new Date(2026, 6, 15, 8, 0);
  return autoResponder;
}

test("Replying now: when on, and with a time range only within it", () => {
  let during = new Date(2026, 6, 10, 12, 0);
  expect(newAutoResponder(false, false).isReplyingNow(during)).toBe(false);
  expect(newAutoResponder(false, true).isReplyingNow(during)).toBe(false);
  expect(newAutoResponder(true, false).isReplyingNow(new Date(2026, 0, 1))).toBe(true);
  let scheduled = newAutoResponder(true, true);
  expect(scheduled.isReplyingNow(during)).toBe(true);
  expect(scheduled.isReplyingNow(new Date(2026, 6, 1, 16, 59))).toBe(false);
  expect(scheduled.isReplyingNow(new Date(2026, 6, 1, 17, 0))).toBe(true);
  expect(scheduled.isReplyingNow(new Date(2026, 6, 15, 8, 0))).toBe(false);
});

test("Loads the state only for logged-in accounts that support it", async () => {
  let account = new TestMailAccount();
  account.loggedIn = false;
  let autoResponder = account.autoResponder as TestAutoResponder;
  await autoResponder.loadForStatus();
  expect(autoResponder.loaded).toBe(0);

  account.loggedIn = true;
  await autoResponder.loadForStatus();
  expect(autoResponder.loaded).toBe(1);

  await new MailAccount().autoResponder.loadForStatus(); // `supported` is false
});

test("Loads the state only once, also when asked again while it loads", async () => {
  let autoResponder = new TestMailAccount().autoResponder as TestAutoResponder;
  await Promise.all([autoResponder.loadForStatus(), autoResponder.loadForStatus()]);
  await autoResponder.loadForStatus();
  expect(autoResponder.loaded).toBe(1);
});

test("Loads the state again after an error", async () => {
  let autoResponder = new TestMailAccount().autoResponder as TestAutoResponder;
  autoResponder.fail = true;
  await expect(autoResponder.loadForStatus()).rejects.toThrow("Server down");
  autoResponder.fail = false;
  await autoResponder.loadForStatus();
  expect(autoResponder.loaded).toBe(2);
});
