// @vitest-environment happy-dom
import { RulesTestAccount } from "./RulesTestAccount";
import { FilterRuleAction } from "../../../../logic/Mail/FilterRules/FilterRuleAction";
import { getTagByName } from "../../../../logic/Abstract/Tag";
import { RuleListActions } from "../../../Mail/Rules/RuleListActions";
import type { MailAccount } from "../../../../logic/Mail/MailAccount";
import { beforeEach, expect, test } from "vitest";

let account: MailAccount;
let first: FilterRuleAction;
let second: FilterRuleAction;
let third: FilterRuleAction;

function newRule(name: string): FilterRuleAction {
  let rule = new FilterRuleAction(account);
  rule.name = name;
  account.filterRuleActions.add(rule);
  return rule;
}

function names(): string[] {
  return account.filterRuleActions.contents.map(rule => rule.name);
}

beforeEach(() => {
  account = RulesTestAccount.create("a", ["Inbox", "Archive"]);
  first = newRule("first");
  second = newRule("second");
  third = newRule("third");
});

test("Move up and down", () => {
  let rules = account.filterRuleActions;
  RuleListActions.move(rules, second, -1);
  expect(names()).toEqual(["second", "first", "third"]);
  RuleListActions.move(rules, second, 2);
  expect(names()).toEqual(["first", "third", "second"]);
});

test("Moving beyond the ends does nothing", () => {
  let rules = account.filterRuleActions;
  RuleListActions.move(rules, first, -1);
  RuleListActions.move(rules, third, 1);
  expect(names()).toEqual(["first", "second", "third"]);
});

test("Copy is inserted after the original", () => {
  second.criteria.bodyText = "invoice";
  let copy = RuleListActions.copy(account.filterRuleActions, second);
  expect(names()).toEqual(["first", "second", "Copy of second", "third"]);
  expect(copy).not.toBe(second);
  expect(copy.criteria.bodyText).toBe("invoice");
  expect(copy.account).toBe(account);
});

test("Move to folder replaces delete", () => {
  second.deleteTrash = true;
  second.markAsSpam = true;
  RuleListActions.moveToFolder(second, RulesTestAccount.folder(account, "Archive"), true);
  expect(second.toFolder?.name).toBe("Archive");
  expect(second.copy).toBe(true);
  expect(second.deleteTrash).toBeNull();
  expect(second.markAsSpam).toBeNull();
});

test("Delete message replaces move, flag and categories", () => {
  second.toFolder = RulesTestAccount.folder(account, "Archive");
  second.markAsStarred = true;
  second.addTags.add(getTagByName("Work"));
  second.markAsRead = true;
  RuleListActions.deleteMessage(second);
  expect(second.deleteTrash).toBe(true);
  expect(second.toFolder).toBeNull();
  expect(second.markAsStarred).toBeNull();
  expect(second.addTags.isEmpty).toBe(true);
  expect(second.markAsRead).toBe(true);
});
