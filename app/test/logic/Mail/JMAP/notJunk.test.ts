import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { TJMAPMethodResponse, TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => null } as any;

/** Collects the keyword patches, and answers like Stalwart */
function newEMail() {
  let account = new JMAPAccount();
  account.accountID = "e";
  account.session = { capabilities: {}, accounts: {}, primaryAccounts: {} } as any as TJMAPSession;
  let keywords: Record<string, boolean | null> = {};
  account.makeCalls = async (requests: [string, Record<string, any>, string?][]) => requests.map(([method, args, callID]) => {
    Object.assign(keywords, args.update.eaaaaab);
    return [method, { accountId: "e", oldState: "spi", newState: "spm", updated: { eaaaaab: null } }, callID] as TJMAPMethodResponse;
  });
  let folder = account.newFolder();
  folder.id = "a";
  let email = folder.newEMail();
  email.jmapID = "eaaaaab";
  return { email, keywords };
}

test("Marking an email as not spam tells the server's spam filter", async () => {
  let { email, keywords } = newEMail();

  await email.markSpam(false);

  expect(keywords).toEqual({ "keywords/$junk": null, "keywords/$notjunk": true });
});

test("Marking an email as spam tells the server's spam filter", async () => {
  let { email, keywords } = newEMail();

  await email.markSpam(true);

  expect(keywords).toEqual({ "keywords/$junk": true, "keywords/$notjunk": null });
});
