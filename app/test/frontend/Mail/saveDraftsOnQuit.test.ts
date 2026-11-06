// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { mailMustangApp, WriteMailMustangApp, LoginDialogMustangApp } from "../../../frontend/Mail/MailMustangApp";
import { ComposeActions } from "../../../logic/Mail/ComposeActions";
import type { EMail } from "../../../logic/Mail/EMail";
import { ArrayColl } from "svelte-collections";
import { beforeEach, expect, test, vi } from "vitest";

const kLongText = "<p>" + "This is what I want to say about it. ".repeat(4) + "</p>";

/** A mail that the user is writing. `saveDraftOnQuit()` is what `ComposeActions` does. */
function draft(html: string, saveDraftOnQuit = async () => {}): EMail {
  let mail = { html } as unknown as EMail;
  let compose = new ComposeActions(mail);
  compose.saveDraftOnQuit = vi.fn(saveDraftOnQuit);
  return Object.assign(mail, { compose });
}

/** What `mailMustangApp.writeMail()` does */
function openComposer(mail: EMail) {
  let composer = new WriteMailMustangApp();
  composer.windowParams = { mail };
  mailMustangApp.subApps.add(composer);
}

beforeEach(() => {
  mailMustangApp.subApps.clear();
  mailMustangApp.inlineDrafts = new ArrayColl<EMail>();
});

test("Quitting saves the mails in the open composers that have text of the user", async () => {
  let written = draft(kLongText);
  let onlyQuote = draft("<p></p><blockquote>" + kLongText + "</blockquote>");
  openComposer(written);
  openComposer(onlyQuote);
  mailMustangApp.subApps.add(new LoginDialogMustangApp());
  await mailMustangApp.saveDraftsOnQuit();
  expect(written.compose.saveDraftOnQuit).toHaveBeenCalledTimes(1);
  expect(onlyQuote.compose.saveDraftOnQuit).not.toHaveBeenCalled();
});

test("Quitting saves the mails that the user writes outside of a composer", async () => {
  let inline = draft(kLongText);
  mailMustangApp.inlineDrafts = new ArrayColl([inline]);
  await mailMustangApp.saveDraftsOnQuit();
  expect(inline.compose.saveDraftOnQuit).toHaveBeenCalledTimes(1);
});

test("Quitting fails when a mail can't be saved, and the other mails are still saved", async () => {
  let failing = draft(kLongText, async () => {
    throw new Error("No space left on device");
  });
  let other = draft(kLongText);
  openComposer(failing);
  openComposer(other);
  await expect(mailMustangApp.saveDraftsOnQuit()).rejects.toThrow("No space left");
  expect(other.compose.saveDraftOnQuit).toHaveBeenCalledTimes(1);
});
