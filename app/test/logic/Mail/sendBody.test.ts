// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { newTestEMail, setUpAccount } from "./TestMailAccount";
import { CreateMIME } from "../../../logic/Mail/SMTP/CreateMIME";
import { gLicense } from "../../../logic/util/License";
import { beforeAll, expect, test } from "vitest";

/* Licensed, so that `send()` adds no Parula footer: that HTML hides the bug. */
beforeAll(() => gLicense.license = { valid: true });

test("A plaintext-only mail keeps its body, e.g. a quick reply from a notification", async () => {
  let account = setUpAccount();
  let mail = newTestEMail(account);
  mail.html = null;
  mail.text = "Sounds good, see you there";

  let sent = mail.compose.send();
  await account.atServer;
  account.serverAccepts();
  await sent;

  expect(mail.text).toBe("Sounds good, see you there");
  let nmMail = await CreateMIME.getNMMail(mail);
  expect(nmMail.text).toBe("Sounds good, see you there");
});
