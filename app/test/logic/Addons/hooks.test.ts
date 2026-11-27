// @vitest-environment happy-dom
// app first, to resolve the import cycle around Addons
import { appGlobal } from "../../../logic/app";
import { Addons } from "../../../logic/Addons/Addons";
import { Addon } from "../../../logic/Addons/Addon";
import { AddonManifest } from "../../../logic/Addons/AddonManifest";
import { AddonHooks } from "../../../logic/Addons/AddonHooks";
import { AddonCancelError } from "../../../logic/Addons/AddonCancelError";
import { HookPoint, hookPoints, type Hook } from "../../../logic/Addons/API/HookPoint";
import { AddonBridge } from "../../../logic/Addons/Bridge/AddonBridge";
import { AddonAPI } from "../../../logic/Addons/Bridge/AddonAPI";
import { AddonBudget } from "../../../logic/Addons/Bridge/AddonBudget";
import { apiClasses, apiEnums } from "../../../logic/Addons/API/apiTypes";
import { ComposeActions } from "../../../logic/Mail/ComposeActions";
import type { EMail } from "../../../logic/Mail/EMail";
import { Attachment } from "../../../logic/Abstract/Attachment";
import { ContactEntry, Person } from "../../../logic/Abstract/Person";
import { UserError } from "../../../logic/util/util";
import { gLicense } from "../../../logic/util/License";
import { TestClient } from "./Bridge/fixtures";
import { newTestEMail, setUpAccount, type TestMailAccount } from "../Mail/TestMailAccount";
import { ArrayColl, MapColl } from "svelte-collections";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

const api = new AddonAPI(apiClasses, apiEnums);
const mailSend = hookPoints.get("mail.send");
// Taken before any hook exists
const originalSend = ComposeActions.prototype.send;
const originalDescriptor = Object.getOwnPropertyDescriptor(ComposeActions.prototype, "send");

/** Stands in for `AddonSandbox`: the real bridge, `AddonHooks` and sandbox runtime (`TestClient`),
 * connected by a `MessageChannel` instead of a frame, which happy-dom can't run */
class HookSandbox {
  readonly addon: Addon;
  readonly hooks: AddonHooks;
  logicFrame: { bridge: AddonBridge } | null = null;
  logic: TestClient;
  isStopped = false;

  constructor(addon: Addon) {
    this.addon = addon;
    this.hooks = new AddonHooks(this as any);
  }

  async start(): Promise<void> {
    this.addon.registrations.add(this);
    this.logicFrame = { bridge: await this.connect() };
  }

  async connect(): Promise<AddonBridge> {
    let channel = new MessageChannel();
    let bridge = new AddonBridge(channel.port1, api, this.addon.apiGroups, new AddonBudget());
    bridge.registerService("hooks", this.hooks);
    let client = new TestClient();
    client.start(channel.port2);
    bridge.start({ name: this.addon.name, version: "1.0.0" });
    await client.whenInitialized();
    this.logic ??= client;
    return bridge;
  }

  register(registration: { unregister(): void }): void {
    if (this.isStopped) {
      throw new Error("Stopped");
    }
    this.addon.registrations.add(registration);
  }

  unregister(): void {
    this.isStopped = true;
    this.logicFrame?.bridge.close();
    this.logicFrame = null;
  }
}

let running: Addon[] = [];

async function newAddon(name: string, { permissions = ["mail.compose"], hooks = ["mail.send"], granted = permissions, addons = new Addons() } = {}): Promise<HookSandbox> {
  let manifest = AddonManifest.fromJSON({
    name: "@test/" + name.toLowerCase().replaceAll(" ", "-"),
    version: "1.0.0",
    mustang: { name, permissions, main: "dist/main.js", hooks },
  }, null);
  let addon = new Addon(addons, manifest, {} as any);
  addon.grantedPermissions.addAll(granted);
  addons.installed.add(addon);
  let sandbox = new HookSandbox(addon);
  await sandbox.start();
  running.push(addon);
  return sandbox;
}

function newMail(): { mail: EMail, account: TestMailAccount } {
  let account = setUpAccount();
  let mail = newTestEMail(account);
  mail.text = "Hello";
  return { mail, account };
}

/** Sends `mail`. The server accepts it.
 * @returns the subject that the server got */
async function send(mail: EMail): Promise<{ subject: string }> {
  let account = mail.identity.account as TestMailAccount;
  let sent = mail.compose.send();
  await account.atServer;
  let atServer = { subject: mail.subject };
  account.serverAccepts();
  await sent;
  return atServer;
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !condition(); i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  expect(condition()).toBe(true);
}

/** Lets the bridge messages go back and forth */
async function messages(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

/* Licensed, so that `send()` adds no Parula footer: happy-dom can't run DOMPurify on that HTML */
beforeAll(() => gLicense.license = { valid: true });

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (let addon of running) {
    await addon.disable();
  }
  running = [];
  expect(mailSend.hooks.isEmpty).toBe(true);
  expect(ComposeActions.prototype.send).toBe(originalSend);
});

describe("Zero cost while no addon hooks", () => {
  test("The prototype has the original method, before, and after a hook was added and removed", async () => {
    expect(ComposeActions.prototype.send).toBe(originalSend);
    let sandbox = await newAddon("Checker");
    sandbox.logic.mustang.hooks.before("mail.send", () => {});
    await waitFor(() => mailSend.hooks.length == 1);
    expect(ComposeActions.prototype.send).not.toBe(originalSend);

    await sandbox.addon.disable();
    expect(ComposeActions.prototype.send).toBe(originalSend);
    expect(Object.getOwnPropertyDescriptor(ComposeActions.prototype, "send")).toEqual(originalDescriptor);
  });

  test("Two addons share one wrapper. The original comes back only when both are gone", async () => {
    let addons = new Addons();
    let first = await newAddon("First", { addons });
    let second = await newAddon("Second", { addons });
    first.logic.mustang.hooks.before("mail.send", () => {});
    await waitFor(() => mailSend.hooks.length == 1);
    let wrapper = ComposeActions.prototype.send;
    second.logic.mustang.hooks.after("mail.send", () => {});
    await waitFor(() => mailSend.hooks.length == 2);
    expect(ComposeActions.prototype.send).toBe(wrapper);

    await first.addon.disable();
    expect(ComposeActions.prototype.send).toBe(wrapper);
    await second.addon.disable();
    expect(ComposeActions.prototype.send).toBe(originalSend);
  });

  test("Hooks of the same addon, point and time register once", async () => {
    let sandbox = await newAddon("Twice");
    let calls = 0;
    sandbox.logic.mustang.hooks.before("mail.send", () => { calls++; });
    sandbox.logic.mustang.hooks.before("mail.send", () => { calls++; });
    await messages();
    expect(mailSend.hooks.length).toBe(1);
    await send(newMail().mail);
    // The addon runs both of its functions in one hook call
    expect(calls).toBe(2);
  });
});

describe("Before-hooks", () => {
  test("Change the message before it is sent", async () => {
    let sandbox = await newAddon("Tagger");
    sandbox.logic.mustang.hooks.before("mail.send", ({ email }) => {
      email.subject = email.subject + " [tagged]";
    });
    await waitFor(() => mailSend.hooks.length == 1);
    let { mail } = newMail();
    let atServer = await send(mail);
    expect(atServer.subject).toBe("Hi [tagged]");
  });

  test("Cancel stops sending, and tells the user the addon and its reason", async () => {
    let sandbox = await newAddon("Checker");
    sandbox.logic.mustang.hooks.before("mail.send", () => ({ cancel: "Attachment missing" }));
    await waitFor(() => mailSend.hooks.length == 1);
    let { mail, account } = newMail();
    let reachedServer = false;
    account.atServer.then(() => reachedServer = true);
    let onSending = vi.fn();

    let error = await mail.compose.send(onSending).catch(ex => ex);
    expect(error).toBeInstanceOf(AddonCancelError);
    expect(error).toBeInstanceOf(UserError);
    expect(error.message).toBe("Checker: Attachment missing");
    await messages();
    expect(reachedServer).toBe(false);
    // The composer stays open
    expect(onSending).not.toHaveBeenCalled();
  });

  test("The reason is sanitized", async () => {
    let sandbox = await newAddon("Checker");
    sandbox.logic.mustang.hooks.before("mail.send", () => ({ cancel: "‮evil\u0000\n👨‍👩‍👧" + "x".repeat(100000) }));
    await waitFor(() => mailSend.hooks.length == 1);
    let error = await newMail().mail.compose.send().catch(ex => ex);
    expect(error).toBeInstanceOf(AddonCancelError);
    expect(error.message.startsWith("Checker: ")).toBe(true);
    expect(error.message).toContain("evil");
    expect(error.message).toContain("👨‍👩‍👧");
    expect(error.message).not.toMatch(/[‮\u0000\n]/u);
    expect(error.message.length).toBeLessThan(500);
  });

  test("Run in install order, each after the previous finished", async () => {
    let addons = new Addons();
    let first = await newAddon("First", { addons });
    let second = await newAddon("Second", { addons });
    let order: string[] = [];
    second.logic.mustang.hooks.before("mail.send", ({ email }) => {
      order.push("second saw " + email.subject);
    });
    await waitFor(() => mailSend.hooks.length == 1);
    first.logic.mustang.hooks.before("mail.send", async ({ email }) => {
      await new Promise(resolve => setTimeout(resolve, 20));
      email.subject = "From first";
      order.push("first");
    });
    await waitFor(() => mailSend.hooks.length == 2);
    await send(newMail().mail);
    expect(order).toEqual(["first", "second saw From first"]);
  });

  test("The message can't be used after the hook", async () => {
    let sandbox = await newAddon("Keeper");
    let kept: any;
    sandbox.logic.mustang.hooks.before("mail.send", ({ email }) => {
      kept = email;
    });
    await waitFor(() => mailSend.hooks.length == 1);
    let { mail } = newMail();
    await send(mail);
    let subject = mail.subject;

    kept.subject = "Changed later";
    await messages();
    expect(mail.subject).toBe(subject);
    await expect(kept.text).rejects.toThrow();
  });

  test("A hook that fails doesn't stop sending", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let sandbox = await newAddon("Broken");
    sandbox.logic.mustang.hooks.before("mail.send", () => {
      throw new Error("Bug in the addon");
    });
    await waitFor(() => mailSend.hooks.length == 1);
    let atServer = await send(newMail().mail);
    expect(atServer.subject).toBe("Hi");
  });

  test("After 10 s, sending continues, and late changes fail", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let sandbox = await newAddon("Slow");
    let started = false;
    let finish: () => void;
    let gate = new Promise<void>(resolve => finish = resolve);
    sandbox.logic.mustang.hooks.before("mail.send", async ({ email }) => {
      started = true;
      await gate;
      email.subject = "Too late";
    });
    await waitFor(() => mailSend.hooks.length == 1);
    let { mail, account } = newMail();
    let sent = mail.compose.send();
    await waitFor(() => started);

    await vi.advanceTimersByTimeAsync(9000);
    let reachedServer = false;
    account.atServer.then(() => reachedServer = true);
    await messages();
    expect(reachedServer).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    await account.atServer;
    expect(consoleError).toHaveBeenCalled();
    account.serverAccepts();
    await sent;

    finish();
    await messages();
    expect(mail.subject).toBe("Hi");
  });
});

describe("After-hooks", () => {
  test("Get the message and the result, after it was sent, and can't delay the app", async () => {
    let sandbox = await newAddon("Logger");
    let calls: { subject: string, result: unknown }[] = [];
    sandbox.logic.mustang.hooks.after("mail.send", ({ email }, result) => {
      calls.push({ subject: email.subject, result });
      return new Promise<void>(() => {});
    });
    await waitFor(() => mailSend.hooks.length == 1);
    let { mail } = newMail();
    await send(mail);
    await waitFor(() => calls.length == 1);
    expect(calls[0]).toEqual({ subject: "Hi", result: undefined });
  });

  test("Don't run when sending failed", async () => {
    let sandbox = await newAddon("Logger");
    let calls = 0;
    sandbox.logic.mustang.hooks.after("mail.send", () => { calls++; });
    await waitFor(() => mailSend.hooks.length == 1);
    let { mail, account } = newMail();
    let sent = mail.compose.send();
    await account.atServer;
    account.serverRefuses(new Error("Refused"));
    await expect(sent).rejects.toThrow("Refused");
    await messages();
    expect(calls).toBe(0);
  });

  test("Can only read the message, for 30 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let sandbox = await newAddon("Logger");
    let kept: any;
    sandbox.logic.mustang.hooks.after("mail.send", ({ email }) => {
      kept = email;
      email.subject = "Changed after sending";
    });
    await waitFor(() => mailSend.hooks.length == 1);
    let { mail } = newMail();
    await send(mail);
    await waitFor(() => !!kept);
    await messages();
    expect(mail.subject).toBe("Hi");
    expect(await kept.text).toBe(mail.text);

    await vi.advanceTimersByTimeAsync(30000);
    await expect(kept.text).rejects.toThrow();
  });
});

describe("Registration", () => {
  test("Needs the hook in the manifest", async () => {
    let sandbox = await newAddon("Undeclared", { hooks: [] });
    expect(() => sandbox.hooks.call(sandbox.logicFrame.bridge, "register", ["mail.send", "before"])).toThrow();
    expect(mailSend.hooks.isEmpty).toBe(true);
  });

  test("Needs the permission of the hook point", async () => {
    let sandbox = await newAddon("Not granted", { granted: [] });
    expect(() => sandbox.hooks.call(sandbox.logicFrame.bridge, "register", ["mail.send", "before"])).toThrow();
    let other = await newAddon("Other permission", { permissions: ["mail"], hooks: [] });
    expect(() => other.hooks.call(other.logicFrame.bridge, "register", ["mail.send", "before"])).toThrow();
    expect(mailSend.hooks.isEmpty).toBe(true);
    expect(ComposeActions.prototype.send).toBe(originalSend);
  });

  test("Only from the main code of the addon", async () => {
    let sandbox = await newAddon("Frames");
    let uiBridge = await sandbox.connect();
    expect(() => sandbox.hooks.call(uiBridge, "register", ["mail.send", "before"])).toThrow();
    expect(() => sandbox.hooks.call(sandbox.logicFrame.bridge, "register", ["mail.send", "around"])).toThrow();
    expect(() => sandbox.hooks.call(sandbox.logicFrame.bridge, "register", ["constructor", "before"])).toThrow();
    expect(mailSend.hooks.isEmpty).toBe(true);
    uiBridge.close();
  });

  test("Disabling the addon removes its hooks, and the mail is sent unchanged", async () => {
    let sandbox = await newAddon("Tagger");
    sandbox.logic.mustang.hooks.before("mail.send", ({ email }) => {
      email.subject = "Tagged";
    });
    await waitFor(() => mailSend.hooks.length == 1);
    await sandbox.addon.disable();
    expect(mailSend.hooks.isEmpty).toBe(true);
    expect(ComposeActions.prototype.send).toBe(originalSend);
    let atServer = await send(newMail().mail);
    expect(atServer.subject).toBe("Hi");
  });

  test("Nothing registers after the addon stopped", async () => {
    let sandbox = await newAddon("Stopped");
    let bridge = sandbox.logicFrame.bridge;
    sandbox.unregister();
    expect(() => sandbox.hooks.call(bridge, "register", ["mail.send", "before"])).toThrow();
    expect(mailSend.hooks.isEmpty).toBe(true);
  });
});

describe("HookPoint", () => {
  class Base {
    async double(value: number): Promise<number> {
      return value * 2;
    }
  }
  class Override extends Base {
    async double(value: number): Promise<number> {
      return value * 4;
    }
  }

  function newHook(addon: Addon, when: "before" | "after", run: Hook["run"]): Hook {
    return { addon, when, run: vi.fn(run) };
  }

  test("Arguments by parameter name, the result, and subclasses that override the method", async () => {
    let point = new HookPoint({ point: "test.double", class: Base, method: "double", group: "mail", args: [{ name: "value", type: ["number"] }], result: ["number"] });
    let original = Base.prototype.double;
    let originalOverride = Override.prototype.double;
    point.addSubclass(Override);
    let addon = new Addon(new Addons(), AddonManifest.fromJSON({ name: "@test/x", version: "1.0.0", mustang: { name: "X" } }, null), {} as any);
    let before = newHook(addon, "before", async () => {});
    // Never finishes
    let after = newHook(addon, "after", () => new Promise(() => {}));
    point.add(before);
    point.add(after);

    expect(await new Base().double(3)).toBe(6);
    expect(await new Override().double(3)).toBe(12);
    expect(before.run).toHaveBeenCalledWith({ value: 3 });
    expect(after.run).toHaveBeenCalledWith({ value: 3 }, 6);
    expect(after.run).toHaveBeenCalledWith({ value: 3 }, 12);

    point.remove(before);
    point.remove(after);
    expect(Base.prototype.double).toBe(original);
    expect(Override.prototype.double).toBe(originalOverride);
  });

  test("Demo mode: the hooks also run for the demo messages, whose send() is different", async () => {
    let { FakeMailAccount } = await import("../../../logic/testData");
    let me = new Person();
    me.name = "Me";
    me.emailAddresses.add(new ContactEntry("me@example.com", "work"));
    appGlobal.me = me;
    let account = new FakeMailAccount(new ArrayColl(), me, 0);
    await account.listFolders();
    let mail = account.inbox.newEMail();
    mail.identity = account.identities.first;
    mail.subject = "Demo";
    let compose = mail.compose;
    let originalFakeSend = Object.getPrototypeOf(compose).send;
    expect(originalFakeSend).not.toBe(originalSend);
    let addon = new Addon(new Addons(), AddonManifest.fromJSON({ name: "@test/x", version: "1.0.0", mustang: { name: "X" } }, null), {} as any);
    let before = newHook(addon, "before", async () => {});
    mailSend.add(before);
    try {
      await compose.send();
      expect(before.run).toHaveBeenCalledTimes(1);
      expect(before.run).toHaveBeenCalledWith({ email: mail });
    } finally {
      mailSend.remove(before);
    }
    expect(Object.getPrototypeOf(compose).send).toBe(originalFakeSend);
  });
});

describe("Example send-check", () => {
  let code: string;
  let manifest: AddonManifest;

  beforeAll(async () => {
    // A Node process builds it: in this happy-dom test, vitest can't load build.ts, because the app's node polyfills aren't found from addons/
    let examples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../addons/examples");
    let builder = pathToFileURL(path.join(examples, "build.ts")).href;
    let dir = path.join(examples, "send-check");
    let script = `let { AddonBuilder } = await import(${JSON.stringify(builder)});
      let files = await new AddonBuilder(${JSON.stringify(dir)}).build(false);
      process.stdout.write(files.get("dist/main.js"));`;
    code = (await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script])).stdout;
    let files = new MapColl<string, Uint8Array>();
    files.set("package.json", await readFile(path.join(dir, "package.json")));
    files.set("icons/send-check.svg", await readFile(path.join(dir, "icons/send-check.svg")));
    files.set("dist/main.js", new TextEncoder().encode(code));
    manifest = AddonManifest.fromJSON(JSON.parse(new TextDecoder().decode(files.get("package.json"))), files);
  }, 30000);

  async function startSendCheck(): Promise<HookSandbox> {
    let sandbox = await newAddon(manifest.name, { permissions: [...manifest.permissions], hooks: [...manifest.hooks] });
    new Function("mustang", code)(sandbox.logic.mustang);
    await waitFor(() => mailSend.hooks.length == 1);
    return sandbox;
  }

  test("Stops a message that mentions an attachment, but has none", async () => {
    await startSendCheck();
    let { mail } = newMail();
    mail.text = "Hi,\nplease find the report attached.";
    let error = await mail.compose.send().catch(ex => ex);
    expect(error).toBeInstanceOf(AddonCancelError);
    expect(error.message).toMatch(/^Send check: .*attachment/);
  });

  test("Marks the subject of other messages", async () => {
    await startSendCheck();
    let { mail } = newMail();
    mail.text = "Hi,\nsee you tomorrow.";
    expect((await send(mail)).subject).toBe("Hi (checked)");

    let withAttachment = newMail().mail;
    withAttachment.text = "The report is attached.";
    let attachment = new Attachment();
    attachment.filename = "report.pdf";
    attachment.mimeType = "application/pdf";
    withAttachment.attachments.add(attachment);
    expect((await send(withAttachment)).subject).toBe("Hi (checked)");
  });
});
