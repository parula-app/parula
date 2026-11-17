// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { SMTPAccount } from "../../../../logic/Mail/SMTP/SMTPAccount";
import { errorsForServer } from "../../../../logic/util/error";
import { notifications } from "../../../../logic/util/Notification";
import { expect, test, vi } from "vitest";

test("An SMTP account that lost its IMAP account is an internal error, which is logged to the server", () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  let smtp = new SMTPAccount();
  smtp.hostname = "smtp.example.com";

  smtp.mainAccount = null;

  expect(smtp.mainAccount).toBeNull();
  expect(errorsForServer.contents.map(ex => ex.message)).toEqual(["SMTP account smtp.example.com lost its IMAP account"]);
  expect(notifications.isEmpty).toBe(true);
});
