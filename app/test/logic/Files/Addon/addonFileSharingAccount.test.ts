// app first, to resolve the import cycle around Addons
import { appGlobal } from "../../../../logic/app";
import type { Addon } from "../../../../logic/Addons/Addon";
import { AddonProtocol } from "../../../../logic/Addons/AddonProtocols";
import type { FileEntryData, FilesProtocol } from "../../../../logic/Addons/Sandbox/MustangAPI";
import { AddonFileSharingAccount } from "../../../../logic/Files/Addon/AddonFileSharingAccount";
import type { AddonDirectory } from "../../../../logic/Files/Addon/AddonDirectory";
import { newFileSharingAccountForProtocol } from "../../../../logic/Files/AccountsList/FileSharingAccounts";
import { SQLFileSharingAccount } from "../../../../logic/Files/SQL/SQLFileSharingAccount";
import { getDatabase } from "../../../../logic/Files/SQL/SQLDatabase";
import { FakeProtocolServer, newProtocolAddon, setUpBackend } from "../../Mail/Addon/protocolSandbox";
import sql from "../../../../../lib/rs-sqlite";
import fs from "node:fs/promises";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

// The real sandbox needs a browser
vi.mock("../../../../logic/Addons/AddonSandbox", async () => ({
  AddonSandbox: (await import("../../Mail/Addon/protocolSandbox")).ProtocolSandbox,
}));

/** A file server, as the addon sees it. Paths of directories end with "/". */
class FakeFilesServer extends FakeProtocolServer {
  files = new Map<string, { contents: Uint8Array, lastMod: Date }>();
  dirs = new Set<string>(["/"]);
  /** Path of a directory -> what `listDirectory()` gives instead of the real entries */
  listings = new Map<string, any[]>();

  addFile(path: string, text: string, lastMod = new Date("2026-07-14T10:00:00Z")): void {
    this.files.set(path, { contents: new TextEncoder().encode(text), lastMod });
  }

  list(path: string): FileEntryData[] {
    let entries: FileEntryData[] = [];
    for (let dir of this.dirs) {
      if (dir != path && dir.startsWith(path) && !dir.slice(path.length, -1).includes("/")) {
        entries.push({ name: dir.slice(path.length, -1), isDirectory: true });
      }
    }
    for (let [filePath, file] of this.files) {
      if (filePath.startsWith(path) && !filePath.slice(path.length).includes("/")) {
        entries.push({ name: filePath.slice(path.length), size: file.contents.length, lastMod: file.lastMod, mimetype: "text/plain" });
      }
    }
    return entries;
  }

  filesProtocol(): FilesProtocol {
    return this.protocol({
      listDirectory: async (_account, path) => this.listings.get(path) ?? this.list(path),
      download: async (_account, path) => this.files.get(path)?.contents,
      upload: async (_account, path, contents) => {
        this.files.set(path, { contents, lastMod: new Date() });
      },
      delete: async (_account, path) => {
        this.files.delete(path);
        this.dirs.delete(path);
      },
      move: async (_account, fromPath, toPath) => {
        this.files.set(toPath, this.files.get(fromPath));
        this.files.delete(fromPath);
      },
    } as Partial<FilesProtocol>) as FilesProtocol;
  }
}

beforeAll(() => {
  setUpBackend();
  Object.assign(appGlobal.remoteApp, {
    async writeFile(filepath: string, permissions: number, contents: Uint8Array): Promise<void> {
      await fs.writeFile(filepath, contents, { mode: permissions });
    },
    readFile: (filepath: string) => fs.readFile(filepath),
    deleteFile: (filepath: string) => fs.unlink(filepath),
    async statFile(filepath: string) {
      let stat = await fs.stat(filepath);
      return { size: stat.size, lastMod: stat.mtime };
    },
  });
});

let running: Addon[] = [];

afterEach(async () => {
  for (let addon of running) {
    await addon.disable();
    appGlobal.addons.installed.remove(addon);
  }
  running = [];
  appGlobal.fileSharingAccounts.clear();
});

async function newAccount(server: FakeFilesServer, name = "Fake Files"): Promise<AddonFileSharingAccount> {
  let addon = newProtocolAddon(name, ["test"], mustang => mustang.protocols.register("test", server.filesProtocol()), "files");
  running.push(addon);
  await addon.enable();
  let account = newFileSharingAccountForProtocol(AddonProtocol.accountProtocol(addon.id, "test")) as AddonFileSharingAccount;
  account.name = "Test";
  account.username = "me";
  account.password = "secret";
  await account.save();
  appGlobal.fileSharingAccounts.add(account);
  await account.login(false);
  return account;
}

function rootOf(account: AddonFileSharingAccount): AddonDirectory {
  return account.rootDirs.first;
}

describe("Round trip", () => {
  test("Lists directories, downloads files, stores them, and the file list survives a restart", async () => {
    let server = new FakeFilesServer();
    server.dirs.add("/Documents/");
    server.addFile("/hello.txt", "Hello world");
    server.addFile("/Documents/report.txt", "The report");
    let account = await newAccount(server);
    expect(account).toBeInstanceOf(AddonFileSharingAccount);

    await account.sync();

    let root = rootOf(account);
    expect(root.path).toBe("/");
    let hello = root.files.find(file => file.name == "hello.txt");
    expect(hello.path).toBe("/hello.txt");
    expect(hello.size).toBe(11);
    expect(hello.mimetype).toBe("text/plain");
    expect(hello.lastMod.toISOString()).toBe("2026-07-14T10:00:00.000Z");
    let documents = root.subDirs.find(dir => dir.name == "Documents");
    expect(documents.path).toBe("/Documents/");
    await documents.listContents();
    expect(server.callsOf("listDirectory").map(args => args[1])).toEqual(["/", "/Documents/"]);
    let report = documents.files.first;
    expect(report.path).toBe("/Documents/report.txt");

    await report.download();
    expect(await report.contents.text()).toBe("The report");
    expect(new TextDecoder().decode(await fs.readFile(report.filepathLocal))).toBe("The report");

    let rows = await (await getDatabase()).all(sql`SELECT path FROM file`) as any[];
    expect(rows.map(row => row.path).sort()).toEqual(["/Documents/report.txt", "/hello.txt"]);
    let accounts = await SQLFileSharingAccount.readAll();
    let restarted = accounts.find(loaded => loaded.id == account.id) as AddonFileSharingAccount;
    expect(restarted).toBeInstanceOf(AddonFileSharingAccount);
    expect(rootOf(restarted).files.contents.map(file => file.name)).toEqual(["hello.txt"]);
  });

  test("Upload, rename, move, copy and delete go to the addon", async () => {
    let server = new FakeFilesServer();
    server.dirs.add("/Archive/");
    server.addFile("/a.txt", "A");
    let account = await newAccount(server);
    await account.sync();
    let root = rootOf(account);
    let archive = root.subDirs.first;
    await archive.listContents();

    let upload = root.newFile("new.txt");
    upload.lastMod = new Date();
    await upload.saveContentsOnServer(new Blob(["New file"]));
    expect(new TextDecoder().decode(server.files.get("/new.txt").contents)).toBe("New file");

    let a = root.files.find(file => file.name == "a.txt");
    a.setFileName("b.txt");
    await a.save();
    expect(server.callsOf("move").at(-1).slice(1)).toEqual(["/a.txt", "/b.txt"]);
    expect(a.path).toBe("/b.txt");

    await archive.copyFileHere(a);
    expect(server.callsOf("upload").at(-1)[1]).toBe("/Archive/b.txt");
    expect(new TextDecoder().decode(server.files.get("/Archive/b.txt").contents)).toBe("A");

    await archive.listContents();
    let copy = archive.files.find(file => file.name == "b.txt");
    await copy.deleteIt();
    expect(server.callsOf("delete").at(-1)[1]).toBe("/Archive/b.txt");

    await archive.moveFileHere(a);
    expect(server.callsOf("move").at(-1).slice(1)).toEqual(["/b.txt", "/Archive/b.txt"]);
    expect(archive.files.contents.map(file => file.name)).toEqual(["b.txt"]);

    await expect(root.createSubDirectory("New folder")).rejects.toThrow(/folders/);
  });
});

describe("Checks of the data from the addon", () => {
  test("File names that would change the path, control characters, wrong types and huge downloads are refused", async () => {
    let server = new FakeFilesServer();
    server.listings.set("/", [
      { name: "good.txt", size: 3 },
      { name: "../escape.txt" },
      { name: "a/b.txt" },
      { name: "a\\b.txt" },
      { name: ".." },
      { name: "." },
      { name: "evil‮txt.exe" },
      { name: "bell\u0007.txt" },
      { name: "x".repeat(256) },
      { name: 42 },
      { name: "dir", isDirectory: true, lastMod: "not a date" },
      { name: "weird.txt", size: -1, lastMod: 1e20, mimetype: "text/html\r\nX-Evil: 1" },
    ]);
    let account = await newAccount(server);

    await account.sync();

    let root = rootOf(account);
    expect(root.files.contents.map(file => file.name).sort()).toEqual(["good.txt", "weird.txt"]);
    expect(root.subDirs.contents.map(dir => dir.name)).toEqual(["dir"]);
    expect(isNaN(root.subDirs.first.lastMod.getTime())).toBe(false);
    let weird = root.files.find(file => file.name == "weird.txt");
    expect(weird.size).toBe(0);
    expect(isNaN(weird.lastMod.getTime())).toBe(false);
    expect(weird.mimetype ?? "").not.toContain("X-Evil");
    expect(account.dataErrors.length).toBe(9);

    let good = root.files.find(file => file.name == "good.txt");
    await expect(good.download()).rejects.toThrow(/no contents/);
    server.listings.set("/", Array.from({ length: 10001 }, (_, i) => ({ name: "f" + i })));
    await expect(root.listContents()).rejects.toThrow(/more than 10000/);
  });
});
