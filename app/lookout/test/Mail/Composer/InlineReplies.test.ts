// @vitest-environment happy-dom
import { startInlineReply, removeInlineReply, InlineReply } from "../../../Mail/Composer/InlineReplies";
import { inlineReplies, inlineRibbon } from "../../../Mail/Selected";
import { messageBoxQuestion } from "../../../Shared/Dialog/MessageBox";
import { AppWindow } from "../../../../frontend/MainWindow/AppWindow";
import type { EMail } from "../../../../logic/Mail/EMail";
import { afterEach, expect, test } from "vitest";
import { get } from "svelte/store";

function mail(html = ""): EMail {
  return { html } as EMail;
}

const kLongText = "<p>" + "This is what I want to say about it. ".repeat(4) + "</p>";

function replyFor(original: EMail) {
  return inlineReplies.find(reply => reply.original == original) ?? null;
}

afterEach(() => {
  inlineReplies.clear();
  inlineRibbon.set(null);
});

test("A reply is kept per original message", async () => {
  let first = mail();
  let second = mail();
  let firstDraft = mail();
  let secondDraft = mail();
  await startInlineReply(first, firstDraft);
  await startInlineReply(second, secondDraft);
  expect(replyFor(first).draft).toBe(firstDraft);
  expect(replyFor(second).draft).toBe(secondDraft);
  expect(replyFor(first).isNew).toBe(true);
  expect(replyFor(mail())).toBeNull();
});

test("A new response replaces an empty one without asking", async () => {
  let original = mail();
  let reply = mail("<p>Hi</p><blockquote>" + kLongText + "</blockquote>");
  let forward = mail();
  await startInlineReply(original, reply);
  await startInlineReply(original, forward);
  expect(get(messageBoxQuestion)).toBeNull();
  expect(replyFor(original).draft).toBe(forward);
  expect(inlineReplies.length).toBe(1);
});

test("A new response asks before it replaces one with text", async () => {
  let original = mail();
  let reply = mail(kLongText);
  await startInlineReply(original, reply);

  let keep = startInlineReply(original, mail());
  get(messageBoxQuestion).answer(false);
  await keep;
  expect(replyFor(original).draft).toBe(reply);

  let forward = mail();
  let replace = startInlineReply(original, forward);
  get(messageBoxQuestion).answer(true);
  await replace;
  expect(replyFor(original).draft).toBe(forward);
});

test("Removing a reply hides its Message tab", async () => {
  let first = mail();
  let second = mail();
  await startInlineReply(mail(), first);
  await startInlineReply(mail(), second);
  inlineRibbon.set({ draft: second, editor: null, onSelectNames() {}, async onCheckNames() {}, onOpenTool() {}, onEditSignatures() {} });
  removeInlineReply(first);
  expect(get(inlineRibbon).draft).toBe(second);
  inlineReplies.add(new InlineReply(mail(), first));

  removeInlineReply(second);
  expect(get(inlineRibbon)).toBeNull();
  expect(inlineReplies.length).toBe(1);
  removeInlineReply(first);
  expect(inlineReplies.isEmpty).toBe(true);
});

test("A reply stays in the window where it was started, also when the question was answered after using another window", async () => {
  // Stands in for a second main window. `acting` is what `AppWindow.current()` returns first.
  class SecondWindow extends AppWindow {
    constructor() {
      super(window, "second");
    }
  }
  let secondWindow = new SecondWindow();
  let original = mail();
  let reply = mail(kLongText);
  let forward = mail();
  let replace: Promise<void>;
  AppWindow["acting"] = secondWindow;
  try {
    await startInlineReply(original, reply);
    replace = startInlineReply(original, forward);
  } finally {
    AppWindow["acting"] = null;
  }
  get(secondWindow.uiState(messageBoxQuestion)).answer(true);
  await replace;
  let secondReplies = secondWindow.uiState(inlineReplies);
  expect(secondReplies.length).toBe(1);
  expect(secondReplies.first.draft).toBe(forward);
  expect(inlineReplies.isEmpty).toBe(true);
});
