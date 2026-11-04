// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { ActiveSyncAccount, type ActiveSyncPingable } from "../../../../logic/Mail/ActiveSync/ActiveSyncAccount";
import { waitTime } from "../../../../logic/util/util";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

/** Answers the Ping requests with `responses`, in order. An `Error` fails the request. */
class TestActiveSyncAccount extends ActiveSyncAccount {
  responses: any[] = [];
  pings = 0;
  readonly errors: Error[] = [];

  async callEAS(command: string): Promise<any> {
    if (command != "Ping") {
      throw new Error("Unexpected command " + command);
    }
    this.pings++;
    let response = this.responses.shift();
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }
}

function newTestAccount(responses: any[]): TestActiveSyncAccount {
  let account = new TestActiveSyncAccount();
  account.name = "Test";
  account.emailAddress = "test@example.com";
  account.responses = responses;
  account.errorCallback = ex => account.errors.push(ex);
  return account;
}

/** The inbox, which leaves the Ping loop once the server reported a change */
function newInbox(account: TestActiveSyncAccount): ActiveSyncPingable & { changes: number } {
  let inbox = {
    serverID: "inbox",
    folderClass: "Email" as const,
    changes: 0,
    async ping() {
      inbox.changes++;
      account.removePingable(inbox);
    },
  };
  return inbox;
}

/** Ping status 2: The folders changed */
const kChanged = { Status: "2", Folders: { Folder: "inbox" } };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  waitTime.factor = 1; // fake timers don't wait anyway, and the tests check the real intervals
});

afterEach(() => {
  vi.useRealTimers();
});

test("ActiveSync: When the server isn't reachable yet, e.g. a late VPN, we try again every 10 s until it is", async () => {
  let unreachable = new TypeError("Failed to fetch");
  let account = newTestAccount([unreachable, unreachable, unreachable, kChanged]);
  let inbox = newInbox(account);

  account.addPingable(inbox);
  await vi.advanceTimersByTimeAsync(5 * 1000);
  expect(account.pings).toBe(2);
  await vi.advanceTimersByTimeAsync(20 * 1000);

  expect(account.pings).toBe(4);
  expect(inbox.changes).toBe(1);
  expect(account.errors).toEqual([]);
});

test("ActiveSync: After an error that won't go away by itself, we stop pinging", async () => {
  let account = newTestAccount([new Error("Something unexpected"), kChanged]);
  let inbox = newInbox(account);

  account.addPingable(inbox);
  await vi.advanceTimersByTimeAsync(60 * 1000);

  expect(account.pings).toBe(1);
  expect(account.errors.map(ex => ex.message)).toEqual(["Something unexpected"]);
});
