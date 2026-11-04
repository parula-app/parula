// @vitest-environment happy-dom
import { RulesTestAccount } from "../Rules/RulesTestAccount";
import { AllAccounts } from "../../../../logic/Mail/Virtual/AllAccounts";
import type { AllFolders } from "../../../../logic/Mail/Virtual/AllFolders";
import type { MailAccount } from "../../../../logic/Mail/MailAccount";
import { FolderTreeActions } from "../../../Mail/LeftPane/FolderTreeActions";
import { ArrayColl } from "svelte-collections";
import { get } from "svelte/store";
import { expect, test } from "vitest";

test("The count of a folder follows the folder", () => {
  let account = RulesTestAccount.create("count", ["Inbox", "Projects"]);
  let projects = RulesTestAccount.folder(account, "Projects");
  projects.countUnread = 2;
  projects.countTotal = 10;
  let unread = FolderTreeActions.countStore(projects, false);
  let total = FolderTreeActions.countStore(projects, true);
  let shown: number[] = [];
  let unsubscribe = unread.subscribe(count => shown.push(count));
  expect(get(total)).toBe(10);
  projects.countUnread = 5;
  expect(shown.at(-1)).toBe(5);
  unsubscribe();
  expect(get(FolderTreeActions.countStore(null, false))).toBe(0);
});

test("The count of the all-accounts Inbox follows accounts that are added later", () => {
  let first = RulesTestAccount.create("first", ["Inbox"]);
  first.inbox.countUnread = 3;
  let accounts = new ArrayColl<MailAccount>([first]);
  let allInbox = new AllAccounts(accounts).specialFolders.first as AllFolders;
  let shown: number[] = [];
  let unsubscribe = FolderTreeActions.countStore(allInbox, false).subscribe(count => shown.push(count));
  expect(shown.at(-1)).toBe(3);

  let second = RulesTestAccount.create("second", ["Inbox"]);
  second.inbox.countUnread = 2;
  accounts.add(second);
  expect(shown.at(-1)).toBe(5);

  second.inbox.countUnread = 4;
  expect(shown.at(-1)).toBe(7);

  accounts.remove(first);
  expect(shown.at(-1)).toBe(4);
  first.inbox.countUnread = 100;
  expect(shown.at(-1)).toBe(4);
  unsubscribe();
});
