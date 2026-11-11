import { SearchFile } from "../../../../logic/Files/Store/SearchFile";
import { FileSharingAccount } from "../../../../logic/Files/FileSharingAccount";
import { Directory } from "../../../../logic/Files/Directory";
import type { File } from "../../../../logic/Files/File";
import type { FileOrDirectory } from "../../../../logic/Files/FileOrDirectory";
import { appGlobal } from "../../../../logic/app";
import type { Collection } from "svelte-collections";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

/**
 * Cloud account:
 *   Files/
 *     Budgets/
 *       2024-Budget.odt
 *       budget-2023.ODT
 *       minutes.md        (contents in memory)
 *       Archive/
 *         Old/
 *           budget-1999.txt
 *     Photos/
 *       Holiday.JPG       (no MIME type, like on the harddrive)
 *       scan              (MIME type from the server, no file extension)
 *     notes.txt
 *     trip.txt          (contents on disk)
 *     contract.txt      (contents only on the server)
 *
 * Second account:
 *   Home/
 *     budget.md
 */
let cloud: FileSharingAccount;
let second: FileSharingAccount;
let budgets: Directory;
let photos: Directory;
let contract: File;

function addDir(parent: Directory, name: string): Directory {
  let dir = parent.newDirectory(name);
  parent.subDirs.add(dir);
  return dir;
}

function addFile(parent: Directory, name: string, mimetype?: string): File {
  let file = parent.newFile(name);
  file.mimetype = mimetype;
  file.size = 1000;
  parent.files.add(file);
  return file;
}

beforeEach(() => {
  cloud = new FileSharingAccount();
  cloud.name = "Cloud";
  let root = cloud.newDirectory("Files");
  root.path = "/";
  cloud.rootDirs.add(root);
  budgets = addDir(root, "Budgets");
  addFile(budgets, "2024-Budget.odt", "application/vnd.oasis.opendocument.text");
  addFile(budgets, "budget-2023.ODT");
  let old = addDir(addDir(budgets, "Archive"), "Old");
  addFile(old, "budget-1999.txt");
  photos = addDir(root, "Photos");
  addFile(photos, "Holiday.JPG");
  addFile(photos, "scan", "image/png");
  addFile(root, "notes.txt", "text/plain");
  addFile(budgets, "minutes.md").contents = new Blob(["We met in Porto."]);
  addFile(root, "trip.txt").filepathLocal = "/home/user/files/trip.txt";
  contract = addFile(root, "contract.txt");
  appGlobal.remoteApp = {
    readFile: async (path: string) => path == "/home/user/files/trip.txt" ? new TextEncoder().encode("Train to Porto") : null,
  };

  second = new FileSharingAccount();
  second.name = "Second";
  let home = second.newDirectory("Home");
  home.path = "/";
  second.rootDirs.add(home);
  addFile(home, "budget.md");

  appGlobal.fileSharingAccounts.addAll([cloud, second]);
});

afterEach(() => {
  appGlobal.fileSharingAccounts.removeAll([cloud, second]);
  appGlobal.remoteApp = null;
});

function names(entries: Collection<FileOrDirectory>): string[] {
  return entries.contents.map(entry => entry.name).sort();
}

async function search(criteria: (search: SearchFile) => void, limit?: number): Promise<Collection<FileOrDirectory>> {
  let search = new SearchFile();
  criteria(search);
  let found = await search.startSearch(limit);
  await search.finished;
  return found;
}

test("Finds files and folders by a part of their name, ignoring upper and lower case", async () => {
  let found = await search(search => search.contentText = "BUDGET");
  expect(names(found)).toEqual(["2024-Budget.odt", "Budgets", "budget-1999.txt", "budget-2023.ODT", "budget.md"]);
  expect(names(await search(search => search.contentText = "oliday"))).toEqual(["Holiday.JPG"]);
});

test("Finds files and folders deep in subfolders", async () => {
  expect(names(await search(search => search.contentText = "1999"))).toEqual(["budget-1999.txt"]);
  expect(names(await search(search => search.contentText = "old"))).toEqual(["Old"]);
});

test("Each word must be in the name, in any order", async () => {
  expect(names(await search(search => search.contentText = "2024 budget"))).toEqual(["2024-Budget.odt"]);
  expect(names(await search(search => search.contentText = "budget  odt"))).toEqual(["2024-Budget.odt", "budget-2023.ODT"]);
  expect(names(await search(search => search.contentText = "budget xyz"))).toEqual([]);
});

test("Searches all accounts, or only one account", async () => {
  let found = await search(search => search.contentText = "budget");
  expect(found.contents.some(entry => (entry as File).account == second)).toBe(true);

  found = await search(search => {
    search.contentText = "budget";
    search.account = second;
  });
  expect(names(found)).toEqual(["budget.md"]);
});

test("Searches only in a folder and its subfolders", async () => {
  let found = await search(search => {
    search.contentText = "budget";
    search.directory = budgets;
  });
  // Not the folder itself, and nothing outside of it
  expect(names(found)).toEqual(["2024-Budget.odt", "budget-1999.txt", "budget-2023.ODT"]);

  found = await search(search => {
    search.contentText = "budget";
    search.directory = photos;
  });
  expect(names(found)).toEqual([]);
});

test("File type: By MIME type, or by file extension when the MIME type is missing", async () => {
  let pictures = ["image/jpeg", "image/png", "image/"];
  let found = await search(search => search.hasMIMETypes.addAll(pictures));
  expect(names(found)).toEqual(["Holiday.JPG", "scan"]);

  let texts = ["application/vnd.oasis.opendocument.text"];
  found = await search(search => {
    search.contentText = "budget";
    search.hasMIMETypes.addAll(texts);
  });
  // Folders are not of a file type
  expect(names(found)).toEqual(["2024-Budget.odt", "budget-2023.ODT"]);
});

test("Stops at the limit", async () => {
  let found = await search(search => search.contentText = "budget", 2);
  expect(found.length).toBe(2);
  for (let entry of found) {
    expect(entry.name.toLowerCase()).toContain("budget");
  }
});

test("Folder of a result: from the account root down", () => {
  let file = budgets.subDirs.first.subDirs.first.files.first;
  expect(file.parentDirs.contents.map(dir => dir.name)).toEqual(["Files", "Budgets", "Archive", "Old"]);
  expect(cloud.rootDirs.first.parentDirs.isEmpty).toBe(true);
});

test("Finds documents by their text, if their contents are already in memory or on disk", async () => {
  expect(names(await search(search => search.contentText = "PORTO"))).toEqual(["minutes.md", "trip.txt"]);
  expect(names(await search(search => search.contentText = "train"))).toEqual(["trip.txt"]);
});

test("Doesn't download files to search them", async () => {
  let download = vi.spyOn(contract, "download");
  let found = await search(search => search.contentText = "porto");
  expect(names(found)).not.toContain("contract.txt");
  expect(download).not.toHaveBeenCalled();
});

test("Each word can be in the name or in the text", async () => {
  expect(names(await search(search => search.contentText = "minutes porto"))).toEqual(["minutes.md"]);
  expect(names(await search(search => search.contentText = "trip met"))).toEqual([]);
});

test("The other criteria apply to the documents found by their text, too", async () => {
  let found = await search(search => {
    search.contentText = "porto";
    search.directory = budgets;
  });
  expect(names(found)).toEqual(["minutes.md"]);

  found = await search(search => {
    search.contentText = "porto";
    search.hasMIMETypes.add("image/");
  });
  expect(names(found)).toEqual([]);

  expect((await search(search => search.contentText = "porto", 1)).length).toBe(1);
});

test("A broken document doesn't stop the search", async () => {
  addFile(budgets, "broken.docx").contents = new Blob(["This is not a ZIP file"]);
  expect(names(await search(search => search.contentText = "porto"))).toEqual(["minutes.md", "trip.txt"]);
});
