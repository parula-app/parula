// @vitest-environment happy-dom
import { RulesTestAccount } from "./RulesTestAccount";
import { FilterRuleAction } from "../../../../logic/Mail/FilterRules/FilterRuleAction";
import { FilterMoment } from "../../../../logic/Mail/FilterRules/FilterMoments";
import { getTagByName } from "../../../../logic/Abstract/Tag";
import { RuleWizardModel, RuleWizardPage } from "../../../Mail/Rules/RuleWizardModel";
import { ruleDescriptionLines } from "../../../Mail/Rules/RuleDescription";
import { expect, test } from "vitest";

function check(model: RuleWizardModel, id: string, checked = true) {
  model.setChecked(model.item(id), checked);
}

test("New rule starts with the first template, Back is off", () => {
  let account = RulesTestAccount.create("a", ["Inbox"]);
  let model = RuleWizardModel.forNewRule(account);
  expect(model.page).toBe(RuleWizardPage.Templates);
  expect(model.canGoBack).toBe(false);
  expect(model.template.id).toBe("move-from");
  expect([...model.checked]).toEqual(["from", "move"]);
  expect(ruleDescriptionLines(model.rule, model.checked).map(line => line.parts.map(part => part.text).join(""))).toEqual([
    "Apply this rule after the message arrives",
    "from people or public group",
    "move it to the specified folder",
  ]);
  expect(model.nextDisabledReason).toBeNull();
  expect(model.finishDisabledReason).toMatch(/underlined/);
});

test("Blank template for sent messages", () => {
  let model = RuleWizardModel.forNewRule(RulesTestAccount.create("a", ["Inbox"]));
  model.selectTemplate(model.templates.find(template => template.id == "send"));
  expect(model.rule.when).toBe(FilterMoment.Outgoing);
  expect(model.checked.size).toBe(0);
  expect(model.noConditionsQuestion).toMatch(/every message you send/);
  model.next();
  expect(model.page).toBe(RuleWizardPage.Conditions);
  expect(model.asksNoConditionsQuestion).toBe(true);
  check(model, "words");
  expect(model.asksNoConditionsQuestion).toBe(false);
  expect(model.nextDisabledReason).toMatch(/underlined/);
  model.rule.criteria.bodyText = "invoice";
  expect(model.nextDisabledReason).toBeNull();
});

test("Pages in order, Next needs an action", () => {
  let account = RulesTestAccount.create("a", ["Inbox", "Archive"]);
  let model = RuleWizardModel.forNewRule(account);
  model.selectTemplate(model.templates.find(template => template.id == "receive"));
  model.next();
  check(model, "attachment");
  model.next();
  expect(model.page).toBe(RuleWizardPage.Actions);
  expect(model.nextDisabledReason).toBe("Select at least one action");
  check(model, "mark-read");
  model.next();
  expect(model.page).toBe(RuleWizardPage.Finish);
  expect(model.nextDisabledReason).toBeTruthy();
  expect(model.name).toBe("New rule");
  model.back();
  expect(model.page).toBe(RuleWizardPage.Actions);
});

test("Checking an item unchecks the items it can't be combined with", () => {
  let account = RulesTestAccount.create("a", ["Inbox", "Archive"]);
  let model = RuleWizardModel.forNewRule(account);
  model.rule.toFolder = RulesTestAccount.folder(account, "Archive");
  check(model, "flag");
  check(model, "delete");
  expect(model.isChecked(model.item("move"))).toBe(false);
  expect(model.isChecked(model.item("flag"))).toBe(false);
  expect(model.rule.toFolderID).toBeFalsy();
  expect(model.rule.markAsStarred).toBeNull();
  expect(model.rule.deleteTrash).toBe(true);
  check(model, "permanently-delete");
  expect(model.isChecked(model.item("delete"))).toBe(false);
  expect(model.rule.deleteTrash).toBeNull();
  check(model, "unread");
  check(model, "read");
  expect(model.isChecked(model.item("unread"))).toBe(false);
  expect(model.rule.criteria.isRead).toBe(true);
});

test("Move and copy share the folder field", () => {
  let account = RulesTestAccount.create("a", ["Inbox", "Archive"]);
  let model = RuleWizardModel.forNewRule(account);
  model.selectTemplate(model.templates.find(template => template.id == "receive"));
  check(model, "copy");
  model.rule.toFolder = RulesTestAccount.folder(account, "Archive");
  model.rule.copy = true;
  expect(model.item("copy").isMissingValue(model.rule)).toBe(false);
  check(model, "move");
  expect(model.isChecked(model.item("copy"))).toBe(false);
  expect(model.rule.copy).toBeNull();
  expect(model.item("move").isMissingValue(model.rule)).toBe(true);
});

test("Editing works on a copy until Finish", () => {
  let account = RulesTestAccount.create("a", ["Inbox", "Archive"]);
  let rule = new FilterRuleAction(account);
  rule.name = "Invoices";
  rule.criteria.bodyText = "invoice";
  rule.toFolder = RulesTestAccount.folder(account, "Archive");
  rule.addTags.add(getTagByName("Finance"));

  let model = RuleWizardModel.forRule(rule);
  expect(model.page).toBe(RuleWizardPage.Conditions);
  expect(model.canGoBack).toBe(false);
  expect(model.name).toBe("Invoices");
  expect([...model.checked].sort()).toEqual(["assign-category", "move", "words"]);
  check(model, "assign-category", false);
  check(model, "mark-read");
  model.rule.criteria.bodyText = "bill";
  expect(rule.addTags.hasItems).toBe(true);
  expect(rule.criteria.bodyText).toBe("invoice");

  let result = model.finish();
  RuleWizardModel.copyInto(result, rule);
  expect(rule.name).toBe("Invoices");
  expect(rule.criteria.bodyText).toBe("bill");
  expect(rule.addTags.isEmpty).toBe(true);
  expect(rule.markAsRead).toBe(true);
  expect(rule.toFolder?.name).toBe("Archive");
});

test("Finish clears fields of unchecked items that the logic would still run", () => {
  let account = RulesTestAccount.create("a", ["Inbox", "Archive"]);
  let rule = new FilterRuleAction(account);
  rule.name = "Old";
  rule.toFolder = RulesTestAccount.folder(account, "Archive");
  rule.deleteTrash = true;
  let model = RuleWizardModel.forRule(rule);
  expect([...model.checked]).toEqual(["delete"]);
  check(model, "delete", false);
  check(model, "mark-read");
  let result = model.finish();
  expect(result.toFolderID).toBeFalsy();
  expect(result.deleteTrash).toBeNull();
  expect(ruleDescriptionLines(result).map(line => line.parts.map(part => part.text).join("")).slice(1)).toEqual(["mark it as read"]);
});

test("Name is suggested from the first condition, typed names stay", () => {
  let account = RulesTestAccount.create("a", ["Inbox", "Archive"]);
  let model = RuleWizardModel.forNewRule(account);
  model.selectTemplate(model.templates.find(template => template.id == "move-words"));
  model.rule.criteria.bodyText = "invoice";
  model.rule.toFolder = RulesTestAccount.folder(account, "Archive");
  model.next();
  model.next();
  model.next();
  expect(model.page).toBe(RuleWizardPage.Finish);
  expect(model.name).toBe("invoice");
  expect(model.finishDisabledReason).toBeNull();
  model.name = "";
  expect(model.finishDisabledReason).toBe("Enter a name for this rule");
  model.name = "Bills";
  model.back();
  model.next();
  expect(model.name).toBe("Bills");
  expect(model.finish().name).toBe("Bills");
});

test("A conversation condition is only offered when the rule has one", () => {
  let account = RulesTestAccount.create("a", ["Inbox"]);
  let model = RuleWizardModel.forNewRule(account);
  expect(model.shownConditions.some(item => item.id == "conversation")).toBe(false);
  let rule = new FilterRuleAction(account);
  rule.criteria.threadID = "thread-1";
  rule.markAsRead = true;
  model = RuleWizardModel.forRule(rule);
  expect(model.shownConditions.some(item => item.id == "conversation")).toBe(true);
  check(model, "conversation", false);
  expect(model.finish().criteria.threadID).toBeNull();
});

test("Picking a value checks the item", () => {
  let account = RulesTestAccount.create("a", ["Inbox"]);
  let model = RuleWizardModel.forNewRule(account);
  model.rule.criteria.sizeMin = 10 * 1024;
  model.valueChanged(model.item("size"));
  expect(model.isChecked(model.item("size"))).toBe(true);
});
