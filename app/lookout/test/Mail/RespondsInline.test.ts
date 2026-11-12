// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import type { EMail } from "../../../logic/Mail/EMail";
import { MessageActions } from "../../Mail/MessageActions";
import ComposerWindow from "../../Mail/Composer/ComposerWindow.svelte";
import { selectedMessage, selectedMessages } from "../../../frontend/Mail/Selected";
import { selectedApp } from "../../../frontend/AppsBar/selectedApp";
import { mailMustangApp } from "../../../frontend/Mail/MailMustangApp";
import { AppWindow } from "../../../frontend/MainWindow/AppWindow";
import { ArrayColl } from "svelte-collections";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  AppWindow["acting"] = null;
  vi.restoreAllMocks();
});

/** Stands in for the email window. `acting` is what `AppWindow.current()` returns first. */
class EMailWindow extends AppWindow {
  constructor() {
    super(window, "email", AppWindow.main);
  }
}

test("Replies are inline in the main window, but not in the window of a single email", () => {
  let message = { subject: "Shown" } as EMail;
  selectedApp.set(mailMustangApp);
  selectedMessage.set(message);
  selectedMessages.set(new ArrayColl([message]));
  expect(MessageActions.respondsInline(message)).toBe(true);

  let emailWindow = new EMailWindow();
  emailWindow.uiState(selectedMessage).set(message);
  emailWindow.uiState(selectedMessages).set(new ArrayColl([message]));
  AppWindow["acting"] = emailWindow;
  expect(MessageActions.respondsInline(message)).toBe(false);
});

test("A reply in the window of a single email opens Lookout's composer in a new window", async () => {
  let open = vi.spyOn(AppWindow.prototype, "open").mockImplementation(async () => null);
  let writeMail = vi.spyOn(mailMustangApp, "writeMail").mockImplementation(() => {});
  let message = { subject: "Shown" } as EMail;
  let reply = { subject: "Re: Shown" } as EMail;
  AppWindow["acting"] = new EMailWindow();
  await MessageActions.respond(message, reply);
  expect(open).toHaveBeenCalledWith(ComposerWindow, { mail: reply }, 1000);
  expect(writeMail).not.toHaveBeenCalled();
});
