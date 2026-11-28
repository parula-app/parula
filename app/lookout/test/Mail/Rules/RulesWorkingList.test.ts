// @vitest-environment happy-dom
import { RulesTestAccount } from "./RulesTestAccount";
import { FilterRuleAction, LocalFilterRule } from "../../../../logic/Mail/FilterRules/FilterRuleAction";
import { ServerFilterRule } from "../../../../logic/Mail/FilterRules/ServerFilterRule";
import { RulesWorkingList } from "../../../Mail/Rules/RulesWorkingList";
import { RuleListActions } from "../../../Mail/Rules/RuleListActions";
import type { MailAccount } from "../../../../logic/Mail/MailAccount";
import { beforeEach, expect, test } from "vitest";

let account: MailAccount;
let saved: number;

function newRule(name: string): FilterRuleAction {
  let rule = new LocalFilterRule(account);
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
  let added = new LocalFilterRule(account);
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

/** A server rule without parts that we can't show */
class TestServerRule extends ServerFilterRule {
  protected get sections(): Record<string, Record<string, any>> {
    return {};
  }
}

/** @returns The names of the server rules, for each save. "(new)", if the server should create it. */
function letServerRunRules(account: MailAccount): string[][] {
  let uploads: string[][] = [];
  Object.defineProperty(account, "canServerFilterRules", { get: () => true });
  let server = account as any;
  server.newServerFilterRule = () => new TestServerRule(account, null);
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
  let added = account.newFilterRule(true);
  added.name = "Newsletters";
  list.rules.add(added);
  await list.apply();

  added.markAsRead = true;
  await list.apply();

  expect(uploads).toEqual([["Newsletters (new)"], ["Newsletters"]]);
  expect(account.filterRuleActions.length).toBe(1);
  expect(list.isChanged).toBe(false);
});

test("The user lets the mail server run a rule, and then us again", async () => {
  let uploads = letServerRunRules(account);
  newRule("Newsletters");
  let list = new RulesWorkingList(account);

  let serverRule = list.rules.first.runBy(true, list.rules);
  expect(list.rules.contents).toEqual([serverRule]);
  expect(list.isChanged).toBe(true);
  await list.apply();
  expect(account.filterRuleActions.first.server).toBe(true);
  expect(account.filterRuleActions.first.markAsRead).toBe(true);

  list.rules.first.runBy(false, list.rules);
  await list.apply();
  expect(account.filterRuleActions.first.server).toBe(false);
  expect(account.filterRuleActions.first.markAsRead).toBe(true);
  expect(uploads).toEqual([["Newsletters (new)"], []]);
});

test("A rule that the mail server cannot run stays with us", () => {
  letServerRunRules(account);
  newRule("Unread").criteria.isRead = false;
  let list = new RulesWorkingList(account);
  let copy = list.rules.first;

  expect(() => copy.runBy(true, list.rules)).toThrow("Unread");

  expect(list.rules.contents).toEqual([copy]);
  expect(list.isChanged).toBe(false);
});

test("A copy of a server rule for another account: That server runs it, if it can, otherwise we", () => {
  letServerRunRules(account);
  let secondAccount = RulesTestAccount.create("b", ["Inbox"]);
  letServerRunRules(secondAccount);
  let rule = account.newServerFilterRule(null);
  rule.name = "Newsletters";
  rule.markAsRead = true;
  rule.serverID = "rule-1";
  rule.json = { RuleId: "rule-1" };

  let copy = RuleListActions.copyToAccount(rule, secondAccount, secondAccount.filterRuleActions) as ServerFilterRule;
  expect(copy.server).toBe(true);
  expect(copy.markAsRead).toBe(true);
  expect(copy.serverID).toBeNull();
  expect(copy.json).toEqual({});
  expect(secondAccount.filterRuleActions.contents).toEqual([copy]);

  rule.criteria.isRead = false;
  expect(RuleListActions.copyToAccount(rule, secondAccount, secondAccount.filterRuleActions).server).toBe(false);
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
