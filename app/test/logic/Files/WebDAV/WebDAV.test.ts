/**
 * Integration test for WebDAV.
 *
 * Spins up an in-process WebDAV server (webdav-server npm) against a temp
 * directory, stubs the IPC bridge so the renderer-side WebDAVAccount talks to
 * the webdav client directly in this process, then drives the full File/
 * Directory API surface. No dev backend needed.
 *
 * Note: modules are dynamically imported inside beforeAll() because the
 * Mail/Encryption module graph has circular imports that fail when triggered
 * at top-level by an unrelated test file.
 */
import * as webdavServer from "webdav-server";
import * as webdavClient from "webdav";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

const v2 = (webdavServer as any).v2;
const USERNAME = "testuser";
const PASSWORD = "testpass";

let server: any;
let port: number;
let storageDir: string;      // what the server serves
let localDir: string;        // where the app caches downloaded files
let account: any;            // WebDAVAccount
let ArrayColl: any;
let WebDAVDirectoryCls: any;
/** What the OS was asked to open, and what was in the file at that moment */
let openedFiles: { path: string, contents: string | null }[] = [];

async function startServer(): Promise<void> {
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "mustang-webdav-test-"));
  let userManager = new v2.SimpleUserManager();
  let user = userManager.addUser(USERNAME, PASSWORD, false);
  let privilegeManager = new v2.SimplePathPrivilegeManager();
  privilegeManager.setRights(user, "/", ["all"]);

  server = new v2.WebDAVServer({
    port: 0,
    httpAuthentication: new v2.HTTPBasicAuthentication(userManager, "test"),
    privilegeManager,
  });
  await new Promise<void>(resolve => server.start((httpServer: any) => {
    port = httpServer.address().port;
    resolve();
  }));
  await new Promise<void>((resolve, reject) =>
    server.setFileSystem("/", new v2.PhysicalFileSystem(storageDir), (success: boolean) =>
      success ? resolve() : reject(new Error("setFileSystem failed"))));
}

async function stopServer(): Promise<void> {
  await new Promise<void>(resolve => server.stop(() => resolve()));
  await fs.rm(storageDir, { recursive: true, force: true });
  await fs.rm(localDir, { recursive: true, force: true });
}

/** Independent verification client — talks to the WebDAV server directly, not
 *  through our WebDAVAccount, so we can prove changes are really on the server. */
let verify: webdavClient.WebDAVClient;

beforeAll(async () => {
  let app = await import("../../../../logic/app");
  let { WebDAVAccount } = await import("../../../../logic/Files/WebDAV/WebDAVAccount");
  let { WebDAVDirectory } = await import("../../../../logic/Files/WebDAV/WebDAVDirectory");
  let { AuthMethod } = await import("../../../../logic/Abstract/Account");
  let { DummyFileStorage } = await import("../../../../logic/Files/Store/DummyFileStorage");
  ArrayColl = (await import("svelte-collections")).ArrayColl;
  WebDAVDirectoryCls = WebDAVDirectory;

  localDir = await fs.mkdtemp(path.join(os.tmpdir(), "mustang-webdav-local-"));
  app.appGlobal.remoteApp = {
    createWebDAVClient(serverURL: string, options: any) {
      return webdavClient.createClient(serverURL, options);
    },
    getFilesDir: () => localDir,
    // <copied from="desktop/backend/backend.ts">
    async writeFile(filepath: string, permissions: number, contents: Uint8Array): Promise<void> {
      await fs.rm(filepath, { force: true });
      let fileHandle = await fs.open(filepath, "w", permissions);
      await fileHandle.write(contents);
      await fileHandle.close();
    },
    readFile: (filepath: string) => fs.readFile(filepath),
    deleteFile: (filepath: string) => fs.unlink(filepath),
    async statFile(filepath: string) {
      let s = await fs.stat(filepath);
      let stat = {} as any;
      stat.size = s.size;
      stat.lastMod = s.mtime;
      return stat;
    },
    fs,
    // </copied>
    async openFileInNativeApp(filepath: string) {
      let contents = filepath ? await fs.readFile(filepath, "utf8").catch(() => null) : null;
      openedFiles.push({ path: filepath, contents });
    },
  };
  await startServer();
  verify = webdavClient.createClient(`http://127.0.0.1:${port}/`, {
    username: USERNAME,
    password: PASSWORD,
  });
  account = new WebDAVAccount();
  account.storage = new DummyFileStorage();
  account.url = `http://127.0.0.1:${port}/`;
  account.username = USERNAME;
  account.password = PASSWORD;
  account.authMethod = AuthMethod.Password;
  await account.login(false);
});

afterAll(async () => {
  await stopServer();
});

test("sync creates exactly one root directory labelled Files", async () => {
  await account.sync();
  expect(account.rootDirs.length).toBe(1);
  let root = account.rootDirs.first;
  expect(root).toBeInstanceOf(WebDAVDirectoryCls);
  expect(root.path).toBe("/");
});

test("listContents on empty root returns nothing", async () => {
  let root = account.rootDirs.first;
  await root.listContents();
  expect(root.files.length).toBe(0);
  expect(root.subDirs.length).toBe(0);
});

test("uploaded file appears on the server (via independent verify client)", async () => {
  let root = account.rootDirs.first;
  let payload = new TextEncoder().encode("Hello WebDAV world\n");
  let stub = root.newFile("hello.txt");
  stub.contents = new Blob([payload], { type: "text/plain" });
  stub.mimetype = "text/plain";
  await root.addFile(stub);

  let serverListing = await verify.getDirectoryContents("/") as webdavClient.FileStat[];
  expect(serverListing.map(s => s.basename)).toContain("hello.txt");
  let bytes = await verify.getFileContents("/hello.txt", { format: "binary" }) as ArrayBuffer;
  expect(new TextDecoder().decode(new Uint8Array(bytes))).toBe("Hello WebDAV world\n");
});

test("downloaded file bytes match what was uploaded", async () => {
  let root = account.rootDirs.first;
  await root.listContents();
  let file = root.files.find(f => f.name == "hello.txt");
  expect(file).toBeDefined();
  expect(file.size).toBe("Hello WebDAV world\n".length);

  file.contents = null;
  await file.download();
  let downloaded = new Uint8Array(await file.contents.arrayBuffer());
  expect(new TextDecoder().decode(downloaded)).toBe("Hello WebDAV world\n");
});

test("created subdirectory appears on the server", async () => {
  let root = account.rootDirs.first;
  await root.createSubDirectory("subdir");

  let serverListing = await verify.getDirectoryContents("/") as webdavClient.FileStat[];
  let subStat = serverListing.find(s => s.basename == "subdir");
  expect(subStat).toBeDefined();
  expect(subStat!.type).toBe("directory");

  await root.listContents();
  let sub = root.subDirs.find(d => d.name == "subdir");
  expect(sub).toBeDefined();
  expect(sub.path).toBe("/subdir/");
});

test("move file across directories is reflected on the server", async () => {
  let root = account.rootDirs.first;
  await root.listContents();
  let file = root.files.find(f => f.name == "hello.txt");
  expect(file).toBeDefined();
  let sub = root.subDirs.find(d => d.name == "subdir");
  expect(sub).toBeDefined();

  await sub.moveFilesHere(new ArrayColl([file]));

  let rootOnServer = await verify.getDirectoryContents("/") as webdavClient.FileStat[];
  let subOnServer = await verify.getDirectoryContents("/subdir") as webdavClient.FileStat[];
  expect(rootOnServer.map(s => s.basename)).not.toContain("hello.txt");
  expect(subOnServer.map(s => s.basename)).toContain("hello.txt");
});

test("copy file across directories is reflected on the server", async () => {
  let root = account.rootDirs.first;
  await root.listContents();
  let sub = root.subDirs.find(d => d.name == "subdir");
  await sub.listContents();
  let file = sub.files.find(f => f.name == "hello.txt");
  expect(file).toBeDefined();

  await root.copyFilesHere(new ArrayColl([file]));

  let rootOnServer = await verify.getDirectoryContents("/") as webdavClient.FileStat[];
  let subOnServer = await verify.getDirectoryContents("/subdir") as webdavClient.FileStat[];
  expect(rootOnServer.map(s => s.basename)).toContain("hello.txt");
  expect(subOnServer.map(s => s.basename)).toContain("hello.txt");
});

test("saveContents overwrites bytes on the server", async () => {
  let root = account.rootDirs.first;
  await root.listContents();
  let file = root.files.find(f => f.name == "hello.txt");
  expect(file).toBeDefined();
  await file.saveContents(new Blob([new TextEncoder().encode("Replaced contents\n")],
                                    { type: "text/plain" }));

  let bytes = await verify.getFileContents("/hello.txt", { format: "binary" }) as ArrayBuffer;
  expect(new TextDecoder().decode(new Uint8Array(bytes))).toBe("Replaced contents\n");
});

test("deleteIt removes file from the server", async () => {
  let root = account.rootDirs.first;
  await root.listContents();
  let file = root.files.find(f => f.name == "hello.txt");
  expect(file).toBeDefined();
  await file.deleteIt();

  let onServer = await verify.getDirectoryContents("/") as webdavClient.FileStat[];
  expect(onServer.map(s => s.basename)).not.toContain("hello.txt");
});

test("Open in app, after the file changed on the server, opens the new version", async () => {
  let root = account.rootDirs.first;
  await verify.putFileContents("/open.txt", "Version 1\n");
  await root.listContents();
  let file = root.files.find(f => f.name == "open.txt");
  expect(file).toBeDefined();

  await file.openOSApp();
  expect(openedFiles.pop()).toEqual({ path: file.filepathLocal, contents: "Version 1\n" });

  // E.g. edited in the cloud app, or on another device
  await verify.putFileContents("/open.txt", "Version 2, edited elsewhere\n");
  await root.listContents();

  await file.openOSApp();
  let opened = openedFiles.pop();
  expect(opened.path).toBeTruthy();
  expect(opened.path).toBe(file.filepathLocal);
  expect(opened.contents).toBe("Version 2, edited elsewhere\n");
  // Not edited locally, so no conflicted copy
  let localFiles = await fs.readdir(path.dirname(opened.path));
  expect(localFiles.filter(name => name.startsWith("open"))).toEqual(["open.txt"]);
});

test("Local edits are kept and uploaded as conflicted copy, when the file changed on the server", async () => {
  let root = account.rootDirs.first;
  await verify.putFileContents("/kept.txt", "Version 1\n");
  await root.listContents();
  let file = root.files.find(f => f.name == "kept.txt");
  await file.openOSApp();
  let localPath = openedFiles.pop().path;

  // The user edits the file in the desktop app
  await fs.writeFile(localPath, "Edited locally\n");
  let editTime = new Date(file.lastMod.getTime() + 60 * 1000);
  await fs.utimes(localPath, editTime, editTime);

  await verify.putFileContents("/kept.txt", "Version 2, edited elsewhere\n");
  await root.listContents();

  await file.openOSApp();
  expect(openedFiles.pop()).toEqual({ path: localPath, contents: "Version 2, edited elsewhere\n" });

  // The upload runs in the background
  let copy = await vi.waitFor(() => {
    let copy = root.files.find(f => f.path.startsWith("/kept ("));
    expect(copy).toBeDefined();
    return copy;
  });
  expect(copy.path).toMatch(/^\/kept \(conflicted copy \d{4}-\d\d-\d\d \d\d-\d\d-\d\d\)\.txt$/);
  let onServer = await verify.getFileContents(copy.path, { format: "text" });
  expect(onServer).toBe("Edited locally\n");
  // The renamed local file is the local copy of the uploaded conflicted copy
  expect(path.dirname(copy.filepathLocal)).toBe(path.dirname(localPath));
  expect(await fs.readFile(copy.filepathLocal, "utf8")).toBe("Edited locally\n");
  let localFiles = await fs.readdir(path.dirname(localPath));
  expect(localFiles.filter(name => name.startsWith("kept")).length).toBe(2);
});

test("Open in app checks the new contents of a file changed on the server", async () => {
  let root = account.rootDirs.first;
  await verify.putFileContents("/notes.txt", "Just some notes\n");
  await root.listContents();
  let file = root.files.find(f => f.name == "notes.txt");
  await file.openOSApp();
  expect(openedFiles.pop().contents).toBe("Just some notes\n");

  await verify.putFileContents("/notes.txt", "#!/bin/sh\necho Now I am a script\n");
  await root.listContents();

  await expect(file.openOSApp()).rejects.toThrow(/script/);
  expect(openedFiles.length).toBe(0);
});

test("Refresh doesn't upload a file that was only downloaded", async () => {
  let root = account.rootDirs.first;
  await verify.putFileContents("/downloaded.txt", "From the server\n");
  // Older than the download, as files on a server usually are
  let lastModOnServer = new Date("2025-01-02T03:04:05Z");
  await fs.utimes(path.join(storageDir, "downloaded.txt"), lastModOnServer, lastModOnServer);
  await root.listContents();
  let file = root.files.find(f => f.name == "downloaded.txt");
  await file.download();

  await root.uploadChangedFiles();

  let stat = await verify.stat("/downloaded.txt") as webdavClient.FileStat;
  expect(new Date(stat.lastmod).getTime()).toBe(lastModOnServer.getTime());
});

test("Refresh uploads a downloaded file that was changed on disk", async () => {
  let root = account.rootDirs.first;
  await verify.putFileContents("/edited.txt", "From the server\n");
  let lastModOnServer = new Date("2025-01-02T03:04:05Z");
  await fs.utimes(path.join(storageDir, "edited.txt"), lastModOnServer, lastModOnServer);
  await root.listContents();
  let file = root.files.find(f => f.name == "edited.txt");
  await file.download();

  // E.g. edited in a desktop app
  await fs.writeFile(file.filepathLocal, "Changed on disk\n");
  await root.uploadChangedFiles();

  expect(await verify.getFileContents("/edited.txt", { format: "text" })).toBe("Changed on disk\n");
});
