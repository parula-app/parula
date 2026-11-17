import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPEMail } from "../../../../logic/Mail/JMAP/JMAPEMail";
import { JMAPFolder } from "../../../../logic/Mail/JMAP/JMAPFolder";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => null } as any;

const kMIME = "Subject: Hello\r\n\r\nWorld\r\n";

function httpError(name: string, httpCode?: number): Error {
  let ex = new Error(`Download failed: ${name} ${httpCode ?? ""}`);
  Object.assign(ex, { name, httpCode });
  return ex;
}

/** A message whose blob download fails with `failWith`, `failures` times, and then succeeds */
function newEMail(failWith: Error, failures: number): { email: JMAPEMail, attempts: () => number } {
  let account = new JMAPAccount();
  account.accountID = "u1";
  account.session = {
    capabilities: {},
    downloadUrl: "https://example.com/jmap/download/{accountId}/{blobId}/{name}?accept={type}",
  } as any as TJMAPSession;
  let attempts = 0;
  account.httpGet = async () => {
    if (++attempts <= failures) {
      throw failWith;
    }
    return new Blob([kMIME]);
  };
  let email = new JMAPEMail(new JMAPFolder(account));
  email.mimeBlobId = "blob1";
  email.saveCompleteMessage = async () => { };
  return { email, attempts: () => attempts };
}

test("A rate-limited download is fetched again", async () => {
  let { email, attempts } = newEMail(httpError("HTTPError", 429), 1);

  await email.download();

  expect(attempts()).toBe(2);
  expect(email.subject).toBe("Hello");
});

test("A download that timed out is fetched again", async () => {
  let { email, attempts } = newEMail(httpError("TimeoutError"), 1);

  await email.download();

  expect(attempts()).toBe(2);
});

test("A real error is reported, not retried", async () => {
  let { email, attempts } = newEMail(httpError("HTTPError", 404), 1);

  await expect(email.download()).rejects.toThrow();

  expect(attempts()).toBe(1);
});
