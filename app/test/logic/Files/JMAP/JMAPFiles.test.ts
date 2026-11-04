import { appGlobal } from "../../../../logic/app";
import { JMAPFileAccount } from "../../../../logic/Files/JMAP/JMAPFileAccount";
import type { JMAPFile } from "../../../../logic/Files/JMAP/JMAPFile";
import type { JMAPDirectory } from "../../../../logic/Files/JMAP/JMAPDirectory";
import { DummyFileStorage } from "../../../../logic/Files/Store/DummyFileStorage";
import { FakeFileNodeServer } from "./fakeFileNodeServer";
import { ArrayColl } from "svelte-collections";
import { mkdtempSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

const tempDir = mkdtempSync(path.join(tmpdir(), "mustang-jmap-files-"));
/** Simulates another app that has the file open, and Windows, which then doesn't let us change it */
const lockedPaths = new Set<string>();
function lockedError(): Error {
  return Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
}
appGlobal.remoteApp = {
  kyCreate: () => { throw new Error("The test should not talk to a real server") },
  getFilesDir: async () => tempDir,
  // Like JPC, which turns the backend's ArrayBuffer into a Uint8Array
  readFile: async (filepath: string) => new Uint8Array(await fsPromises.readFile(filepath)),
  writeFile: async (filepath: string, permissions: number, contents: Uint8Array) => {
    if (lockedPaths.has(filepath)) {
      throw lockedError();
    }
    await fsPromises.rm(filepath, { force: true });
    await fsPromises.writeFile(filepath, contents, { mode: permissions });
  },
  deleteFile: async (filepath: string) => await fsPromises.unlink(filepath),
  statFile: async (filepath: string) => {
    let s = await fsPromises.stat(filepath);
    return { size: s.size, lastMod: s.mtime };
  },
  fs: {
    ...fsPromises,
    rename: async (from: string, to: string) => {
      if (lockedPaths.has(from)) {
        throw lockedError();
      }
      await fsPromises.rename(from, to);
    },
  },
  path: { dirname: path.dirname, join: path.join },
} as any;

async function setup(serverOptions: Partial<FakeFileNodeServer> = {}) {
  let server = new FakeFileNodeServer();
  Object.assign(server, serverOptions);
  let jmapAccount = server.newAccount();
  let files = new JMAPFileAccount();
  files.storage = new DummyFileStorage();
  files.initFromMainAccount(jmapAccount);
  let errors: Error[] = [];
  files.errorCallback = ex => errors.push(ex);
  files.dataError = ex => errors.push(ex);
  appGlobal.fileSharingAccounts.add(files);
  return { server, jmapAccount, files, errors };
}

/** A server with `/Docs/a.txt` */
async function setupWithFile(serverOptions: Partial<FakeFileNodeServer> = {}) {
  let { server, jmapAccount, files, errors } = await setup(serverOptions);
  let docsID = server.addDirectory("Docs");
  let fileID = server.addFile("a.txt", "original", docsID);
  await files.sync();
  let docs = files.rootDir.subDirs.find(dir => dir.nodeID == docsID);
  await docs.listContents();
  let file = docs.files.find(file => file.nodeID == fileID);
  return { server, jmapAccount, files, errors, docs, docsID, file, fileID };
}

function accountDir(files: JMAPFileAccount): string {
  return `${tempDir}/files/cloud/${files.id}`;
}

async function readDisk(filepath: string): Promise<string> {
  return await fsPromises.readFile(filepath, "utf-8");
}

/** The user changed the file in another app */
async function editOnDisk(file: JMAPFile, contents: string, lastMod = new Date(2026, 9, 21, 14, 3, 59)) {
  await fsPromises.writeFile(file.filepathLocal, contents);
  await fsPromises.utimes(file.filepathLocal, lastMod, lastMod);
}

/** As in the names of the conflict copies: YY-MM-DD-HH-MM-SS, in local time */
function stamp(date: Date): string {
  return [date.getFullYear() % 100, date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()]
    .map(number => String(number).padStart(2, "0"))
    .join("-");
}

function setCalls(server: FakeFileNodeServer): Record<string, any>[] {
  return server.calls.filter(([method]) => method == "FileNode/set").map(([, args]) => args);
}

function callsOf(server: FakeFileNodeServer, method: string): Record<string, any>[] {
  return server.calls.filter(([name]) => name == method).map(([, args]) => args);
}

/** More rounds than any real listing or sync needs. A client that goes on longer is stuck. */
const kSaneMaxRounds = 10000;

test("Lists the top level nodes and the contents of a directory, in pages", async () => {
  let { server, files, errors } = await setup();
  let docsID = server.addDirectory("Docs");
  server.addDirectory("Photos");
  server.addFile("top.txt", "top");
  for (let name of ["1.txt", "2.txt", "3.txt", "4.txt"]) {
    server.addFile(name, name, docsID);
  }
  server.addDirectory("Sub", docsID);

  await files.sync();
  expect(files.rootDir.path).toBe("/");
  expect(files.rootDir.subDirs.contents.map(dir => dir.name).sort()).toEqual(["Docs", "Photos"]);
  expect(files.rootDir.files.contents.map(file => file.name)).toEqual(["top.txt"]);
  expect(files.jmapAccount.syncState.get("FileNode")).toBe("s" + server.state);

  let docs = files.rootDir.subDirs.find(dir => dir.name == "Docs");
  await docs.listContents();
  expect(docs.path).toBe("/Docs/");
  expect(docs.files.contents.map(file => file.path).sort()).toEqual(["/Docs/1.txt", "/Docs/2.txt", "/Docs/3.txt", "/Docs/4.txt"]);
  expect(docs.subDirs.contents.map(dir => dir.path)).toEqual(["/Docs/Sub/"]);
  expect(docs.files.first.mimetype).toBe("text/plain");
  expect(docs.files.first.size).toBe(5);
  expect(server.calls.filter(([method]) => method == "FileNode/query").length).toBeGreaterThan(2); // maxObjectsInGet is 3
  expect(errors).toEqual([]);
});

/** A server with `/Docs/` that has 4 files, and whose page size is 3 */
async function setupWithDirectory() {
  let { server, files, errors } = await setup();
  let docsID = server.addDirectory("Docs");
  let fileIDs = ["1.txt", "2.txt", "3.txt", "4.txt"].map(name => server.addFile(name, name, docsID));
  await files.sync();
  let docs = files.rootDir.subDirs.find(dir => dir.nodeID == docsID);
  let queries = () => callsOf(server, "FileNode/query").filter(args => args.filter?.parentId == docsID);
  return { server, files, errors, docs, docsID, fileIDs, queries };
}

test("A server that keeps listing the same files is stopped, and that is reported", async () => {
  let { server, errors, docs, docsID, fileIDs, queries } = await setupWithDirectory();
  server.changeResponse = (method, args, response) => {
    if (method == "FileNode/query" && args.filter?.parentId == docsID) {
      // Ignores the position, and claims that there are more
      response.ids = fileIDs.slice(0, 3);
      response.total = 100;
    }
  };

  await docs.listContents();
  expect(queries().length).toBeLessThanOrEqual(3);
  expect(errors.length).toBe(1);
});

test("A server that keeps listing more files is stopped, and that is reported", async () => {
  let { server, errors, docs, docsID, queries } = await setupWithDirectory();
  let nextID = 1;
  server.changeResponse = (method, args, response) => {
    if (method == "FileNode/query" && args.filter?.parentId == docsID) {
      // Other IDs on each page, and always a full page, without an end
      response.ids = [1, 2, 3].map(() => "endless" + nextID++);
      delete response.total;
    }
  };

  await docs.listContents();
  expect(queries().length).toBeGreaterThan(1);
  expect(queries().length).toBeLessThanOrEqual(kSaneMaxRounds);
  expect(errors.length).toBe(1);
});

test("Ignores symbolic links", async () => {
  let { server, files, errors } = await setup();
  server.nodes.set("link", { "@type": "SymLink", id: "link", parentId: null, name: "link", target: ["x"], modified: "2026-10-01T10:00:00.000Z" });
  server.addFile("top.txt", "top");
  await files.sync();
  expect(files.rootDir.files.contents.map(file => file.name)).toEqual(["top.txt"]);
  expect(files.rootDir.subDirs.isEmpty).toBe(true);
  expect(errors).toEqual([]);
});

test("Reads and writes draft -14 of FileNode, like Stalwart", async () => {
  let { server, docs, file, errors } = await setupWithFile({ draft14: true });
  expect(file.name).toBe("a.txt");
  expect(file.mimetype).toBe("text/plain");

  let sub = await docs.createSubDirectory("New");
  expect(server.nodes.get(sub.nodeID)["@type"]).toBe("Directory");
  let browserFile = docs.newFile("b.txt");
  browserFile.fromBrowserFile(new globalThis.File(["new file"], "b.txt", { type: "text/plain" }));
  await docs.addFile(browserFile);
  let created = server.find("b.txt", docs.nodeID);
  expect(created.mediaType).toBe("text/plain");
  expect(setCalls(server).flatMap(args => Object.values(args.create ?? {}))).toEqual([
    { nodeType: "directory", name: "New", parentId: docs.nodeID },
    expect.objectContaining({ nodeType: "file", type: "text/plain", name: "b.txt" }),
  ]);
  expect(errors).toEqual([]);
});

test("Writes draft -18 of FileNode", async () => {
  let { server, docs, errors } = await setupWithFile();
  await docs.createSubDirectory("New");
  expect(setCalls(server)[0].create).toEqual({ dir: { "@type": "Directory", name: "New", parentId: docs.nodeID } });
  expect(errors).toEqual([]);
});

test("Downloads a file to disk, with the modification time from the server", async () => {
  let { file, files, errors } = await setupWithFile();
  await file.download();
  expect(file.filepathLocal).toBe(`${accountDir(files)}/Docs/a.txt`);
  expect(await readDisk(file.filepathLocal)).toBe("original");
  expect((await fsPromises.stat(file.filepathLocal)).mtime.toISOString()).toBe("2026-10-01T10:00:00.000Z");
  expect(await file.isLocalFileChanged()).toBe(false);
  expect(await file.contents.text()).toBe("original");
  expect(errors).toEqual([]);
});

test("When the file changes on the server, the push notification updates the file on disk", async () => {
  let { server, jmapAccount, file, errors } = await setupWithFile();
  await file.download();
  server.changeFile(file.nodeID, "changed on server", "2026-10-20T08:00:00.000Z");

  await jmapAccount.sync("FileNode", "s" + server.state);
  expect(await readDisk(file.filepathLocal)).toBe("changed on server");
  expect((await fsPromises.stat(file.filepathLocal)).mtime.toISOString()).toBe("2026-10-20T08:00:00.000Z");
  expect(await file.isLocalFileChanged()).toBe(false);
  expect(file.lastModOnServer.toISOString()).toBe("2026-10-20T08:00:00.000Z");
  expect(setCalls(server)).toEqual([]);
  expect(errors).toEqual([]);
});

test("A change on disk is uploaded, only if the file on the server is unchanged", async () => {
  let { server, files, file, fileID, errors } = await setupWithFile();
  await file.download();
  let oldBlobID = server.nodes.get(fileID).blobId;
  await editOnDisk(file, "changed on disk");

  await files.syncLocalCopies();
  expect(server.contents(fileID)).toBe("changed on disk");
  expect(server.nodes.get(fileID).modified).toBe(new Date(2026, 9, 21, 14, 3, 59).toISOString());
  expect(setCalls(server)[0].ifUnchangedBy).toEqual({ [fileID]: { blobId: oldBlobID } });
  expect(file.blobID).toBe(server.nodes.get(fileID).blobId);
  expect(await file.isLocalFileChanged()).toBe(false);

  await files.syncLocalCopies(); // Nothing to do
  expect(setCalls(server).length).toBe(1);
  expect(errors).toEqual([]);
});

test("save() uploads the change on disk", async () => {
  let { server, file, fileID, errors } = await setupWithFile();
  await file.download();
  await editOnDisk(file, "changed on disk");

  await file.save();
  expect(server.contents(fileID)).toBe("changed on disk");
  expect(server.nodes.get(fileID).name).toBe("a.txt");
  expect(errors).toEqual([]);
});

test("Without draft-ietf-jmap-conditional, `ifInState` guards the upload, and we try again when other files changed", async () => {
  let { server, files, file, fileID, errors } = await setupWithFile({ conditional: false });
  let otherID = server.addFile("other.txt", "other");
  await file.download();
  await editOnDisk(file, "changed on disk");
  let otherClient = true;
  server.beforeSet = () => {
    if (otherClient) {
      server.changeFile(otherID, "changed by somebody else");
      otherClient = false;
    }
  };

  await files.syncLocalCopies();
  expect(server.contents(fileID)).toBe("changed on disk");
  expect(setCalls(server).map(args => !!args.ifInState)).toEqual([true, true]);
  expect(setCalls(server).some(args => args.ifUnchangedBy)).toBe(false);
  expect(errors).toEqual([]);
});

test("Without draft-ietf-jmap-conditional, when other files change before each upload, we stop after a few tries, and report it", async () => {
  let { server, files, file, fileID, errors } = await setupWithFile({ conditional: false });
  let otherID = server.addFile("other.txt", "other");
  await file.download();
  await editOnDisk(file, "changed on disk");
  server.beforeSet = () => server.changeFile(otherID, "changed by somebody else");

  await files.syncLocalCopies();
  expect(server.contents(fileID)).toBe("original");
  expect(await readDisk(file.filepathLocal)).toBe("changed on disk");
  expect(setCalls(server).length).toBeGreaterThan(1);
  // More than a real server needs. A client that tries more often is stuck.
  expect(setCalls(server).length).toBeLessThanOrEqual(20);
  expect(errors.length).toBe(1);
});

test("Both changed: the file on disk is renamed to -modified-, and gets the server version. Both are on the server.", async () => {
  let { server, files, docs, file, fileID, errors } = await setupWithFile();
  await file.download();
  let originalPath = file.filepathLocal;
  let localDate = new Date(2026, 9, 21, 14, 3, 59);
  await editOnDisk(file, "my version", localDate);
  server.changeFile(fileID, "their version");

  await files.fetchChanges();
  let modifiedName = `a-modified-${stamp(localDate)}.txt`;
  expect(modifiedName).toBe("a-modified-26-10-21-14-03-59.txt");
  expect(await readDisk(originalPath)).toBe("their version");
  expect(await readDisk(path.join(path.dirname(originalPath), modifiedName))).toBe("my version");
  expect(server.contents(fileID)).toBe("their version");
  let copy = server.find(modifiedName, docs.nodeID);
  expect(server.contents(copy.id)).toBe("my version");
  expect(docs.files.contents.map(file => file.name).sort()).toEqual([modifiedName, "a.txt"]);
  let localCopy = docs.files.find(file => file.name == modifiedName);
  expect(localCopy.nodeID).toBe(copy.id);
  expect(await localCopy.isLocalFileChanged()).toBe(false);
  expect(await file.isLocalFileChanged()).toBe(false);

  await files.syncLocalCopies(); // Settled
  expect(setCalls(server).length).toBe(1);
  expect(errors).toEqual([]);
});

test("Both made the same change: No conflict", async () => {
  let { server, files, docs, file, fileID, errors } = await setupWithFile();
  await file.download();
  await editOnDisk(file, "same change");
  server.changeFile(fileID, "same change");

  await files.fetchChanges();
  expect(docs.files.length).toBe(1);
  expect(setCalls(server)).toEqual([]);
  expect(await file.isLocalFileChanged()).toBe(false);
  expect(errors).toEqual([]);
});

test("Both changed, and another app has the file locked: The server version goes into -server-, and the user's version is uploaded", async () => {
  let { server, files, docs, file, fileID, errors } = await setupWithFile();
  await file.download();
  let originalPath = file.filepathLocal;
  await editOnDisk(file, "my version");
  let serverDate = new Date(2026, 9, 20, 9, 8, 7);
  server.changeFile(fileID, "their version", serverDate.toISOString());
  let theirBlobID = server.nodes.get(fileID).blobId;
  lockedPaths.add(originalPath);
  try {
    await files.fetchChanges();
  } finally {
    lockedPaths.delete(originalPath);
  }

  let serverName = `a-server-${stamp(serverDate)}.txt`;
  expect(await readDisk(originalPath)).toBe("my version");
  expect(await readDisk(path.join(path.dirname(originalPath), serverName))).toBe("their version");
  expect(server.contents(fileID)).toBe("my version");
  let copy = server.find(serverName, docs.nodeID);
  expect(copy.blobId).toBe(theirBlobID); // no upload needed
  expect(docs.files.contents.map(file => file.name).sort()).toEqual([serverName, "a.txt"]);
  expect(await file.isLocalFileChanged()).toBe(false);
  expect(errors).toEqual([]);
});

test("Both keep changing, and another app has the file locked: We stop after a few rounds, report it, and keep the user's version", async () => {
  let { server, files, file, fileID, errors } = await setupWithFile();
  await file.download();
  let originalPath = file.filepathLocal;
  await editOnDisk(file, "my version");
  let change = 0;
  server.beforeSet = () => {
    change++;
    server.changeFile(fileID, "their version " + change, new Date(2026, 9, 20, 9, 8, change).toISOString());
  };
  lockedPaths.add(originalPath);
  try {
    await files.syncLocalCopies();
  } finally {
    lockedPaths.delete(originalPath);
  }

  expect(await readDisk(originalPath)).toBe("my version");
  expect(setCalls(server).length).toBeGreaterThan(1);
  // More than a real server needs. A client that tries more often is stuck.
  expect(setCalls(server).length).toBeLessThanOrEqual(20);
  expect(errors.length).toBe(1);
});

test("While another app has the file locked, a change on the server waits", async () => {
  let { server, files, file, fileID, errors } = await setupWithFile();
  await file.download();
  server.changeFile(fileID, "changed on server");
  let downloads = 0;
  let downloadBlob = files.jmapAccount.downloadBlob;
  files.jmapAccount.downloadBlob = async (...args) => {
    downloads++;
    return await downloadBlob(...args);
  };
  lockedPaths.add(file.filepathLocal);
  try {
    await files.fetchChanges();
    await files.syncLocalCopies();
    expect(await readDisk(file.filepathLocal)).toBe("original");
  } finally {
    lockedPaths.delete(file.filepathLocal);
  }
  await files.syncLocalCopies();
  expect(await readDisk(file.filepathLocal)).toBe("changed on server");
  expect(downloads).toBe(1);
  expect(errors).toEqual([]);
});

test("Deleted on the server, but changed on disk: The user's version is kept as -modified- file", async () => {
  let { server, files, docs, file, fileID, errors } = await setupWithFile();
  await file.download();
  let localDate = new Date(2026, 9, 21, 14, 3, 59);
  await editOnDisk(file, "my version", localDate);
  server.destroy(fileID);

  await files.fetchChanges();
  let modifiedName = `a-modified-${stamp(localDate)}.txt`;
  let copy = server.find(modifiedName, docs.nodeID);
  expect(server.contents(copy.id)).toBe("my version");
  expect(docs.files.contents.map(file => file.name)).toEqual([modifiedName]);
  expect(docs.files.first.filepathLocal).toBe(`${accountDir(files)}/Docs/${modifiedName}`);
  expect(await readDisk(docs.files.first.filepathLocal)).toBe("my version");
  expect(errors).toEqual([]);
});

test("A directory deleted on the server keeps the files that the user changed, in its parent", async () => {
  let { server, files, docs, docsID, file, errors } = await setupWithFile();
  await file.download();
  await editOnDisk(file, "my version");
  server.destroy(docsID);

  await files.fetchChanges();
  expect(files.rootDir.subDirs.contents).toEqual([]);
  let copy = [...server.nodes.values()].find(node => node.name.startsWith("a-modified-"));
  expect(copy.parentId).toBe(null);
  expect(server.contents(copy.id)).toBe("my version");
  expect(files.rootDir.files.contents.map(file => file.name)).toEqual([copy.name]);
  expect(files.rootDir.files.first.filepathLocal).toBe(`${accountDir(files)}/${copy.name}`);
  expect(await readDisk(files.rootDir.files.first.filepathLocal)).toBe("my version");
  await expect(fsPromises.stat(`${accountDir(files)}/Docs`)).rejects.toThrow(); // The empty directory on disk is gone too
  expect(errors).toEqual([]);
});

test("Deleted on the server, unchanged on disk: Deleted on disk too", async () => {
  let { server, files, docs, file, fileID, errors } = await setupWithFile();
  await file.download();
  let filepath = file.filepathLocal;
  server.destroy(fileID);

  await files.fetchChanges();
  expect(docs.files.isEmpty).toBe(true);
  await expect(fsPromises.stat(filepath)).rejects.toThrow();
  expect(setCalls(server)).toEqual([]);
  expect(errors).toEqual([]);
});

test("The user deleted the file on disk: It's only our copy, so it stays on the server", async () => {
  let { server, files, file, fileID, errors } = await setupWithFile();
  await file.download();
  await fsPromises.unlink(file.filepathLocal);

  await files.syncLocalCopies();
  expect(file.filepathLocal).toBe(null);
  expect(server.nodes.has(fileID)).toBe(true);
  expect(errors).toEqual([]);
});

test("The files on disk have the same paths as on the server", async () => {
  let { server, files, docs, docsID, file, errors } = await setupWithFile();
  let subID = server.addDirectory("Sub", docsID);
  server.addFile("deep.txt", "deep", subID);
  server.addFile("top.txt", "top");
  await files.rootDir.listContents();
  await docs.listContents();
  let sub = docs.subDirs.find(dir => dir.nodeID == subID);
  await sub.listContents();
  let deep = sub.files.first;
  let top = files.rootDir.files.first;

  for (let each of [file, deep, top]) {
    await each.download();
  }
  expect(file.filepathLocal).toBe(`${accountDir(files)}/Docs/a.txt`);
  expect(deep.filepathLocal).toBe(`${accountDir(files)}/Docs/Sub/deep.txt`);
  expect(top.filepathLocal).toBe(`${accountDir(files)}/top.txt`);
  expect(await readDisk(deep.filepathLocal)).toBe("deep");
  expect(errors).toEqual([]);
});

test("Names that are the same on disk, after sanitizing or because the name is already taken, get a number", async () => {
  let { server, files, docs, docsID, errors } = await setupWithFile();
  // `?` and `*` are not allowed on Windows
  let firstID = server.addFile("Report?.txt", "first", docsID);
  let secondID = server.addFile("Report*.txt", "second", docsID);
  let thirdID = server.addFile("b.txt", "ours", docsID);
  await docs.listContents();
  let first = docs.files.find(file => file.nodeID == firstID);
  let second = docs.files.find(file => file.nodeID == secondID);
  let third = docs.files.find(file => file.nodeID == thirdID);
  await fsPromises.mkdir(`${accountDir(files)}/Docs`, { recursive: true });
  await fsPromises.writeFile(`${accountDir(files)}/Docs/b.txt`, "not ours"); // e.g. another app saved it there

  for (let each of [first, second, third]) {
    await each.download();
  }
  let unnumbered = [first, second].find(file => !file.filepathLocal.endsWith("-1.txt")).filepathLocal;
  expect(path.dirname(unnumbered)).toBe(`${accountDir(files)}/Docs`);
  expect([first.filepathLocal, second.filepathLocal]).toContain(unnumbered.replace(/\.txt$/, "-1.txt"));
  expect(await readDisk(first.filepathLocal)).toBe("first");
  expect(await readDisk(second.filepathLocal)).toBe("second");
  expect(third.filepathLocal).toBe(`${accountDir(files)}/Docs/b-1.txt`);
  expect(await readDisk(third.filepathLocal)).toBe("ours");
  expect(await readDisk(`${accountDir(files)}/Docs/b.txt`)).toBe("not ours");

  let paths = [first, second, third].map(file => file.filepathLocal);
  await files.syncLocalCopies(); // The numbered files stay where they are
  expect([first, second, third].map(file => file.filepathLocal)).toEqual(paths);
  expect(errors).toEqual([]);
});

test("A rename on the server, or in our app, moves the file on disk", async () => {
  let { server, files, file, fileID, errors } = await setupWithFile();
  await file.download();
  let oldPath = file.filepathLocal;
  server.update(fileID, { name: "b.txt" });

  await files.fetchChanges();
  expect(file.filepathLocal).toBe(`${accountDir(files)}/Docs/b.txt`);
  expect(await readDisk(file.filepathLocal)).toBe("original");
  await expect(fsPromises.stat(oldPath)).rejects.toThrow();
  expect(await file.isLocalFileChanged()).toBe(false);

  await file.rename("c.txt");
  await files.syncLocalCopies();
  expect(file.filepathLocal).toBe(`${accountDir(files)}/Docs/c.txt`);
  expect(await readDisk(file.filepathLocal)).toBe("original");
  expect(setCalls(server).filter(args => !args.update?.[fileID]?.name)).toEqual([]); // Only our rename, no upload
  expect(errors).toEqual([]);
});

test("A rename or move of a directory on the server moves the files in it on disk", async () => {
  let { server, files, docs, docsID, errors } = await setupWithFile();
  let subID = server.addDirectory("Sub", docsID);
  server.addFile("deep.txt", "deep", subID);
  await docs.listContents();
  let sub = docs.subDirs.find(dir => dir.nodeID == subID);
  await sub.listContents();
  let deep = sub.files.first;
  await deep.download();
  expect(deep.filepathLocal).toBe(`${accountDir(files)}/Docs/Sub/deep.txt`);

  server.update(docsID, { name: "Documents" });
  await files.fetchChanges();
  expect(deep.filepathLocal).toBe(`${accountDir(files)}/Documents/Sub/deep.txt`);
  expect(await readDisk(deep.filepathLocal)).toBe("deep");
  await expect(fsPromises.stat(`${accountDir(files)}/Docs`)).rejects.toThrow(); // The empty directories are gone

  let otherID = server.addDirectory("Other");
  server.update(subID, { parentId: otherID });
  await files.fetchChanges();
  expect(deep.filepathLocal).toBe(`${accountDir(files)}/Other/Sub/deep.txt`);
  expect(await readDisk(deep.filepathLocal)).toBe("deep");
  expect(await deep.isLocalFileChanged()).toBe(false);
  expect(setCalls(server)).toEqual([]);
  expect(errors).toEqual([]);
});

test("While another app has the file locked, it moves on disk in a later round, and the sync goes on where it is", async () => {
  let { server, files, file, fileID, errors } = await setupWithFile();
  await file.download();
  let oldPath = file.filepathLocal;
  server.update(fileID, { name: "b.txt" });
  lockedPaths.add(oldPath);
  try {
    await files.fetchChanges();
    expect(file.filepathLocal).toBe(oldPath);
    await editOnDisk(file, "changed on disk");
    await files.syncLocalCopies();
    expect(file.filepathLocal).toBe(oldPath);
    expect(server.contents(fileID)).toBe("changed on disk");
  } finally {
    lockedPaths.delete(oldPath);
  }

  await files.syncLocalCopies();
  expect(file.filepathLocal).toBe(`${accountDir(files)}/Docs/b.txt`);
  expect(await readDisk(file.filepathLocal)).toBe("changed on disk");
  await expect(fsPromises.stat(oldPath)).rejects.toThrow();
  expect(await file.isLocalFileChanged()).toBe(false);
  expect(errors).toEqual([]);
});

test("A conflict copy whose name is already taken on disk gets a number", async () => {
  let { server, files, docs, file, fileID, errors } = await setupWithFile();
  await file.download();
  let localDate = new Date(2026, 9, 21, 14, 3, 59);
  let takenPath = `${accountDir(files)}/Docs/a-modified-${stamp(localDate)}.txt`;
  await fsPromises.writeFile(takenPath, "not ours");
  await editOnDisk(file, "my version", localDate);
  server.changeFile(fileID, "their version");

  await files.fetchChanges();
  let copy = docs.files.find(file => file.name.startsWith("a-modified-"));
  expect(copy.filepathLocal).toBe(takenPath.replace(/\.txt$/, "-1.txt"));
  expect(await readDisk(copy.filepathLocal)).toBe("my version");
  expect(await readDisk(takenPath)).toBe("not ours");
  expect(await readDisk(file.filepathLocal)).toBe("their version");
  expect(errors).toEqual([]);
});

test("A file that vanished from a directory listing was moved, not deleted", async () => {
  let { server, docs, file, fileID, errors } = await setupWithFile();
  await file.download();
  let filepath = file.filepathLocal;
  let otherID = server.addDirectory("Other");
  let deepID = server.addDirectory("Deep", otherID);
  server.update(fileID, { parentId: deepID });

  await docs.listContents();
  expect(docs.files.isEmpty).toBe(true);
  expect(file.parent.nodeID).toBe(deepID);
  expect(file.path).toBe("/Other/Deep/a.txt");
  expect(file.filepathLocal).toBe(filepath);
  expect(await readDisk(filepath)).toBe("original");
  expect(errors).toEqual([]);
});

test("Rename, move, copy and delete on the server", async () => {
  let { server, files, docs, file, fileID, errors } = await setupWithFile();
  let other = await files.rootDir.createSubDirectory("Other");
  expect(server.find("Other").id).toBe(other.nodeID);

  await file.rename("b.txt");
  expect(server.nodes.get(fileID).name).toBe("b.txt");
  expect(file.path).toBe("/Docs/b.txt");

  await docs.rename("Documents");
  expect(server.nodes.get(docs.nodeID).name).toBe("Documents");
  expect(file.path).toBe("/Documents/b.txt");

  await other.copyFilesHere(new ArrayColl([file]));
  let copy = server.find("b.txt", other.nodeID);
  expect(copy.blobId).toBe(server.nodes.get(fileID).blobId);
  expect(other.files.contents.map(file => file.nodeID)).toEqual([copy.id]);

  await other.copyFilesHere(new ArrayColl([file]));
  expect(other.files.contents.map(file => file.name).sort()).toEqual(["b (2).txt", "b.txt"]);

  await expect(other.moveFilesHere(new ArrayColl([file]))).rejects.toThrow(); // b.txt is taken
  expect(server.nodes.get(fileID).parentId).toBe(docs.nodeID);
  expect(docs.files.contents).toEqual([file]);

  let third = await files.rootDir.createSubDirectory("Third");
  await third.moveFilesHere(new ArrayColl([file]));
  expect(server.nodes.get(fileID).parentId).toBe(third.nodeID);
  expect(docs.files.isEmpty).toBe(true);
  expect(file.parent).toBe(third);
  expect(file.path).toBe("/Third/b.txt");

  await file.deleteIt();
  expect(server.nodes.has(fileID)).toBe(false);
  expect(third.files.contains(file)).toBe(false);

  await other.deleteIt();
  expect(server.nodes.has(other.nodeID)).toBe(false);
  expect(server.nodes.has(copy.id)).toBe(false);
  expect(files.rootDir.subDirs.contains(other)).toBe(false);
  expect(errors).toEqual([]);
});

test("A rename that the server rejects keeps the name", async () => {
  let { server, docs, file, fileID } = await setupWithFile();
  server.addFile("taken.txt", "x", docs.nodeID);
  await docs.listContents();
  await expect(file.rename("taken.txt")).rejects.toThrow();
  expect(file.name).toBe("a.txt");
  expect(server.nodes.get(fileID).name).toBe("a.txt");
});

test("Changes on the server move, rename and add nodes in the directories that we listed", async () => {
  let { server, files, docs, file, fileID, docsID, errors } = await setupWithFile();
  let newID = server.addFile("new.txt", "new", docsID);
  let subID = server.addDirectory("Sub", docsID);
  server.update(docsID, { name: "Documents" });
  server.update(fileID, { name: "renamed.txt", parentId: subID });

  await files.fetchChanges();
  expect(docs.name).toBe("Documents");
  expect(docs.files.contents.map(file => file.nodeID)).toEqual([newID]);
  let sub = docs.subDirs.find(dir => dir.nodeID == subID);
  expect(sub.files.contents).toEqual([file]);
  expect(file.path).toBe("/Documents/Sub/renamed.txt");
  expect(errors).toEqual([]);
});

test("When the server lost our sync state, we list again all directories that we know", async () => {
  let { server, files, docs, file, errors } = await setupWithFile();
  let newID = server.addFile("new.txt", "new", docs.nodeID);
  files.jmapAccount.syncState.set("FileNode", "s0");

  await files.fetchChanges();
  expect(docs.files.contents.map(file => file.nodeID).sort()).toEqual([file.nodeID, newID].sort());
  expect(files.jmapAccount.syncState.get("FileNode")).toBe("s" + server.state);
  expect(errors).toEqual([]);
});

test("A server that keeps reporting more changes, each time with a new state, is stopped, and that is reported", async () => {
  let { server, files, errors } = await setupWithFile();
  let state = 1000;
  server.changeResponse = (method, args, response) => {
    if (method == "FileNode/changes") {
      response.hasMoreChanges = true;
      response.newState = "s" + state++;
    }
  };

  await files.fetchChanges();
  expect(callsOf(server, "FileNode/changes").length).toBeGreaterThan(1);
  expect(callsOf(server, "FileNode/changes").length).toBeLessThanOrEqual(kSaneMaxRounds);
  expect(errors.length).toBe(1);
});

test("A server that keeps reporting more changes, without a new state, is stopped, and that is reported", async () => {
  let { server, files, errors } = await setupWithFile();
  server.changeResponse = (method, args, response) => {
    if (method == "FileNode/changes") {
      response.hasMoreChanges = true;
      response.newState = args.sinceState;
    }
  };

  await files.fetchChanges();
  expect(callsOf(server, "FileNode/changes").length).toBeLessThanOrEqual(3);
  expect(errors.length).toBe(1);
});

test("A server that makes a directory its own subdirectory doesn't break our tree", async () => {
  let { server, files, docs, docsID, errors } = await setupWithFile();
  let subID = server.addDirectory("Sub", docsID);
  await docs.listContents();
  server.update(docsID, { parentId: subID });

  await files.fetchChanges();
  expect(docs.parent).toBe(files.rootDir);
  expect(errors.length).toBe(1);
  expect(files.allDirectories().length).toBe(3);
});

test("The node ID and the state of the file on disk survive a restart", async () => {
  let { file } = await setupWithFile();
  await file.download();
  let json = JSON.parse(JSON.stringify(file.toExtraJSON()));
  let restored = file.parent.newFile("a.txt");
  restored.fromExtraJSON(json);
  expect(restored.nodeID).toBe(file.nodeID);
  expect(restored.localCopy).toEqual(file.localCopy);

  let dirJSON = JSON.parse(JSON.stringify(file.parent.toExtraJSON()));
  let restoredDir = file.parent.parent.newDirectory("Docs");
  restoredDir.fromExtraJSON(dirJSON);
  expect(restoredDir.nodeID).toBe(file.parent.nodeID);
});
