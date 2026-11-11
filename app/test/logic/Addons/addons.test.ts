// app first, to resolve the import cycle around Addons
import { appGlobal } from "../../../logic/app";
import { Addons } from "../../../logic/Addons/Addons";
import { Addon, AddonState, type AddonRegistration } from "../../../logic/Addons/Addon";
import { DesktopAddonFiles } from "../../../logic/Addons/AddonFiles";
import { UserError } from "../../../logic/util/util";
import { fullPackageFiles, fullPackageJSON, gzip, kSVG, makeTar, makeTGZ } from "./testPackage";
import { mkdtempSync } from "node:fs";
import fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArrayColl, MapColl } from "svelte-collections";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// The sandbox needs a browser. test/logic/Addons/Sandbox tests it.
vi.mock("../../../logic/Addons/AddonSandbox", () => ({
  AddonSandbox: class {
    async start() {
    }
    unregister() {
    }
  },
}));

let configDir: string;

beforeAll(() => {
  configDir = mkdtempSync(path.join(tmpdir(), "addons-test-"));
  appGlobal.remoteApp = {
    getConfigDir: () => configDir,
    async writeFile(filepath: string, permissions: number, contents: Uint8Array): Promise<void> {
      await fsPromises.rm(filepath, { force: true });
      await fsPromises.writeFile(filepath, contents, { mode: permissions });
    },
    readFile: (filepath: string) => fsPromises.readFile(filepath),
    fs: fsPromises,
  } as any;
});

let storage = new Map<string, string>();
globalThis.localStorage ??= {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, String(value)),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
} as any;

beforeEach(async () => {
  localStorage.removeItem("addons");
  await fsPromises.rm(path.join(configDir, "addons"), { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** All files and directories in `<configDir>/addons/` */
async function filesOnDisk(): Promise<string[]> {
  try {
    return await fsPromises.readdir(path.join(configDir, "addons"), { recursive: true });
  } catch (ex) {
    return [];
  }
}

async function mainFilesOnDisk(): Promise<string[]> {
  return (await filesOnDisk()).filter(file => file.endsWith(path.join("dist", "main.js")));
}

function packageTGZ(change: (json: any) => void = () => {}, files = fullPackageFiles()): Uint8Array {
  let json = fullPackageJSON();
  change(json);
  return makeTGZ({ ...files, "package.json": JSON.stringify(json) });
}

async function install(addons = new Addons(), change?: (json: any) => void): Promise<Addon> {
  let pkg = await addons.readPackage(packageTGZ(change), "translate-1.2.0.tgz");
  return await addons.install(pkg, pkg.manifest.requestedPermissions);
}

function storedAddons(): any[] {
  return JSON.parse(localStorage.getItem("addons") ?? "[]");
}

class TestRegistration implements AddonRegistration {
  constructor(readonly name: string, readonly log: string[]) {
  }
  unregister() {
    this.log.push(this.name);
  }
}

describe("Read a package", () => {
  test("npm pack: files in package/", async () => {
    let pkg = await new Addons().readPackage(packageTGZ(), "translate.tgz");
    expect(pkg.manifest.id).toBe("@example/translate");
    expect(pkg.source).toBe("translate.tgz");
    expect(pkg.files.has("dist/main.js")).toBe(true);
    expect(pkg.files.has("package.json")).toBe(true);
  });

  test("A tar without the package/ directory", async () => {
    let files = { ...fullPackageFiles(), "package.json": JSON.stringify(fullPackageJSON()) };
    let tgz = gzip(makeTar(Object.entries(files).map(([path, contents]) => ({ path, contents }))));
    let pkg = await new Addons().readPackage(tgz, "translate.tgz");
    expect(pkg.files.has("dist/main.js")).toBe(true);
  });

  test.each([
    ["no package.json", () => makeTGZ(fullPackageFiles())],
    ["package.json is not JSON", () => makeTGZ({ ...fullPackageFiles(), "package.json": "{ name: " })],
    ["not gzip", () => new TextEncoder().encode("not a package")],
    ["a symlink", () => gzip(makeTar([
      { path: "package/package.json", contents: JSON.stringify(fullPackageJSON()) },
      { path: "package/dist/main.js", type: "2", linkName: "/etc/passwd" },
    ]))],
    ["path traversal", () => gzip(makeTar([
      { path: "package/package.json", contents: JSON.stringify(fullPackageJSON()) },
      { path: "package/../../evil.js", contents: "x" },
    ]))],
    ["the same file in different case", () => makeTGZ({ ...fullPackageFiles(), "Dist/main.js": "x", "package.json": JSON.stringify(fullPackageJSON()) })],
    ["a file name that doesn't work on Windows", () => makeTGZ({ ...fullPackageFiles(), "dist/a:b.js": "x", "package.json": JSON.stringify(fullPackageJSON()) })],
    ["an invalid manifest", () => packageTGZ(json => json.mustang.permissions = ["everything"])],
  ])("Rejects %s", async (_, tgz: () => Uint8Array) => {
    await expect(new Addons().readPackage(tgz(), "bad.tgz")).rejects.toThrow(UserError);
  });

  test("Rejects more than 20 MB", async () => {
    await expect(new Addons().readPackage(new Uint8Array(20 * 1024 * 1024 + 1), "big.tgz")).rejects.toThrow(/20 MB/);
  });

  test("Rejects more than 50 MB unpacked", async () => {
    let tgz = makeTGZ({ ...fullPackageFiles(), "big.bin": new Uint8Array(51 * 1024 * 1024), "package.json": JSON.stringify(fullPackageJSON()) });
    expect(tgz.length).toBeLessThan(20 * 1024 * 1024);
    await expect(new Addons().readPackage(tgz, "bomb.tgz")).rejects.toThrow(UserError);
  });

  test("Rejects more than 1,000 files", async () => {
    let files: Record<string, string> = { ...fullPackageFiles(), "package.json": JSON.stringify(fullPackageJSON()) };
    for (let i = 0; i < 1000; i++) {
      files[`data/${i}.txt`] = "x";
    }
    await expect(new Addons().readPackage(makeTGZ(files), "many.tgz")).rejects.toThrow(UserError);
  });
});

describe("Download a package", () => {
  test("https", async () => {
    let tgz = packageTGZ();
    let fetchMock = vi.fn(async () => new Response(tgz as BodyInit));
    vi.stubGlobal("fetch", fetchMock);
    let pkg = await new Addons().downloadPackage("https://addons.example.com/translate.tgz");
    expect(pkg.manifest.id).toBe("@example/translate");
    expect(pkg.source).toBe("https://addons.example.com/translate.tgz");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test.each([
    ["http://addons.example.com/translate.tgz"],
    ["file:///etc/passwd"],
    ["javascript:alert(1)"],
    ["not a URL"],
  ])("Rejects %s without fetching", async (url) => {
    let fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(new Addons().downloadPackage(url)).rejects.toThrow(UserError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("Rejects an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404 })));
    await expect(new Addons().downloadPackage("https://addons.example.com/x.tgz")).rejects.toThrow(/404/);
  });

  test("Rejects a redirect to http", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      let response = new Response(packageTGZ() as BodyInit);
      Object.defineProperty(response, "url", { value: "http://evil.example.com/translate.tgz" });
      return response;
    }));
    await expect(new Addons().downloadPackage("https://addons.example.com/x.tgz")).rejects.toThrow(UserError);
  });

  test("Stops reading after 20 MB", async () => {
    let chunksRead = 0;
    let body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksRead++;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    await expect(new Addons().downloadPackage("https://addons.example.com/endless.tgz")).rejects.toThrow(/larger than/);
    expect(chunksRead).toBeLessThan(30);
  });
});

describe("Install", () => {
  test("Writes the files, saves the list and starts the addon", async () => {
    let addons = new Addons();
    let addon = await install(addons);
    expect(addons.installed.contents).toEqual([addon]);
    expect(addons.get("@example/translate")).toBe(addon);
    expect(addon.state).toBe(AddonState.Enabled);
    expect(addon.isEnabled).toBe(true);
    expect(addon.grantedPermissions.contents.sort()).toEqual(["https://*.example.org", "https://api.example.com", "mail", "mail.compose"]);
    expect(await mainFilesOnDisk()).toHaveLength(1);
    expect(new TextDecoder().decode(await addon.readFile("dist/main.js"))).toBe(fullPackageFiles()["dist/main.js"]);
    expect(new TextDecoder().decode(await addon.readFile("./icons/translate.svg"))).toBe(kSVG);
    let stored = storedAddons();
    expect(stored.length).toBe(1);
    expect(stored[0].manifest.name).toBe("@example/translate");
    expect(stored[0].enabled).toBe(true);
  });

  test("API groups from the granted permissions", async () => {
    let addon = await install();
    expect(addon.apiGroups.contents.sort()).toEqual(["mail", "mail.compose", "message"]);
  });

  test("Needs all permissions granted", async () => {
    let addons = new Addons();
    let pkg = await addons.readPackage(packageTGZ(), "translate.tgz");
    await expect(addons.install(pkg, new ArrayColl(["mail", "mail.compose"]))).rejects.toThrow(UserError);
    await expect(addons.install(pkg, new ArrayColl(["mail", "https://api.example.com", "https://*.example.org"]))).rejects.toThrow(UserError);
    expect(addons.installed.isEmpty).toBe(true);
    expect(await filesOnDisk()).toEqual([]);
    expect(storedAddons()).toEqual([]);
  });

  test("Not twice", async () => {
    let addons = new Addons();
    await install(addons);
    await expect(install(addons)).rejects.toThrow(UserError);
    expect(addons.installed.length).toBe(1);
  });

  test("The addon cannot read files outside its package", async () => {
    let addon = await install();
    await fsPromises.writeFile(path.join(configDir, "secret.txt"), "secret");
    await expect(addon.readFile("../../../secret.txt")).rejects.toThrow();
    await expect(addon.readFile("/etc/passwd")).rejects.toThrow();
    await expect(addon.readFile("dist/../../../../secret.txt")).rejects.toThrow();
  });

  test("If the start fails, the addon stays installed with the error", async () => {
    vi.spyOn(Addon.prototype as any, "start").mockRejectedValueOnce(new Error("Syntax error in main.js"));
    let addons = new Addons();
    await expect(install(addons)).rejects.toThrow("Syntax error in main.js");
    let addon = addons.get("@example/translate");
    expect(addon.state).toBe(AddonState.Error);
    expect(addon.error.message).toBe("Syntax error in main.js");
  });
});

describe("Files on disk", () => {
  test("Each addon has its own directory and storage, also with similar names", async () => {
    let victim = new DesktopAddonFiles("@a/b__c");
    let attacker = new DesktopAddonFiles("@a__b/c");
    await victim.writeStorage(`{"token":"secret"}`);
    expect(await attacker.readStorage()).toBeNull();
    await attacker.writeStorage("{}");
    await attacker.deleteAll();
    expect(await victim.readStorage()).toBe(`{"token":"secret"}`);
  });

  test("Names are valid file names, and distinct also where the file system ignores case or trailing dots", async () => {
    let ids = ["x", "x.", "x..", "@a/b__c", "@a__b/c", "@a/b", "a_2fb", "a.b", "a_b", "a~b", "a-b"];
    let contents = new MapColl<string, Uint8Array>();
    contents.set("main.js", new Uint8Array(1));
    for (let id of ids) {
      let files = new DesktopAddonFiles(id);
      for (let version of ["1.0.0-Beta", "1.0.0-beta"]) {
        await files.writePackage(version, contents);
      }
    }
    let names = await fsPromises.readdir(path.join(configDir, "addons"));
    let folded = (fileNames: string[]) => new Set(fileNames.map(name => name.toLowerCase().replace(/[. ]+$/, "")));
    expect(folded(names).size).toBe(ids.length);
    for (let name of names) {
      expect(name).not.toMatch(/[/\\:*?"<>|\x00-\x1f]|[. ]$/);
      let versions = await fsPromises.readdir(path.join(configDir, "addons", name));
      expect(folded(versions).size).toBe(2);
    }
  });
});

describe("Enable and disable", () => {
  test("Disable undoes the registrations in reverse order", async () => {
    let addon = await install();
    let log: string[] = [];
    addon.registrations.addAll(["sandbox", "button", "menu item", "hook"].map(name => new TestRegistration(name, log)));
    await addon.disable();
    expect(log).toEqual(["hook", "menu item", "button", "sandbox"]);
    expect(addon.registrations.isEmpty).toBe(true);
    expect(addon.state).toBe(AddonState.Disabled);
    expect(addon.isEnabled).toBe(false);
    expect(storedAddons()[0].enabled).toBe(false);
  });

  test("A failing unregister doesn't stop the others", async () => {
    let addon = await install();
    let log: string[] = [];
    addon.registrations.add(new TestRegistration("first", log));
    addon.registrations.add({ unregister: () => { throw new Error("broken"); } });
    addon.registrations.add({ unregister: async () => { log.push("async"); } });
    await addon.disable();
    expect(log).toEqual(["async", "first"]);
    expect(addon.registrations.isEmpty).toBe(true);
  });

  test("Enable starts it again", async () => {
    let addon = await install();
    await addon.disable();
    let start = vi.spyOn(Addon.prototype as any, "start");
    await addon.enable();
    expect(start).toHaveBeenCalledOnce();
    expect(addon.state).toBe(AddonState.Enabled);
    expect(storedAddons()[0].enabled).toBe(true);
    await addon.enable();
    expect(start).toHaveBeenCalledOnce();
  });

  test("A failed start undoes what the addon registered so far", async () => {
    let addon = await install();
    await addon.disable();
    let log: string[] = [];
    vi.spyOn(Addon.prototype as any, "start").mockImplementationOnce(async function (this: Addon) {
      this.registrations.add(new TestRegistration("sandbox", log));
      throw new Error("Worker crashed");
    });
    await expect(addon.enable()).rejects.toThrow("Worker crashed");
    expect(log).toEqual(["sandbox"]);
    expect(addon.state).toBe(AddonState.Error);
    expect(addon.isEnabled).toBe(true);
    await addon.disable();
    expect(addon.state).toBe(AddonState.Disabled);
    expect(addon.error).toBeNull();
  });
});

describe("Uninstall", () => {
  test("Stops it, and deletes its files and storage", async () => {
    let addons = new Addons();
    let addon = await install(addons);
    await addon.storage.set("key", "value");
    let log: string[] = [];
    addon.registrations.add(new TestRegistration("button", log));
    await addon.uninstall();
    expect(log).toEqual(["button"]);
    expect(addons.installed.isEmpty).toBe(true);
    expect(storedAddons()).toEqual([]);
    expect(await filesOnDisk()).toEqual([]);
  });

  test("Reinstalling starts with empty storage", async () => {
    let addons = new Addons();
    let addon = await install(addons);
    await addon.storage.set("key", "value");
    await addon.uninstall();
    addon = await install(addons);
    expect(await addon.storage.get("key")).toBeUndefined();
  });
});

describe("Update", () => {
  test("Replaces the files, and restarts the addon", async () => {
    let addons = new Addons();
    let addon = await install(addons);
    let log: string[] = [];
    addon.registrations.add(new TestRegistration("old button", log));
    let start = vi.spyOn(Addon.prototype as any, "start");
    let files = { ...fullPackageFiles(), "dist/main.js": "// version 1.3.0" };
    let pkg = await addons.readPackage(packageTGZ(json => json.version = "1.3.0", files), "translate-1.3.0.tgz");
    expect(pkg.manifest.permissionsAddedTo(addon.grantedPermissions).isEmpty).toBe(true);
    await addon.update(pkg);
    expect(log).toEqual(["old button"]);
    expect(start).toHaveBeenCalledOnce();
    expect(addon.state).toBe(AddonState.Enabled);
    expect(addon.manifest.version).toBe("1.3.0");
    expect(new TextDecoder().decode(await addon.readFile("dist/main.js"))).toBe("// version 1.3.0");
    expect(await mainFilesOnDisk()).toHaveLength(1);
    expect(storedAddons()[0].manifest.version).toBe("1.3.0");
  });

  test("Keeps the addon's storage", async () => {
    let addons = new Addons();
    let addon = await install(addons);
    await addon.storage.set("key", { a: 1 });
    await addon.update(await addons.readPackage(packageTGZ(json => json.version = "1.3.0"), "translate.tgz"));
    expect(await addon.storage.get("key")).toEqual({ a: 1 });
  });

  test("More permissions and hosts need the user's confirmation", async () => {
    let addons = new Addons();
    let addon = await install(addons);
    let pkg = await addons.readPackage(packageTGZ(json => {
      json.version = "2.0.0";
      json.mustang.permissions.push("mail.all");
      json.mustang.hosts.push("https://new.example.com");
    }), "translate-2.0.0.tgz");
    let added = pkg.manifest.permissionsAddedTo(addon.grantedPermissions);
    expect(added.contents.sort()).toEqual(["https://new.example.com", "mail.all"]);

    await expect(addon.update(pkg)).rejects.toThrow(UserError);
    await expect(addon.update(pkg, new ArrayColl(["mail.all"]))).rejects.toThrow(UserError);
    expect(addon.manifest.version).toBe("1.2.0");
    expect(addon.state).toBe(AddonState.Enabled);
    expect(await mainFilesOnDisk()).toHaveLength(1);

    await addon.update(pkg, added);
    expect(addon.manifest.version).toBe("2.0.0");
    expect(addon.grantedPermissions.contents).toContain("mail.all");
    expect(addon.apiGroups.contents).toContain("mail.all");
    expect(storedAddons()[0].granted).toContain("https://new.example.com");
  });

  test("Fewer permissions: the dropped ones are no longer granted", async () => {
    let addons = new Addons();
    let addon = await install(addons);
    await addon.update(await addons.readPackage(packageTGZ(json => {
      json.version = "1.3.0";
      json.mustang.permissions = ["mail.compose"];
      json.mustang.hosts = [];
    }), "translate.tgz"));
    expect(addon.grantedPermissions.contents).toEqual(["mail.compose"]);
  });

  test.each([
    ["the same version", (json: any) => {}],
    ["an older version", (json: any) => json.version = "1.1.9"],
    ["another addon", (json: any) => {
      json.version = "9.0.0";
      json.name = "@example/other";
    }],
  ])("Rejects %s", async (_, change) => {
    let addons = new Addons();
    let addon = await install(addons);
    let pkg = await addons.readPackage(packageTGZ(change), "translate.tgz");
    await expect(addon.update(pkg)).rejects.toThrow(UserError);
    expect(addon.manifest.version).toBe("1.2.0");
    expect(addon.state).toBe(AddonState.Enabled);
  });

  test("A disabled addon stays disabled", async () => {
    let addons = new Addons();
    let addon = await install(addons);
    await addon.disable();
    let start = vi.spyOn(Addon.prototype as any, "start");
    await addon.update(await addons.readPackage(packageTGZ(json => json.version = "1.3.0"), "translate.tgz"));
    expect(start).not.toHaveBeenCalled();
    expect(addon.state).toBe(AddonState.Disabled);
  });
});

describe("App start", () => {
  test("Loads the installed addons and starts the enabled ones", async () => {
    let first = new Addons();
    await install(first);
    let second = await install(first, json => json.name = "@example/second");
    await second.disable();

    let addons = new Addons();
    addons.loadOnStartup();
    expect(addons.installed.length).toBe(2);
    let translate = addons.get("@example/translate");
    await vi.waitFor(() => expect(translate.state).toBe(AddonState.Enabled));
    expect(translate.grantedPermissions.contents).toContain("mail");
    expect(translate.manifest.ui.length).toBe(4);
    expect(new TextDecoder().decode(await translate.readFile("dist/main.js"))).toBe(fullPackageFiles()["dist/main.js"]);
    expect(addons.get("@example/second").state).toBe(AddonState.Disabled);
  });

  test("Grants only what the addon asks for, whatever the stored list says", async () => {
    await install();
    let stored = storedAddons();
    stored[0].granted.push("mail.all", "network.any", "https://evil.example.com");
    localStorage.setItem("addons", JSON.stringify(stored));
    let addons = new Addons();
    addons.loadOnStartup();
    let addon = addons.get("@example/translate");
    expect(addon.grantedPermissions.contents.sort()).toEqual(addon.manifest.requestedPermissions.contents.sort());
    expect(addon.apiGroups.contents).not.toContain("mail.all");
  });

  test("A failing addon gets the error, and doesn't throw", async () => {
    await install();
    vi.spyOn(Addon.prototype as any, "start").mockRejectedValueOnce(new Error("Worker crashed"));
    let addons = new Addons();
    addons.loadOnStartup();
    let addon = addons.get("@example/translate");
    await vi.waitFor(() => expect(addon.state).toBe(AddonState.Error));
    expect(addon.error.message).toBe("Worker crashed");
  });

  test("Permissions that were not granted keep it from starting", async () => {
    await install();
    let stored = storedAddons();
    stored[0].granted = ["mail"];
    localStorage.setItem("addons", JSON.stringify(stored));
    let start = vi.spyOn(Addon.prototype as any, "start");
    let addons = new Addons();
    addons.loadOnStartup();
    let addon = addons.get("@example/translate");
    await vi.waitFor(() => expect(addon.state).toBe(AddonState.Error));
    expect(start).not.toHaveBeenCalled();
  });

  test("Bad entries in the list are skipped, and nothing throws", async () => {
    await install();
    let stored = storedAddons();
    stored.push(null, 5, { manifest: { name: "../evil" } }, { manifest: { ...stored[0].manifest, mustang: { ...stored[0].manifest.mustang, hosts: ["https://127.0.0.1"] } } });
    localStorage.setItem("addons", JSON.stringify(stored));
    let addons = new Addons();
    addons.loadOnStartup();
    expect(addons.installed.length).toBe(1);

    localStorage.setItem("addons", "{ not JSON");
    addons = new Addons();
    expect(() => addons.loadOnStartup()).not.toThrow();
    expect(addons.installed.isEmpty).toBe(true);
  });
});

describe("Addon's own storage", () => {
  test("Set, get and remove JSON values, kept across app starts", async () => {
    let addon = await install();
    await addon.storage.set("settings", { language: "de", count: 3 });
    await addon.storage.set("list", [1, 2, 3]);
    await addon.storage.set("removed", true);
    await addon.storage.remove("removed");
    let value = await addon.storage.get("settings");
    value.language = "changed by the caller";
    expect(await addon.storage.get("settings")).toEqual({ language: "de", count: 3 });

    let addons = new Addons();
    addons.loadOnStartup();
    let reloaded = addons.get("@example/translate");
    expect(await reloaded.storage.get("settings")).toEqual({ language: "de", count: 3 });
    expect(await reloaded.storage.get("list")).toEqual([1, 2, 3]);
    expect(await reloaded.storage.get("removed")).toBeUndefined();
    expect(await reloaded.storage.get("never set")).toBeUndefined();
  });

  test("Keys like __proto__ are plain keys", async () => {
    let addon = await install();
    await addon.storage.set("__proto__", { polluted: true });
    let addons = new Addons();
    addons.loadOnStartup();
    expect(await addons.get("@example/translate").storage.get("__proto__")).toEqual({ polluted: true });
    expect(({} as any).polluted).toBeUndefined();
  });

  test("Quota of 10 MB", async () => {
    let addon = await install();
    let fiveMB = "x".repeat(5 * 1024 * 1024);
    await addon.storage.set("a", fiveMB);
    await expect(addon.storage.set("b", fiveMB)).rejects.toThrow(/full/);
    await addon.storage.set("a", "small");
    await addon.storage.set("b", fiveMB);
    expect((await addon.storage.get("b")).length).toBe(fiveMB.length);
  });

  test("Rejects values that are not JSON, and bad keys", async () => {
    let addon = await install();
    await expect(addon.storage.set("big", 10n)).rejects.toThrow();
    let cyclic: any = {};
    cyclic.self = cyclic;
    await expect(addon.storage.set("cyclic", cyclic)).rejects.toThrow();
    await expect(addon.storage.set("", 1)).rejects.toThrow();
    await expect(addon.storage.set("k".repeat(1001), 1)).rejects.toThrow();
    await expect(addon.storage.get({ toString: () => "x" } as any)).rejects.toThrow();
  });

  test("Parallel writes all end up in the file", async () => {
    let addon = await install();
    await Promise.all(Array.from({ length: 20 }, (_, i) => addon.storage.set(`key${i}`, i)));
    let addons = new Addons();
    addons.loadOnStartup();
    let reloaded = addons.get("@example/translate");
    for (let i = 0; i < 20; i++) {
      expect(await reloaded.storage.get(`key${i}`)).toBe(i);
    }
  });
});
