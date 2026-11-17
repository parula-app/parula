// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { Account } from "../../../logic/Abstract/Account";
import { accountColors } from "../../../logic/Abstract/Workspace";
import { Calendar } from "../../../logic/Calendar/Calendar";
import { sleep } from "../../../logic/util/util";
import { SetColl } from "svelte-collections";
import { expect, test } from "vitest";

test("Starting the dependent accounts again does not start them twice", async () => {
  let mainAccount = new TestAccount();
  let calendar = new TestCalendar();
  calendar.mainAccount = mainAccount;
  appGlobal.calendars.add(calendar);
  try {
    await mainAccount.startDependents();
    await mainAccount.startDependents(); // e.g. logged in again
    expect(calendar.startupCount).toBe(1);

    calendar.finishStartup();
    await sleep(0);
    await mainAccount.startDependents();
    expect(calendar.startupCount).toBe(2);
  } finally {
    calendar.finishStartup();
    appGlobal.calendars.remove(calendar);
  }
});

test("A calendar starts up the calendars that depend on it, e.g. the other calendars of a CalDAV account", async () => {
  let mainCalendar = new TestMainCalendar();
  let subCalendar = new TestCalendar();
  subCalendar.mainAccount = mainCalendar;
  appGlobal.calendars.addAll([mainCalendar, subCalendar]);
  try {
    await mainCalendar.syncOnStartup();
    expect(subCalendar.startupCount).toBe(1);
  } finally {
    subCalendar.finishStartup();
    appGlobal.calendars.clear();
  }
});

test("Each new account gets a color that no other account has", () => {
  let colors = new SetColl<string>();
  try {
    for (let i = 0; i < accountColors.length; i++) {
      let calendar = new Calendar();
      appGlobal.calendars.add(calendar);
      colors.add(calendar.color);
    }
    expect(colors.length).toBe(accountColors.length);
  } finally {
    appGlobal.calendars.clear();
  }
});

class TestAccount extends Account {
  async startDependents() {
    await this.startupDependentAccounts();
  }
}

/** Runs the real `Calendar.syncOnStartup()`, without a server */
class TestMainCalendar extends Calendar {
  async listEvents() {
  }
}

/** Its startup runs until `finishStartup()` is called */
class TestCalendar extends Calendar {
  startupCount = 0;
  finishStartup: () => void = () => undefined;

  async syncOnStartup() {
    this.startupCount++;
    await new Promise<void>(resolve => this.finishStartup = resolve);
  }
}
