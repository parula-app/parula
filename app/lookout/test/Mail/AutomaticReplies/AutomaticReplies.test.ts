// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { AutoResponder } from "../../../../logic/Mail/AutoResponder";
import { isReplyingNow, loadAutomaticReplies } from "../../../Mail/AutomaticReplies/AutomaticReplies";
import { expect, test } from "vitest";

appGlobal.remoteApp = {} as any;

class TestAutoResponder extends AutoResponder {
  loaded = 0;

  get supported() {
    return true;
  }

  async load() {
    this.loaded++;
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
  expect(isReplyingNow(newAutoResponder(false, false), during)).toBe(false);
  expect(isReplyingNow(newAutoResponder(false, true), during)).toBe(false);
  expect(isReplyingNow(newAutoResponder(true, false), new Date(2026, 0, 1))).toBe(true);
  let scheduled = newAutoResponder(true, true);
  expect(isReplyingNow(scheduled, during)).toBe(true);
  expect(isReplyingNow(scheduled, new Date(2026, 6, 1, 16, 59))).toBe(false);
  expect(isReplyingNow(scheduled, new Date(2026, 6, 1, 17, 0))).toBe(true);
  expect(isReplyingNow(scheduled, new Date(2026, 6, 15, 8, 0))).toBe(false);
});

test("Loads the state only for logged-in accounts that support it", async () => {
  let account = new TestMailAccount();
  account.loggedIn = false;
  await loadAutomaticReplies(account);
  let autoResponder = account.autoResponder as TestAutoResponder;
  expect(autoResponder.loaded).toBe(0);

  account.loggedIn = true;
  await loadAutomaticReplies(account);
  expect(autoResponder.loaded).toBe(1);

  await loadAutomaticReplies(new MailAccount()); // `supported` is false
  await loadAutomaticReplies(null);
});
