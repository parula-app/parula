// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { newTestEMail, setUpAccount } from "./TestMailAccount";
import { CreateMIME } from "../../../logic/Mail/SMTP/CreateMIME";
import { expect, test } from "vitest";

test("The MIME of a composed email carries our Message-ID", async () => {
  let account = setUpAccount();
  let mail = newTestEMail(account);
  mail.text = "Draft";

  let nmMail = await CreateMIME.getNMMail(mail);

  // Saved drafts are found again by it, see `ComposeActions.getDrafts()`
  expect(mail.messageID).toBeTruthy();
  expect(nmMail.messageId).toBe(mail.messageID);
});
