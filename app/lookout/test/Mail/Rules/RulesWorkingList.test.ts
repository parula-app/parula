// @vitest-environment happy-dom
import { RulesTestAccount } from "./RulesTestAccount";
import { FilterRuleAction } from "../../../../logic/Mail/FilterRules/FilterRuleAction";
import { RulesWorkingList } from "../../../Mail/Rules/RulesWorkingList";
import { RuleListActions } from "../../../Mail/Rules/RuleListActions";
import type { MailAccount } from "../../../../logic/Mail/MailAccount";
import { beforeEach, expect, test } from "vitest";

let account: MailAccount;
let saved: number;

function newRule(name: string): FilterRuleAction {
  let rule = new FilterRuleAction(account);
  rule.name = name;
  rule.markAsRead = true;
  account.filterRuleActions.add(rule);
  return rule;
}

beforeEach(() => {
  account = RulesTestAccount.create("a", ["Inbox", "Archive"]);
  saved = 0;
  account.save = async () => { saved++; };
});

test("Changes stay in the working list until Apply", async () => {
  let first = newRule("first");
  newRule("second");
  let list = new RulesWorkingList(account);
  expect(list.isChanged).toBe(false);
  expect(list.rules.contents.map(rule => rule.name)).toEqual(["first", "second"]);
  expect(list.rules.first).not.toBe(first);

  list.rules.first.name = "renamed";
  RuleListActions.move(list.rules, list.rules.first, 1);
  expect(list.isChanged).toBe(true);
  expect(account.filterRuleActions.contents.map(rule => rule.name)).toEqual(["first", "second"]);

  await list.apply();
  expect(saved).toBe(1);
  expect(list.isChanged).toBe(false);
  expect(account.filterRuleActions.contents.map(rule => rule.name)).toEqual(["second", "renamed"]);
  expect(account.filterRuleActions.get(1)).toBe(first);
});

test("Added and removed rules are applied, Apply without changes doesn't save", async () => {
  newRule("first");
  let list = new RulesWorkingList(account);
  await list.apply();
  expect(saved).toBe(0);

  list.rules.removeAll(list.rules.contents);
  let added = new FilterRuleAction(account);
  added.name = "new";
  added.toFolder = RulesTestAccount.folder(account, "Archive");
  list.rules.add(added);
  await list.apply();
  expect(saved).toBe(1);
  expect(account.filterRuleActions.length).toBe(1);
  expect(account.filterRuleActions.first.name).toBe("new");
  expect(account.filterRuleActions.first.toFolder?.name).toBe("Archive");
  expect(account.filterRuleActions.first).not.toBe(added);

  added.name = "changed again";
  await list.apply();
  expect(account.filterRuleActions.length).toBe(1);
  expect(account.filterRuleActions.first.name).toBe("changed again");
});

/** @returns The names of the server rules, for each save. "(new)", if the server should create it. */
function letServerRunRules(account: MailAccount): string[][] {
  let uploads: string[][] = [];
  Object.defineProperty(account, "canServerFilterRules", { get: () => true });
  let server = account as any;
  server.fetchServerFilterRules = async () => account.filterRuleActions.contents
    .filter(rule => rule.serverID)
    .map(rule => rule.clone());
  server.uploadServerFilterRules = async (rules: FilterRuleAction[]) => {
    uploads.push(rules.map(rule => rule.name + (rule.serverID ? "" : " (new)")));
    for (let rule of rules) {
      rule.serverID ??= "id-" + rule.name;
    }
  };
  return uploads;
}

test("A rule that the server created is not created again at the next Apply", async () => {
  let uploads = letServerRunRules(account);
  let list = new RulesWorkingList(account);
  let added = new FilterRuleAction(account);
  added.name = "Newsletters";
  added.server = true;
  list.rules.add(added);
  await list.apply();

  added.markAsRead = true;
  await list.apply();

  expect(uploads).toEqual([["Newsletters (new)"], ["Newsletters"]]);
  expect(account.filterRuleActions.length).toBe(1);
  expect(list.isChanged).toBe(false);
});

test("Copy to another account only without folders", () => {
  let secondAccount = RulesTestAccount.create("b", ["Inbox"]);
  let rule = newRule("first");
  expect(RuleListActions.cannotCopyTo(rule, secondAccount)).toBe(false);
  let copy = RuleListActions.copyToAccount(rule, secondAccount, secondAccount.filterRuleActions);
  expect(copy.account).toBe(secondAccount);
  expect(copy.criteria.account).toBe(secondAccount);
  expect(copy.name).toBe("first");
  expect(copy.markAsRead).toBe(true);
  rule.toFolder = RulesTestAccount.folder(account, "Archive");
  expect(RuleListActions.cannotCopyTo(rule, secondAccount)).toBeTruthy();
  expect(RuleListActions.cannotCopyTo(rule, account)).toBe(false);
});
