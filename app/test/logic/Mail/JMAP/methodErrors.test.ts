import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPCommandError } from "../../../../logic/Mail/JMAP/JMAPError";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

/** Answers each call with the given method-level error, as Stalwart does */
function newAccount(error: Record<string, any>): JMAPAccount {
  appGlobal.remoteApp = { kyCreate: () => null } as any;
  let account = new JMAPAccount();
  account.accountID = "q";
  account.session = {
    capabilities: {},
    accounts: { q: { accountCapabilities: {} } },
    apiUrl: "https://example.com/jmap/",
    state: "d1655760",
  } as any as TJMAPSession;
  account.httpPost = async (url: string, request: any) => ({
    methodResponses: request.methodCalls.map(([, , id]) => ["error", error, id]),
    sessionState: "d1655760",
  });
  return account;
}

test("A method error names the method, the error type and the server's description", async () => {
  let account = newAccount({ type: "forbidden", description: "You do not have access to account zz" });

  let promise = account.makeSingleCall("Mailbox/get", { accountId: "zz" });

  await expect(promise).rejects.toThrow("You do not have access to account zz");
  await expect(promise).rejects.toThrow("Mailbox/get");
  await expect(promise).rejects.toThrow("forbidden");
  await expect(promise).rejects.toBeInstanceOf(JMAPCommandError);
  await expect(promise).rejects.toHaveProperty("code", "forbidden");
});

test("A method error without description still says what failed", async () => {
  let account = newAccount({ type: "invalidArguments" });

  let promise = account.makeSingleCall("Email/query", { accountId: "q" });

  await expect(promise).rejects.toThrow("Email/query");
  await expect(promise).rejects.toThrow("invalidArguments");
  await expect(promise).rejects.toHaveProperty("code", "invalidArguments");
});

test("Callers still recognize the error type", async () => {
  let account = newAccount({ type: "cannotCalculateChanges" });

  try {
    await account.makeCombinedCall([["Email/changes", { accountId: "q", sinceState: "s1" }, "changes"]]);
    expect.unreachable();
  } catch (ex) {
    expect(ex.code).toBe("cannotCalculateChanges");
  }
});
