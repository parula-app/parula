// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { EMail } from "../../../logic/Mail/EMail";
import { mailMustangApp } from "../../../frontend/Mail/MailMustangApp";
import ComposerWindow from "../../../frontend/Mail/Composer/ComposerWindow.svelte";
import { AppWindow } from "../../../frontend/MainWindow/AppWindow";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  getLocalStorage("mail.send.newWindow", false).value = false;
  mailMustangApp.subApps.clear();
  vi.restoreAllMocks();
});

test("With the setting, the main window opens the composer in a new window", () => {
  let open = vi.spyOn(AppWindow.prototype, "open").mockImplementation(async () => null);
  let mail = new EMail(null);
  mailMustangApp.writeMail(mail);
  expect(open).not.toHaveBeenCalled();
  expect(mailMustangApp.subApps.hasItems).toBe(true);

  mailMustangApp.subApps.clear();
  getLocalStorage("mail.send.newWindow", false).value = true;
  mailMustangApp.writeMail(mail);
  expect(open).toHaveBeenCalledWith(ComposerWindow, { mail }, 1000);
  expect(mailMustangApp.subApps.hasItems).toBe(false);
});
