// @vitest-environment happy-dom
import { QuickFilterList } from "../../Mail/QuickFilterList";
import { QuickSearchEMail } from "../../../logic/Mail/Store/QuickSearchEMail";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

// Plain objects with the properties that the quick filter reads
function newFolder(subjects: string[]): any {
  let folder: any = { id: "inbox", account: null, messages: new ArrayColl<any>() };
  for (let subject of subjects) {
    folder.messages.add({ subject, isRead: false, isStarred: false, hasVisibleAttachments: false, folder });
  }
  return folder;
}

function unreadSearch(folder: any): QuickSearchEMail {
  let search = new QuickSearchEMail();
  search.folder = folder;
  search.isRead = false;
  return search;
}

function subjects(messages: ArrayColl<any>): string[] {
  return messages.contents.map(message => message.subject);
}

test("Unread filter: the message that the user reads stays in the list while it's selected", async () => {
  let folder = newFolder(["a", "b", "c", "d"]);
  let [a, b] = folder.messages.contents;
  let search = unreadSearch(folder);
  let list = new QuickFilterList();
  let selection = new ArrayColl<any>();
  expect(subjects(await list.filter(search, selection))).toEqual(["a", "b", "c", "d"]);

  // The user selects a, the reading pane marks it as read,
  // and the account sync notifies a change of the folder's messages (that's what re-filters)
  selection.add(a);
  a.isRead = true;
  for (let i = 0; i < 3; i++) {
    let shown = await list.filter(search, selection);
    expect(subjects(shown)).toEqual(["b", "c", "d", "a"]);
  }

  // The user moves on to b: a leaves the list, b stays after it's read
  selection.clear();
  selection.add(b);
  b.isRead = true;
  expect(subjects(await list.filter(search, selection))).toEqual(["c", "d", "b"]);
  expect(b.isRead).toBe(true);
  expect(folder.messages.contents.filter(message => !message.isRead).map(message => message.subject))
    .toEqual(["c", "d"]);
});

test("Unread filter: a new view of the list does not keep the read message", async () => {
  let folder = newFolder(["a", "b", "c"]);
  let [a] = folder.messages.contents;
  let search = unreadSearch(folder);
  let list = new QuickFilterList();
  let selection = new ArrayColl<any>([a]);
  await list.filter(search, selection);
  a.isRead = true;
  expect(subjects(await list.filter(search, selection))).toEqual(["b", "c", "a"]);

  search.isStarred = true;
  expect(subjects(await list.filter(search, selection))).toEqual([]);
  search.isStarred = null;
  expect(subjects(await list.filter(search, selection))).toEqual(["b", "c"]);
});

test("Unread filter: a read message that was not shown before does not join the list", async () => {
  let folder = newFolder(["a", "b"]);
  let [a] = folder.messages.contents;
  a.isRead = true;
  let search = unreadSearch(folder);
  let list = new QuickFilterList();
  let selection = new ArrayColl<any>([a]);
  expect(subjects(await list.filter(search, selection))).toEqual(["b"]);
  expect(subjects(await list.filter(search, selection))).toEqual(["b"]);
});

test("Unread filter: a deleted message leaves the list, even while it's selected", async () => {
  let folder = newFolder(["a", "b"]);
  let [a] = folder.messages.contents;
  let search = unreadSearch(folder);
  let list = new QuickFilterList();
  let selection = new ArrayColl<any>([a]);
  await list.filter(search, selection);
  a.isRead = true;
  folder.messages.remove(a);
  expect(subjects(await list.filter(search, selection))).toEqual(["b"]);
});

test("No filter: no list of its own", async () => {
  let folder = newFolder(["a"]);
  let search = new QuickSearchEMail();
  search.folder = folder;
  expect(await new QuickFilterList().filter(search, new ArrayColl<any>())).toBeNull();
});
