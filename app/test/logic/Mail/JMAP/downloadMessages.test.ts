import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPFolder } from "../../../../logic/Mail/JMAP/JMAPFolder";
import type { JMAPEMail } from "../../../../logic/Mail/JMAP/JMAPEMail";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => null } as any;

/** Stalwart's default. It answers one request too many with HTTP 400 `maxConcurrentRequests`. */
const kServerMax = 4;

function newFolder(serverMax: number | undefined): JMAPFolder {
  let account = new JMAPAccount();
  account.accountID = "u1";
  account.session = {
    capabilities: {
      "urn:ietf:params:jmap:core": serverMax === undefined ? {} : { maxConcurrentRequests: serverMax },
    },
  } as any as TJMAPSession;
  account.errorCallback = ex => { throw ex };
  return new JMAPFolder(account);
}

/** Messages whose download takes a moment, and counts how many run in parallel */
function messages(count: number, counter: { running: number, max: number }): ArrayColl<JMAPEMail> {
  return new ArrayColl(Array.from({ length: count }, () => ({
    downloadRunOnce: { running: false },
    async download() {
      counter.max = Math.max(counter.max, ++counter.running);
      await new Promise(resolve => setTimeout(resolve, 1));
      counter.running--;
    },
  }) as any as JMAPEMail));
}

test("Downloads no more messages at once than the server allows", async () => {
  let counter = { running: 0, max: 0 };
  let folder = newFolder(kServerMax);

  await folder.downloadMessages(messages(20, counter));

  expect(counter.max).toBe(kServerMax - 1);
});

test("A server that allows only one request at a time still downloads", async () => {
  let counter = { running: 0, max: 0 };
  let folder = newFolder(1);
  let msgs = messages(5, counter);

  let downloaded = await folder.downloadMessages(msgs);

  expect(counter.max).toBe(1);
  expect(downloaded.length).toBe(msgs.length);
});

test("A server without a limit gets several messages at once", async () => {
  let counter = { running: 0, max: 0 };
  let folder = newFolder(undefined);

  await folder.downloadMessages(messages(20, counter));

  expect(counter.max).toBe(5);
});
