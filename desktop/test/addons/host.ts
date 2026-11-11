// The app side of the sandbox security test. Runs in the test window like the app's main window,
// with the real sandbox page, bridge and frames, and the evil addon.
import { AddonBridge } from "../../../app/logic/Addons/Bridge/AddonBridge";
import { AddonAPI } from "../../../app/logic/Addons/Bridge/AddonAPI";
import { AddonBudget } from "../../../app/logic/Addons/Bridge/AddonBudget";
import { SandboxFrame } from "../../../app/logic/Addons/Sandbox/SandboxFrame";
import { TMessage, testClasses, testEnums } from "../../../app/test/logic/Addons/Bridge/fixtures";
import { evilHTML } from "../../../app/test/logic/Addons/evil/src/html";

/** Path in the addon package -> code. Set by the test runner. */
declare const kEvilCode: Record<string, string>;

interface TestConfig {
  allowed: string;
  denied: string;
  local: string[];
  jpc: string;
  rebind: string;
}

const config: TestConfig = JSON.parse(new URLSearchParams(location.search).get("config"));
const api = new AddonAPI(testClasses, testEnums);
const results: Record<string, any> = { readyMS: [], escapes: 0 };
(window as any).appSecret = "S3cret-JPC";
(window as any).appGlobal = { secret: "app objects" };
let broadcasts: unknown[] = [];
new BroadcastChannel("mustang-app").onmessage = event => broadcasts.push(event.data);

/** One installed addon, with its storage */
class TestAddon {
  readonly connectSrc: string;
  readonly storage = new Map<string, unknown>();
  readonly budget = new AddonBudget();
  protected waiters: (() => void)[] = [];

  constructor(tag: string, connectSrc: string) {
    this.connectSrc = connectSrc;
    this.storage.set("config", { ...config, tag });
  }

  async open(kind: "logic" | "ui", path: string, container: HTMLElement): Promise<SandboxFrame> {
    let start = performance.now();
    let frame = new SandboxFrame("Evil");
    frame.iframe.hidden = kind == "logic";
    let bridge = new AddonBridge(frame.port, api, ["message", "mail", "mail.compose"], this.budget);
    frame.bridge = bridge;
    bridge.registerService("storage", { call: (_bridge, method, args) => this.storageCall(method, args) });
    bridge.registerService("ui", { call: () => undefined });
    if (kind == "ui") {
      bridge.registerService("frame", frame);
      frame.onEscape = () => results.escapes++;
    }
    bridge.start({ name: "Evil", version: "1.0.0" });
    if (kind == "ui") {
      frame.setTheme(this.theme(container), getComputedStyle(container).colorScheme, false);
      let message = new TMessage();
      message.subject = "Context subject";
      frame.setContext({ message }, ["message", "mail"]);
    }
    await frame.start(container, kind, kEvilCode[path], this.connectSrc);
    await bridge.ready;
    results.readyMS.push(performance.now() - start);
    return frame;
  }

  /** Like AddonFrame.svelte */
  protected theme(container: HTMLElement): [string, string][] {
    let style = getComputedStyle(container);
    let properties: [string, string][] = [];
    for (let name of style) {
      if (name.startsWith("--")) {
        properties.push([name, style.getPropertyValue(name)]);
      }
    }
    return properties;
  }

  protected storageCall(method: string, args: unknown[]): unknown {
    if (method == "set") {
      this.storage.set(args[0] as string, args[1]);
      for (let waiter of this.waiters.splice(0)) {
        waiter();
      }
      return undefined;
    }
    return this.storage.get(args[0] as string);
  }

  async waitFor(key: string): Promise<unknown> {
    let end = Date.now() + 60000;
    while (!this.storage.has(key)) {
      if (Date.now() > end) {
        return "timeout";
      }
      await new Promise<void>(resolve => {
        this.waiters.push(resolve);
        setTimeout(resolve, 500);
      });
    }
    return this.storage.get(key);
  }
}

function newContainer(): HTMLElement {
  let container = document.createElement("div");
  container.className = "container";
  document.body.appendChild(container);
  return container;
}

async function measure(addon: TestAddon, logic: SandboxFrame): Promise<void> {
  let grant = logic.bridge.newGrant(["message", "mail"]);
  await logic.bridge.request("ui", "command", { messages: [new TMessage()] }, grant, { command: "perf" });
  results.perf = addon.storage.get("perf");
  let messages = Array.from({ length: 10000 }, () => new TMessage());
  let encodeGrant = logic.bridge.newGrant(["message", "mail"]);
  let start = performance.now();
  logic.bridge.notify("test", "encode", { messages }, encodeGrant);
  results.perf.headersEncodeMS = performance.now() - start;
  encodeGrant.revoke();
  await new Promise(resolve => setTimeout(resolve, 100));
  start = performance.now();
  let sent = Date.now();
  await logic.bridge.request("ui", "command", { messages }, logic.bridge.newGrant(["message", "mail"]), { command: "count" });
  results.perf.headers10000MS = performance.now() - start;
  results.perf.headersCount = addon.storage.get("count");
  results.perf.headersUntilWorkerHandlerMS = (addon.storage.get("countAt") as number) - sent;
  let readyBefore = results.readyMS.length;
  start = performance.now();
  let frames = await Promise.all(Array.from({ length: 10 }, () => addon.open("ui", "dist/hello.js", newContainer())));
  results.perf.tenFramesMS = performance.now() - start;
  results.perf.helloFrameReadyMS = results.readyMS.slice(readyBefore).sort((a, b) => a - b);
  await new Promise(resolve => setTimeout(resolve, 500));
  for (let frame of frames) {
    frame.remove();
  }
}

/** The addon writes HTML into a draft. The app renders it in its own document, like the composer. */
async function compose(logic: SandboxFrame, tag: string): Promise<void> {
  let draft = new TMessage();
  let grant = logic.bridge.newGrant(["message", "mail", "mail.compose"]);
  await logic.bridge.request("ui", "command", { draft }, grant, { command: "compose" });
  grant.revoke();
  results["compose-" + tag] = draft.html;
  let rendered = newContainer();
  rendered.innerHTML = draft.html;
  // Control: the same HTML without the bridge
  let control = newContainer();
  control.innerHTML = evilHTML(`${config.denied}/control_${tag}`);
  await new Promise(resolve => setTimeout(resolve, 1500));
  rendered.remove();
  control.remove();
}

async function run(): Promise<void> {
  try {
    // Control: requests of the app itself carry its cookies
    await fetch(config.allowed + "/app/cookie", { credentials: "include" });
  } catch (ex) {
    // The app's own CORS headers don't allow credentials. The server saw the request.
  }
  for (let [tag, connectSrc] of [["hosts", config.allowed], ["any", "https:"]]) {
    let addon = new TestAddon(tag, connectSrc);
    let logic = await addon.open("logic", "dist/main.js", document.body);
    await logic.bridge.request("ui", "command", {}, null, { command: "probe" });
    results["worker-" + tag] = addon.storage.get("results:worker-" + tag);
    await compose(logic, tag);
    let panel = await addon.open("ui", "dist/panel.js", newContainer());
    results["frame-" + tag] = await addon.waitFor("results:frame-" + tag);
    await new Promise(resolve => setTimeout(resolve, 300));
    results["size-" + tag] = [panel.contentWidth, panel.contentHeight];
    let navigate = await addon.open("ui", "dist/navigate.js", newContainer());
    results["navigate-" + tag] = await addon.waitFor("results:navigate-" + tag);
    if (tag == "hosts") {
      await measure(addon, logic);
    }
    for (let frame of [logic, panel, navigate]) {
      frame.remove();
    }
  }
  results.broadcastsReceived = broadcasts;
}

run()
  .catch(ex => results.error = String(ex?.stack ?? ex))
  .finally(() => (window as any).__done = true);
(window as any).__results = results;
