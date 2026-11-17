// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { Folder } from "../../../../logic/Mail/Folder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import FolderGeneral from "../../../../frontend/Settings/Mail/Account/FolderGeneral.svelte";
import { waitFor } from "../../../logic/util/waitFor";
import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, expect, test } from "vitest";

const kFolderName = "Jennys Baby Shower";

let folder: Folder;
let renamedTo: string[];
let target: HTMLElement;
let app: any;

beforeEach(() => {
  appGlobal.remoteApp = {} as any;
  let account = new MailAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new DummyMailStorage();
  folder = new Folder(account);
  folder.name = folder.id = kFolderName;
  account.rootFolders.add(folder);
  renamedTo = [];
  folder.rename = async (newName: string) => {
    renamedTo.push(newName);
    folder.name = newName;
  };

  target = document.createElement("div");
  document.body.append(target);
  app = mount(FolderGeneral, { target, props: { folder } });
  flushSync();
});

afterEach(() => {
  unmount(app);
  target.remove();
});

test("Rename asks the server only when the name actually changed", async () => {
  await clickRename();
  await typeName("Party");
  await clickRename();

  await waitFor(() => renamedTo.length > 0);
  expect(renamedTo).toEqual(["Party"]);
});

async function clickRename() {
  let button = target.querySelector(`button[title="Rename"]`) as HTMLButtonElement;
  button.click();
  await tick();
  flushSync();
}

async function typeName(name: string) {
  let input = target.querySelector(`input[name="name"]`) as HTMLInputElement;
  input.value = name;
  input.dispatchEvent(new Event("input"));
  await tick();
}
