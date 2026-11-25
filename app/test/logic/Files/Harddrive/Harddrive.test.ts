/**
 * Tests for "My computer", i.e. the files on the user's own disk.
 *
 * The backend functions run directly in this process, and the special
 * directories (home, documents etc.) are in a temp directory, so the tests
 * never touch anything outside of it.
 *
 * Note: modules are dynamically imported inside beforeAll(), like in the
 * WebDAV test, because of circular imports in the module graph.
 */
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { afterAll, beforeAll, expect, test } from "vitest";

let tempDir: string;
let homeDir: string;
let docsDir: string;
let account: any; // HarddriveAccount
let documents: any; // HarddriveDirectory of `docsDir`
let ArrayColl: any;
/** Makes the next `fs.rename()` fail, like a move to another drive does */
let failNextRenameWith: string | null = null;

beforeAll(async () => {
  let app = await import("../../../../logic/app");
  let { HarddriveAccount } = await import("../../../../logic/Files/Harddrive/HarddriveAccount");
  ArrayColl = (await import("svelte-collections")).ArrayColl;

  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mustang-harddrive-test-"));
  homeDir = path.join(tempDir, "home");
  docsDir = path.join(homeDir, "Documents");
  let specialDirs = {
    home: homeDir,
    documents: docsDir,
    downloads: path.join(homeDir, "Downloads"),
    pictures: path.join(homeDir, "Pictures"),
  };
  for (let dir of Object.values(specialDirs)) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "readme.txt"), "Empty special directories are not shown\n");
  }

  app.appGlobal.remoteApp = {
    platform: () => "darwin", // Not Linux, so that there is no "Root" directory outside of the temp directory
    directory: (type: string) => specialDirs[type],
    async readFile(filepath: string): Promise<Uint8Array> {
      let fileHandle = await fs.open(filepath, "r");
      let contents = await fileHandle.readFile();
      await fileHandle.close();
      return new Uint8Array(contents.buffer, contents.byteOffset, contents.length);
    },
    deleteFile: (filepath: string) => fs.unlink(filepath),
    async listDirectoryContents(dirPath: string, withStats = true, includeHidden = false) {
      let files = [] as any[];
      let entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (let entry of entries) {
        if (!includeHidden && entry.name[0] == ".") {
          continue;
        }
        let file = {} as any;
        file.name = entry.name;
        file.path = path.join(entry.parentPath, entry.name);
        if (entry.isDirectory()) {
          file.isDirectory = true;
        } else if (entry.isFile()) {
          file.isDirectory = false;
        } else {
          continue;
        }
        if (withStats) {
          let stat = await fs.stat(file.path);
          file.size = stat.size;
          file.lastMod = stat.mtime;
        }
        files.push(file);
      }
      return files;
    },
    fs: {
      ...fs,
      async rename(from: string, to: string) {
        if (failNextRenameWith) {
          let ex = new Error(`${failNextRenameWith}: rename '${from}' -> '${to}'`) as any;
          ex.code = failNextRenameWith;
          failNextRenameWith = null;
          throw ex;
        }
        await fs.rename(from, to);
      },
    },
  };

  account = new HarddriveAccount();
  await account.sync();
  documents = account.rootDirs.find(dir => dir.path.replace(/\/$/, "") == docsDir);
});

afterAll(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

/** Creates a folder in Documents on disk, with these files in it,
 * and returns it, as listed by the app */
async function folderWith(name: string, files: Record<string, string> = {}): Promise<any> {
  let dirPath = path.join(docsDir, name);
  await fs.mkdir(dirPath);
  for (let [fileName, contents] of Object.entries(files)) {
    await fs.writeFile(path.join(dirPath, fileName), contents);
  }
  await documents.listContents();
  let dir = documents.subDirs.find(d => d.name == name);
  expect(dir).toBeDefined();
  await dir.listContents();
  return dir;
}

async function exists(filepath: string): Promise<boolean> {
  try {
    await fs.access(filepath);
    return true;
  } catch (ex) {
    return false;
  }
}

async function readText(file: any): Promise<string> {
  file.contents = null;
  await file.download();
  return await file.contents.text();
}

test("The special directories are shown, and their paths end with /", async () => {
  expect(documents).toBeDefined();
  let home = account.rootDirs.find(dir => dir.path.replace(/\/$/, "") == homeDir);
  expect(home).toBeDefined();
  for (let dir of account.rootDirs) {
    expect(dir.path.endsWith("/"), dir.path).toBe(true);
  }
});

test("Preview: The contents are a Blob, which gives a URL", async () => {
  let dir = await folderWith("Preview", { "hello.txt": "Hello disk\n" });
  let file = dir.files.find(f => f.name == "hello.txt");
  expect(file).toBeDefined();

  await file.download();
  expect(file.contents).toBeInstanceOf(Blob);
  expect(await file.contents.text()).toBe("Hello disk\n");
  expect(file.contents.type).toMatch(/^text\/plain/);
  expect(await file.getURL()).toMatch(/^blob:/);
});

test("Preview of an empty file is empty", async () => {
  let dir = await folderWith("Empty", { "empty.txt": "" });
  let file = dir.files.find(f => f.name == "empty.txt");
  await file.download();
  expect(file.contents.size).toBe(0);
});

test("New folder is created within the folder", async () => {
  let dir = await folderWith("Parent");
  let created = await dir.createSubDirectory("New Folder");

  expect((await fs.stat(path.join(docsDir, "Parent", "New Folder"))).isDirectory()).toBe(true);
  expect(await exists(path.join(docsDir, "ParentNew Folder"))).toBe(false);
  expect(dir.subDirs.contains(created)).toBe(true);
  await created.listContents();
  expect(created.files.isEmpty).toBe(true);
});

test("New folder with the name of an existing folder fails, and leaves the existing folder alone", async () => {
  let dir = await folderWith("Has existing");
  await dir.createSubDirectory("Existing");
  await fs.writeFile(path.join(docsDir, "Has existing", "Existing", "keep.txt"), "Keep me\n");

  await expect(dir.createSubDirectory("Existing")).rejects.toThrow();
  expect(await fs.readFile(path.join(docsDir, "Has existing", "Existing", "keep.txt"), "utf8")).toBe("Keep me\n");
});

test("Upload: A file from the OS is written into the folder, with its last modification time", async () => {
  let dir = await folderWith("Upload");
  let lastMod = new Date("2025-01-02T03:04:05Z");
  let browserFile = new globalThis.File(["Uploaded\n"], "upload.txt", { type: "text/plain", lastModified: lastMod.getTime() });
  let file = dir.newFile(browserFile.name);
  file.fromBrowserFile(browserFile);
  await dir.addFile(file);

  let onDisk = path.join(docsDir, "Upload", "upload.txt");
  expect(await fs.readFile(onDisk, "utf8")).toBe("Uploaded\n");
  expect(Math.floor((await fs.stat(onDisk)).mtime.getTime() / 1000)).toBe(lastMod.getTime() / 1000);
  expect(dir.files.find(f => f.name == "upload.txt")).toBeDefined();
});

test("Upload doesn't overwrite a file with the same name", async () => {
  let dir = await folderWith("Upload twice", { "same.txt": "Original\n" });
  let file = dir.newFile("same.txt");
  file.fromBrowserFile(new globalThis.File(["Replacement\n"], "same.txt"));

  await expect(dir.addFile(file)).rejects.toThrow();
  expect(await fs.readFile(path.join(docsDir, "Upload twice", "same.txt"), "utf8")).toBe("Original\n");
});

test("Upload of a file whose name is a path, e.g. from a hostile server, writes nothing outside the folder", async () => {
  let dir = await folderWith("Hostile");
  await dir.createSubDirectory("sub");
  for (let name of ["../escaped.txt", "sub/escaped.txt", "..\\escaped.txt", "..", ".", ""]) {
    let file = dir.newFile(name);
    file.contents = new Blob(["Evil\n"]);
    await expect(dir.addFile(file), name).rejects.toThrow();
  }
  expect(await exists(path.join(docsDir, "escaped.txt"))).toBe(false);
  expect(await exists(path.join(docsDir, "Hostile", "sub", "escaped.txt"))).toBe(false);
  expect(await fs.readdir(path.join(docsDir, "Hostile"))).toEqual(["sub"]);
});

test("Move a file to another folder", async () => {
  let source = await folderWith("Move source", { "move-me.txt": "Moving\n", "stay.txt": "Staying\n" });
  let target = await folderWith("Move target");
  let file = source.files.find(f => f.name == "move-me.txt");

  await target.moveFilesHere(new ArrayColl([file]));

  expect(await exists(path.join(docsDir, "Move source", "move-me.txt"))).toBe(false);
  expect(await fs.readFile(path.join(docsDir, "Move target", "move-me.txt"), "utf8")).toBe("Moving\n");
  expect(await fs.readFile(path.join(docsDir, "Move source", "stay.txt"), "utf8")).toBe("Staying\n");
  expect(source.files.find(f => f.name == "move-me.txt")).toBeUndefined();
  let moved = target.files.find(f => f.name == "move-me.txt");
  expect(moved).toBeDefined();
  expect(await readText(moved)).toBe("Moving\n");
});

test("Move doesn't overwrite a file with the same name", async () => {
  let source = await folderWith("Clash source", { "clash.txt": "From the source\n" });
  let target = await folderWith("Clash target", { "clash.txt": "Already in the target\n" });
  let file = source.files.find(f => f.name == "clash.txt");

  await expect(target.moveFilesHere(new ArrayColl([file]))).rejects.toThrow();

  expect(await fs.readFile(path.join(docsDir, "Clash source", "clash.txt"), "utf8")).toBe("From the source\n");
  expect(await fs.readFile(path.join(docsDir, "Clash target", "clash.txt"), "utf8")).toBe("Already in the target\n");
  expect(source.files.find(f => f.name == "clash.txt")).toBeDefined();
});

test("Move to another drive copies the file and then deletes the original", async () => {
  let source = await folderWith("Drive source", { "far.txt": "Far away\n" });
  let target = await folderWith("Drive target");
  let file = source.files.find(f => f.name == "far.txt");

  failNextRenameWith = "EXDEV";
  await target.moveFilesHere(new ArrayColl([file]));

  expect(failNextRenameWith).toBeNull();
  expect(await exists(path.join(docsDir, "Drive source", "far.txt"))).toBe(false);
  expect(await fs.readFile(path.join(docsDir, "Drive target", "far.txt"), "utf8")).toBe("Far away\n");
});

test("Copy a file to another folder", async () => {
  let source = await folderWith("Copy source", { "copy-me.txt": "Copied\n" });
  let target = await folderWith("Copy target");
  let file = source.files.find(f => f.name == "copy-me.txt");

  await target.copyFilesHere(new ArrayColl([file]));

  expect(await fs.readFile(path.join(docsDir, "Copy source", "copy-me.txt"), "utf8")).toBe("Copied\n");
  expect(await fs.readFile(path.join(docsDir, "Copy target", "copy-me.txt"), "utf8")).toBe("Copied\n");
  expect(source.files.find(f => f.name == "copy-me.txt")).toBeDefined();
  expect(target.files.find(f => f.name == "copy-me.txt")).toBeDefined();
});

test("Copy doesn't overwrite a file with the same name", async () => {
  let source = await folderWith("Copy clash source", { "clash.txt": "From the source\n" });
  let target = await folderWith("Copy clash target", { "clash.txt": "Already in the target\n" });
  let file = source.files.find(f => f.name == "clash.txt");

  await expect(target.copyFilesHere(new ArrayColl([file]))).rejects.toThrow();
  expect(await fs.readFile(path.join(docsDir, "Copy clash target", "clash.txt"), "utf8")).toBe("Already in the target\n");
});

test("Rename a file", async () => {
  let dir = await folderWith("Rename", { "old name.txt": "Renamed\n" });
  let file = dir.files.find(f => f.name == "old name.txt");

  await file.rename("new name.txt");

  expect(await exists(path.join(docsDir, "Rename", "old name.txt"))).toBe(false);
  expect(await fs.readFile(path.join(docsDir, "Rename", "new name.txt"), "utf8")).toBe("Renamed\n");
  expect(file.name).toBe("new name.txt");
  expect(file.nameWithoutExt).toBe("new name");
  expect(await readText(file)).toBe("Renamed\n");
});

test("Rename to the same name changes nothing", async () => {
  let dir = await folderWith("Rename same", { "same.txt": "Same\n" });
  let file = dir.files.find(f => f.name == "same.txt");

  await file.rename("same.txt");

  expect(await fs.readFile(path.join(docsDir, "Rename same", "same.txt"), "utf8")).toBe("Same\n");
  expect(file.name).toBe("same.txt");
});

test("Rename of a file to the name of another file fails, and keeps both files", async () => {
  let dir = await folderWith("Rename clash", { "first.txt": "First\n", "second.txt": "Second\n" });
  let file = dir.files.find(f => f.name == "first.txt");

  await expect(file.rename("second.txt")).rejects.toThrow();

  expect(await fs.readFile(path.join(docsDir, "Rename clash", "first.txt"), "utf8")).toBe("First\n");
  expect(await fs.readFile(path.join(docsDir, "Rename clash", "second.txt"), "utf8")).toBe("Second\n");
  expect(file.name).toBe("first.txt");
});

test("Rename a folder, and its files can still be opened", async () => {
  let dir = await folderWith("Old folder name", { "inside.txt": "Inside\n" });
  await dir.createSubDirectory("Nested");
  await fs.writeFile(path.join(docsDir, "Old folder name", "Nested", "deep.txt"), "Deep inside\n");
  let nested = dir.subDirs.find(d => d.name == "Nested");
  await nested.listContents();
  let inside = dir.files.find(f => f.name == "inside.txt");
  let deep = nested.files.find(f => f.name == "deep.txt");

  await dir.rename("New folder name");

  expect(await exists(path.join(docsDir, "Old folder name"))).toBe(false);
  expect(await fs.readFile(path.join(docsDir, "New folder name", "inside.txt"), "utf8")).toBe("Inside\n");
  expect(await readText(inside)).toBe("Inside\n");
  expect(await readText(deep)).toBe("Deep inside\n");
  let created = await nested.createSubDirectory("Even deeper");
  expect((await fs.stat(path.join(docsDir, "New folder name", "Nested", "Even deeper"))).isDirectory()).toBe(true);
  expect(created).toBeDefined();
});

test("Saving a file writes its contents to the file on disk", async () => {
  let dir = await folderWith("Save", { "saved.txt": "Before\n" });
  let file = dir.files.find(f => f.name == "saved.txt");

  file.contents = new Blob(["After saving\n"]);
  await file.save();

  expect(await fs.readFile(path.join(docsDir, "Save", "saved.txt"), "utf8")).toBe("After saving\n");
});

test("Saving a file whose contents aren't loaded leaves the file on disk as it is", async () => {
  let dir = await folderWith("Save unloaded", { "unloaded.txt": "Keep\n" });
  let file = dir.files.find(f => f.name == "unloaded.txt");

  await file.save();

  expect(await fs.readFile(path.join(docsDir, "Save unloaded", "unloaded.txt"), "utf8")).toBe("Keep\n");
});

test("Delete a file, and only that file", async () => {
  let dir = await folderWith("Delete file", { "delete-me.txt": "Bye\n", "keep.txt": "Keep\n" });
  let file = dir.files.find(f => f.name == "delete-me.txt");

  await file.deleteIt();

  expect(await exists(path.join(docsDir, "Delete file", "delete-me.txt"))).toBe(false);
  expect(await fs.readFile(path.join(docsDir, "Delete file", "keep.txt"), "utf8")).toBe("Keep\n");
  expect(dir.files.contains(file)).toBe(false);
});

test("Dropping the contents from memory leaves the file on disk", async () => {
  let dir = await folderWith("Cache", { "cached.txt": "Still here\n" });
  let file = dir.files.find(f => f.name == "cached.txt");
  await file.download();

  await file.deleteLocalCache();

  expect(await fs.readFile(path.join(docsDir, "Cache", "cached.txt"), "utf8")).toBe("Still here\n");
  expect(await readText(file)).toBe("Still here\n");
});

test("Delete a folder, with its contents, and nothing else", async () => {
  let parent = await folderWith("Delete folder", { "keep.txt": "Keep\n" });
  await parent.createSubDirectory("Keep me");
  await parent.createSubDirectory("Delete me");
  await fs.mkdir(path.join(docsDir, "Delete folder", "Delete me", "Nested"));
  await fs.writeFile(path.join(docsDir, "Delete folder", "Delete me", "Nested", "deep.txt"), "Deep\n");
  await fs.writeFile(path.join(docsDir, "Delete folder", "Keep me", "kept.txt"), "Kept\n");
  let dir = parent.subDirs.find(d => d.name == "Delete me");

  await dir.deleteIt();

  expect(await exists(path.join(docsDir, "Delete folder", "Delete me"))).toBe(false);
  expect(await fs.readFile(path.join(docsDir, "Delete folder", "keep.txt"), "utf8")).toBe("Keep\n");
  expect(await fs.readFile(path.join(docsDir, "Delete folder", "Keep me", "kept.txt"), "utf8")).toBe("Kept\n");
  expect(parent.subDirs.contains(dir)).toBe(false);
});

test("The special directories, and the directories that contain them, can't be deleted", async () => {
  let home = account.rootDirs.find(dir => dir.path.replace(/\/$/, "") == homeDir);
  await expect(documents.deleteIt()).rejects.toThrow();
  await expect(home.deleteIt()).rejects.toThrow();
  await home.listContents();
  let documentsInHome = home.subDirs.find(dir => dir.name == "Documents");
  expect(documentsInHome).toBeDefined();
  await expect(documentsInHome.deleteIt()).rejects.toThrow();

  expect(await exists(path.join(docsDir, "readme.txt"))).toBe(true);
  expect(await exists(path.join(homeDir, "readme.txt"))).toBe(true);
  expect(account.rootDirs.contains(documents)).toBe(true);
});

test("Refresh keeps the files, and shows the changes on disk", async () => {
  let dir = await folderWith("Refresh", { "changed.txt": "Before\n", "removed.txt": "Removed\n" });
  let changed = dir.files.find(f => f.name == "changed.txt");
  await changed.download();

  await fs.writeFile(path.join(docsDir, "Refresh", "changed.txt"), "After the change\n");
  let later = new Date(Date.now() + 60 * 1000);
  await fs.utimes(path.join(docsDir, "Refresh", "changed.txt"), later, later);
  await fs.unlink(path.join(docsDir, "Refresh", "removed.txt"));
  await fs.writeFile(path.join(docsDir, "Refresh", "added.txt"), "Added\n");
  await dir.listContents();

  expect(dir.files.contains(changed)).toBe(true);
  expect(dir.files.find(f => f.name == "removed.txt")).toBeUndefined();
  expect(dir.files.find(f => f.name == "added.txt")).toBeDefined();
  await changed.download();
  expect(await changed.contents.text()).toBe("After the change\n");
});
