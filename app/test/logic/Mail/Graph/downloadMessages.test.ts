// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { GraphAccount } from "../../../../logic/Mail/Graph/GraphAccount";
import { GraphFolder } from "../../../../logic/Mail/Graph/GraphFolder";
import type { GraphEMail } from "../../../../logic/Mail/Graph/GraphEMail";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

/** Microsoft Graph, Outlook service limits: "Four concurrent requests" per app and mailbox
 * <https://learn.microsoft.com/en-us/graph/throttling-limits#outlook-service-limits> */
const kServerMaxConcurrent = 4;

function newFolder(): GraphFolder {
  appGlobal.remoteApp = { kyCreate: () => null } as any;
  let account = new GraphAccount();
  account.errorCallback = ex => { throw ex };
  return new GraphFolder(account);
}

/** Messages whose download takes a moment, and counts how many run in parallel */
function messages(count: number, counter: { running: number, max: number }): ArrayColl<GraphEMail> {
  return new ArrayColl(Array.from({ length: count }, () => ({
    downloadRunOnce: { running: false },
    async download() {
      counter.max = Math.max(counter.max, ++counter.running);
      await new Promise(resolve => setTimeout(resolve, 1));
      counter.running--;
    },
  }) as any as GraphEMail));
}

test("Downloads several messages at once, but leaves a request for the email that the user clicks on", async () => {
  let counter = { running: 0, max: 0 };
  let folder = newFolder();
  let msgs = messages(20, counter);

  let downloaded = await folder.downloadMessages(msgs);

  expect(downloaded.length).toBe(msgs.length);
  expect(counter.max).toBeGreaterThanOrEqual(2);
  expect(counter.max).toBeLessThan(kServerMaxConcurrent);
});
