import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { saveConfig } from "../../../../logic/Mail/AutoConfig/saveConfig";
import { expect, test } from "vitest";

/** A username instead of the email address, as seen in the error log (PARULA-146).
 * The account saved fine and then failed to load on the next start. */
test("Setup refuses a username as email address", async () => {
  let config = new MailAccount();
  let accountsBefore = appGlobal.emailAccounts.length;

  await expect(saveConfig(config, "somebody", "pw")).rejects.toThrow();

  expect(config.emailAddress).toBeFalsy();
  expect(appGlobal.emailAccounts.length).toBe(accountsBefore);
});

test("Setup refuses an empty email address", async () => {
  let config = new MailAccount();

  await expect(saveConfig(config, "", "pw")).rejects.toThrow();
});
