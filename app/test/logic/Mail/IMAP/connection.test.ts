import { appGlobal } from "../../../../logic/app";
import { IMAPAccount, ConnectionPurpose } from "../../../../logic/Mail/IMAP/IMAPAccount";
import { expect, test } from "vitest";

test("The Fetch connection outlives the poll, which is the only traffic on it", async () => {
  let options: any;
  appGlobal.remoteApp = {
    createIMAPFlowConnection: (connectionOptions: any) => {
      options = connectionOptions;
      return { id: "test", on: () => undefined, connect: async () => undefined };
    },
  } as any;
  let account = new IMAPAccount();
  account.hostname = "imap.example.com";
  account.username = "me@example.com";
  account.password = "secret";

  await account.connection(false, ConnectionPurpose.Fetch);

  expect(options.socketTimeout).toBeGreaterThan(account.pollIntervalMinutes * 60 * 1000);
});
