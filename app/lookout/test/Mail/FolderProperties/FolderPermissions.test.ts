import { FolderPermissions } from "../../../Mail/FolderProperties/FolderPermissions";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { MailShareCombinedPermissions as Level, MailShareIndividualPermissions as Right } from "../../../../logic/Mail/Folder";
import { ArrayColl } from "svelte-collections";
import { beforeEach, expect, test } from "vitest";

let calls: string[];
let folder: any;

// Minimal stand-ins for `MailAccount` and `Folder`
beforeEach(() => {
  calls = [];
  let account = {
    emailAddress: "me@example.com",
    canShareWithPersons: () => true,
    sharePermissionLevels: [Level.Read, Level.FlagChange, Level.Modify, Level.Custom],
    getSharedPersons: async () => new ArrayColl([new PersonUID("anna@example.com", "Anna")]),
    deleteSharedPerson: async (person: PersonUID) => { calls.push("delete " + person.emailAddress); },
    addSharedPerson: async (person: PersonUID, mailFolder: any, includeSubfolders: boolean, access: Level, ...rights: Right[]) => {
      calls.push(`add ${person.emailAddress} ${mailFolder?.name ?? "all"} ${includeSubfolders} ${access} ${rights.join(",")}`);
    },
  };
  folder = { name: "Inbox", account };
});

test("Lists the persons with access and adds new ones with the first level", async () => {
  let permissions = new FolderPermissions(folder);
  await permissions.load();
  expect(permissions.entries.map(entry => entry.name)).toEqual(["Anna"]);
  expect(permissions.entries[0].level).toBeNull();
  let bob = permissions.add(new PersonUID("bob@example.com", "Bob"));
  expect(bob.level).toBe(Level.Read);
  expect(bob.rights).toEqual([Right.Read]);
  expect(permissions.isChanged).toBe(true);
  await permissions.apply();
  expect(calls).toEqual(["add bob@example.com Inbox true read "]);
  expect(permissions.isChanged).toBe(false);
});

test("Only colleagues of the same domain can get access", () => {
  let permissions = new FolderPermissions(folder);
  expect(() => permissions.add(new PersonUID("eve@other.org", "Eve"))).toThrow();
});

test("Changing a right makes the level custom, or the matching preset", async () => {
  let permissions = new FolderPermissions(folder);
  let bob = permissions.add(new PersonUID("bob@example.com", "Bob"));
  permissions.setRight(bob, Right.FlagChange, true);
  expect(bob.level).toBe(Level.FlagChange);
  permissions.setRight(bob, Right.CreateSubfolders, true);
  expect(bob.level).toBe(Level.Custom);
  permissions.allFolders = true;
  await permissions.apply();
  expect(calls).toEqual(["add bob@example.com all true custom read,flags-change,create-subfolders"]);
});

test("Removing an existing person deletes the access on Apply", async () => {
  let permissions = new FolderPermissions(folder);
  await permissions.load();
  permissions.remove(permissions.entries[0]);
  let bob = permissions.add(new PersonUID("bob@example.com", "Bob"));
  permissions.remove(bob);
  await permissions.apply();
  expect(calls).toEqual(["delete anna@example.com"]);
});

test("Choosing a level sets its rights", () => {
  let permissions = new FolderPermissions(folder);
  let bob = permissions.add(new PersonUID("bob@example.com", "Bob"));
  permissions.setLevel(bob, Level.Modify);
  expect(bob.rights.sort()).toEqual([Right.Create, Right.Delete, Right.FlagChange, Right.Read].sort());
});
