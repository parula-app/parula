// @vitest-environment happy-dom
import { newTestAddon, newTestMails, waitFor, contextOf, type TestSandbox } from "./testSandbox";
import { addonUIItems } from "../../../logic/Addons/AddonUI";
import { tick } from "../../logic/Addons/Bridge/fixtures";
import MessageToolbarHarness from "../Mail/Message/MessageToolbarHarness.svelte";
import ButtonsHarness from "./ButtonsHarness.svelte";
import PanelsHarness from "./PanelsHarness.svelte";
import AddonMenuItems from "../../../frontend/Addons/AddonMenuItems.svelte";
import WordCount from "../../../../addons/examples/word-count/src/Count.svelte";
import SenderPanel from "../../../../addons/examples/sender-panel/src/Sender.svelte";
import { findOrCreatePersonUID } from "../../../logic/Abstract/PersonUID";
import { flushSync, mount, unmount } from "svelte";
import { writable } from "svelte/store";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

const shownErrors: Error[] = [];
vi.mock("../../../frontend/Util/error", async importOriginal => ({
  ...await importOriginal<object>(),
  showError: (ex: Error) => shownErrors.push(ex),
}));

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // Chromium has it, happy-dom not
  CSSStyleDeclaration.prototype[Symbol.iterator] ??= function* () {
    for (let i = 0; i < this.length; i++) {
      yield this.item(i);
    }
  };
});

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (let cleanup of cleanups.splice(0)) {
    cleanup();
  }
  shownErrors.length = 0;
});

async function addon(ui: any, permissions?: string[]): Promise<TestSandbox> {
  let sandbox = await newTestAddon(ui, permissions);
  cleanups.push(() => sandbox.stop());
  return sandbox;
}

function show(component: any, props: any): HTMLElement {
  let target = document.createElement("div");
  document.body.append(target);
  let app = mount(component, { target, props });
  cleanups.unshift(() => {
    unmount(app);
    target.remove();
  });
  flushSync();
  return target;
}

async function update(): Promise<void> {
  flushSync();
  await tick(10);
  flushSync();
}

function buttonWithTitle(target: HTMLElement, title: string): HTMLButtonElement | undefined {
  return [...target.querySelectorAll("button")].find(button => button.title == title);
}

/** Registers a command handler in the addon's main code, which keeps what it got */
async function onCommand(sandbox: TestSandbox, command: string, wait?: Promise<void>): Promise<any[][]> {
  let calls: any[][] = [];
  sandbox.logic.mustang.ui.onCommand(command, async ({ messages }) => {
    calls.push(messages);
    await wait;
  });
  await waitFor(() => sandbox.ui.commands.contains(command));
  return calls;
}

/** The addon reads the text via the bridge: works only while it may use the message */
async function canRead(message: any): Promise<boolean> {
  try {
    await message.text;
    return true;
  } catch (ex) {
    return false;
  }
}

describe("Toolbar", () => {
  test("The button shows the label as text", async () => {
    await addon({ "message-toolbar": [{ id: "b", label: "<b>Count</b> words", command: "count" }] });
    let mails = newTestMails();
    let target = show(MessageToolbarHarness, { message: writable(mails[0]) });
    let button = buttonWithTitle(target, "<b>Count</b> words");
    expect(button).toBeDefined();
    expect(target.querySelector("b")).toBeNull();
  });

  test("Labels longer than 40 characters, or with control characters, are refused", async () => {
    await expect(newTestAddon({ "message-toolbar": [{ id: "b", label: "W".repeat(41), command: "count" }] })).rejects.toThrow();
    await expect(newTestAddon({ "message-toolbar": [{ id: "b", label: "Count\u202Ewords", command: "count" }] })).rejects.toThrow();
    expect(addonUIItems.length).toBe(0);
  });

  test("A click gives the addon the message, until the toolbar shows another message", async () => {
    let sandbox = await addon({ "message-toolbar": [{ id: "b", label: "Count words", command: "count" }] });
    let calls = await onCommand(sandbox, "count");
    let mails = newTestMails();
    let selected = writable(mails[0]);
    let target = show(MessageToolbarHarness, { message: selected });

    buttonWithTitle(target, "Count words").click();
    await waitFor(() => calls.length == 1);
    let [message] = calls[0];
    expect(calls[0].length).toBe(1);
    expect(message.subject).toBe("Test 0");
    expect(await message.text).toBe("Message number 0");

    selected.set(mails[1]);
    await update();
    expect(await canRead(message)).toBe(false);

    buttonWithTitle(target, "Count words").click();
    await waitFor(() => calls.length == 2);
    expect(calls[1][0].subject).toBe("Test 1");
    expect(await canRead(calls[1][0])).toBe(true);
  });

  test("The grant ends when the toolbar closes", async () => {
    let sandbox = await addon({ "message-toolbar": [{ id: "b", label: "Count words", command: "count" }] });
    let calls = await onCommand(sandbox, "count");
    let mails = newTestMails();
    let target = show(MessageToolbarHarness, { message: writable(mails[0]) });
    buttonWithTitle(target, "Count words").click();
    await waitFor(() => calls.length == 1);
    cleanups.shift()();
    await tick(10);
    expect(await canRead(calls[0][0])).toBe(false);
  });

  test("A popup gets the message, and closes when the toolbar shows another message", async () => {
    let sandbox = await addon({ "message-toolbar": [{ id: "p", label: "Show count", popup: "dist/count.js" }] });
    let mails = newTestMails();
    let selected = writable(mails[0]);
    let target = show(MessageToolbarHarness, { message: selected });

    buttonWithTitle(target, "Show count").click();
    await update();
    await waitFor(() => sandbox.uiFrames.length == 1 && !!contextOf(sandbox.uiFrames[0].client).messages);
    let { frame, client, entry } = sandbox.uiFrames[0];
    expect(entry).toBe("dist/count.js");
    let [message] = contextOf(client).messages;
    expect(message.subject).toBe("Test 0");
    expect(target.querySelector(".addon-popup")).not.toBeNull();

    selected.set(mails[1]);
    await update();
    expect(target.querySelector(".addon-popup")).toBeNull();
    expect(frame.bridge.isClosed).toBe(true);
  });

  test("A command that the main code doesn't handle shows an error, and the addon gets nothing", async () => {
    let sandbox = await addon({ "message-toolbar": [{ id: "b", label: "Count words", command: "count" }] });
    let mails = newTestMails();
    let target = show(MessageToolbarHarness, { message: writable(mails[0]) });
    buttonWithTitle(target, "Count words").click();
    await update();
    expect(shownErrors.length).toBe(1);
    expect(sandbox.logicFrame.bridge.handles.size).toBe(0);
  });
});

describe("Composer", () => {
  test("The button shows only if the addon may change the draft", async () => {
    let ui = {
      "composer-toolbar": [{ id: "c", label: "Check text", command: "check" }],
      "message-toolbar": [{ id: "m", label: "Count words", command: "count" }],
    };
    let mailOnly = await addon(ui, ["mail"]);
    let mails = newTestMails();
    let composer = show(ButtonsHarness, { place: "composer-toolbar", mail: writable(mails[0]) });
    let toolbar = show(ButtonsHarness, { place: "message-toolbar", mail: writable(mails[0]) });
    expect(buttonWithTitle(composer, "Check text")).toBeUndefined();
    expect(buttonWithTitle(toolbar, "Count words")).toBeDefined();

    mailOnly.stop();
    let compose = await addon(ui, ["mail.compose"]);
    let calls: any[] = [];
    compose.logic.mustang.ui.onCommand("check", async ({ draft }) => {
      calls.push(draft);
    });
    await waitFor(() => compose.ui.commands.contains("check"));
    await update();
    buttonWithTitle(composer, "Check text").click();
    await waitFor(() => calls.length == 1);
    calls[0].subject = "Changed by the addon";
    await waitFor(() => mails[0].subject == "Changed by the addon");
  });
});

describe("Menu", () => {
  test("The command gets all messages, and loses them when it finished", async () => {
    let sandbox = await addon({ "message-menu": [{ id: "m", label: "Count words", command: "count" }] });
    let finish: () => void;
    let calls = await onCommand(sandbox, "count", new Promise(resolve => finish = resolve));
    let mails = newTestMails(3);
    let target = show(AddonMenuItems, { messages: mails });

    buttonWithTitle(target, "Count words").click();
    await waitFor(() => calls.length == 1);
    let messages = calls[0];
    expect(messages.map(message => message.subject)).toEqual(["Test 0", "Test 1", "Test 2"]);
    expect(await canRead(messages[2])).toBe(true);

    finish();
    await waitFor(() => sandbox.logicFrame.bridge.handles.size == 0);
    expect(await canRead(messages[0])).toBe(false);
  });

  test("A popup gets all messages, lives outside of the closing menu, and closes with Escape", async () => {
    let sandbox = await addon({ "message-menu": [{ id: "m", label: "Count words", popup: "dist/count.js" }] });
    let mails = newTestMails(2);
    let target = show(AddonMenuItems, { messages: mails });

    buttonWithTitle(target, "Count words").click();
    await waitFor(() => sandbox.uiFrames.length == 1 && !!contextOf(sandbox.uiFrames[0].client).messages);
    let { frame, client } = sandbox.uiFrames[0];
    let messages = contextOf(client).messages;
    expect(messages.map(message => message.subject)).toEqual(["Test 0", "Test 1"]);
    expect(target.querySelector(".addon-popup")).toBeNull();
    expect(document.querySelector(".addon-popup")).not.toBeNull();

    frame.onEscape();
    await update();
    expect(document.querySelector(".addon-popup")).toBeNull();
    expect(frame.bridge.isClosed).toBe(true);
  });

  test("More than 1,000 messages are refused", async () => {
    let sandbox = await addon({ "message-menu": [{ id: "m", label: "Count words", command: "count" }] });
    let calls = await onCommand(sandbox, "count");
    let mails = newTestMails(1);
    let target = show(AddonMenuItems, { messages: new Array(1001).fill(mails[0]) });
    buttonWithTitle(target, "Count words").click();
    await update();
    expect(shownErrors.length).toBe(1);
    expect(calls.length).toBe(0);
  });
});

describe("Panel", () => {
  test("One frame for all messages. It gets the shown message and loses the previous one.", async () => {
    let sandbox = await addon({ "message-panel": [{ id: "p", entry: "dist/panel.js" }] });
    let mails = newTestMails(3);
    let selected = writable(mails[0]);
    show(PanelsHarness, { message: selected });
    await waitFor(() => !!sandbox.uiFrames[0] && !!contextOf(sandbox.uiFrames[0].client).message);
    let { client, entry } = sandbox.uiFrames[0];
    expect(entry).toBe("dist/panel.js");
    let first = contextOf(client).message;
    expect(first.subject).toBe("Test 0");

    for (let i = 1; i < 3; i++) {
      selected.set(mails[i]);
      await update();
      await waitFor(() => contextOf(client).message?.subject == "Test " + i);
    }
    expect(sandbox.uiFrames.length).toBe(1);
    expect(await canRead(first)).toBe(false);
    expect(await canRead(contextOf(client).message)).toBe(true);
  });

  test("Only with the permission for messages", async () => {
    let sandbox = await addon({ "message-panel": [{ id: "p", entry: "dist/panel.js" }] }, []);
    let mails = newTestMails(1);
    let target = show(PanelsHarness, { message: writable(mails[0]) });
    await update();
    expect(sandbox.ui.items.length).toBe(0);
    expect(target.querySelector(".addon-panels")).toBeNull();
    expect(sandbox.uiFrames.length).toBe(0);
  });
});

describe("Runtime", () => {
  test("Stopping the addon removes its buttons, menu items and panels at once, and starting adds them", async () => {
    let sandbox = await addon({
      "message-toolbar": [{ id: "b", label: "Count words", command: "count" }],
      "message-menu": [{ id: "m", label: "Count all words", command: "count" }],
      "message-panel": [{ id: "p", entry: "dist/panel.js" }],
    });
    let mails = newTestMails(1);
    let message = writable(mails[0]);
    let toolbar = show(MessageToolbarHarness, { message });
    let menu = show(AddonMenuItems, { messages: mails });
    let panels = show(PanelsHarness, { message });
    await update();
    expect(buttonWithTitle(toolbar, "Count words")).toBeDefined();
    expect(buttonWithTitle(menu, "Count all words")).toBeDefined();
    expect(panels.querySelector(".addon-panels")).not.toBeNull();

    sandbox.stop();
    flushSync();
    expect(buttonWithTitle(toolbar, "Count words")).toBeUndefined();
    expect(buttonWithTitle(menu, "Count all words")).toBeUndefined();
    expect(panels.querySelector(".addon-panels")).toBeNull();
    expect(addonUIItems.length).toBe(0);

    await sandbox.start();
    flushSync();
    expect(buttonWithTitle(toolbar, "Count words")).toBeDefined();
    expect(buttonWithTitle(menu, "Count all words")).toBeDefined();
    expect(panels.querySelector(".addon-panels")).not.toBeNull();
  });
});

describe("mustang.ui.onCommand", () => {
  test("Only the main code, and only commands of the manifest", async () => {
    let sandbox = await addon({
      "message-toolbar": [{ id: "b", label: "Count words", command: "count" }],
      "message-panel": [{ id: "p", entry: "dist/panel.js" }],
    });
    // `mustang.ui.onCommand()` reports errors only to the console of the addon, so call the service directly
    await expect((sandbox.logic as any).callService("ui", "onCommand", ["other"])).rejects.toThrow(/manifest/);
    let frame = await sandbox.openUIFrame(document.body, "dist/panel.js");
    let { client } = sandbox.uiFrames[0];
    await expect((client as any).callService("ui", "onCommand", ["count"])).rejects.toThrow(/main code/);
    expect(sandbox.ui.commands.contains("count")).toBe(false);
    frame.remove();
  });
});

describe("Example addons", () => {
  test("word-count counts the words of all messages of its popup", async () => {
    let sandbox = await addon({ "message-menu": [{ id: "m", label: "Count words", popup: "dist/count.js" }] });
    let mails = newTestMails(2);
    let frame = await sandbox.openUIFrame(document.body, "dist/count.js");
    frame.setContext({ messages: mails }, ["message", "mail"]);
    let target = show(WordCount, { context: sandbox.uiFrames[0].client.mustang.ui.context });
    await waitFor(() => (flushSync(), target.textContent.includes("6 words in 2 messages")));
  });

  test("sender-panel shows the sender of the shown message", async () => {
    let sandbox = await addon({ "message-panel": [{ id: "p", entry: "dist/panel.js" }] });
    let mails = newTestMails(2);
    mails[1].from = findOrCreatePersonUID("bob@example.com", "Bob");
    let frame = await sandbox.openUIFrame(document.body, "dist/panel.js");
    frame.setContext({ message: mails[0] }, ["message", "mail"]);
    let target = show(SenderPanel, { context: sandbox.uiFrames[0].client.mustang.ui.context });
    await waitFor(() => (flushSync(), target.textContent.includes("Alice")));
    expect(target.textContent).toContain("alice@example.com");

    frame.setContext({ message: mails[1] }, ["message", "mail"]);
    await waitFor(() => (flushSync(), target.textContent.includes("Bob")));
    expect(target.textContent).not.toContain("Alice");
  });
});
