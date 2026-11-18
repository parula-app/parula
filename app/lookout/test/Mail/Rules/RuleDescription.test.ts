// @vitest-environment happy-dom
import { RulesTestAccount } from "./RulesTestAccount";
import { FilterRuleAction } from "../../../../logic/Mail/FilterRules/FilterRuleAction";
import { FilterMoment } from "../../../../logic/Mail/FilterRules/FilterMoments";
import { Person, ContactEntry } from "../../../../logic/Abstract/Person";
import { getTagByName } from "../../../../logic/Abstract/Tag";
import { ruleDescriptionLines } from "../../../Mail/Rules/RuleDescription";
import { ruleConditions } from "../../../Mail/Rules/RuleItems";
import { expect, test } from "vitest";

function texts(rule: FilterRuleAction, checkedIDs?: Set<string>): string[] {
  return ruleDescriptionLines(rule, checkedIDs).map(line => line.parts.map(part => part.text).join(""));
}

test("When line by moment", () => {
  let rule = new FilterRuleAction(RulesTestAccount.create("a", ["Inbox"]));
  expect(texts(rule)[0]).toBe("Apply this rule after the message arrives");
  rule.when = FilterMoment.IncomingAfterSpam;
  expect(texts(rule)[0]).toBe("Apply this rule after the message arrives and after the junk check");
  rule.when = FilterMoment.Outgoing;
  expect(texts(rule)[0]).toBe("Apply this rule after I send the message");
});

test("Move from a person", () => {
  let account = RulesTestAccount.create("a", ["Inbox", "Music"]);
  let person = new Person();
  person.name = "Music Discussion";
  person.emailAddresses.add(new ContactEntry("music@example.com", "work"));
  let rule = new FilterRuleAction(account);
  rule.criteria.includesPerson = person;
  rule.toFolder = RulesTestAccount.folder(account, "Music");
  expect(texts(rule)).toEqual([
    "Apply this rule after the message arrives",
    "from Music Discussion",
    "move it to the Music folder",
  ]);
});

test("Conditions and actions in Outlook order, Mustang extras last", () => {
  let account = RulesTestAccount.create("a", ["Inbox", "Archive"]);
  let rule = new FilterRuleAction(account);
  rule.criteria.bodyText = "invoice";
  rule.criteria.hasAttachment = true;
  rule.criteria.isRead = false;
  rule.criteria.isStarred = true;
  rule.criteria.tags.add(getTagByName("Work"));
  rule.markAsRead = true;
  rule.markAsStarred = true;
  rule.addTags.add(getTagByName("Finance"));
  rule.toFolder = RulesTestAccount.folder(account, "Archive");
  rule.copy = true;
  expect(texts(rule)).toEqual([
    "Apply this rule after the message arrives",
    "which is flagged for follow up",
    `with "invoice" in the subject or body`,
    "assigned to Work category",
    "which has an attachment",
    "which is unread",
    "assign it to the Finance category",
    "move a copy to the Archive folder",
    "flag message for follow up",
    "mark it as read",
  ]);
});

test("Size in KB, dates", () => {
  let rule = new FilterRuleAction(RulesTestAccount.create("a", ["Inbox"]));
  rule.criteria.sizeMin = 100 * 1024;
  rule.criteria.sizeMax = 2048 * 1024;
  expect(texts(rule)).toContain("with a size between 100 and 2048 KB");
  rule.criteria.sizeMax = null;
  expect(texts(rule)).toContain("with a size of at least 100 KB");
  rule.criteria.sentDateMax = new Date(2026, 0, 31);
  expect(texts(rule).find(text => text.startsWith("received before "))).toBeTruthy();
});

test("Delete wins over move, permanent delete wins over delete", () => {
  let account = RulesTestAccount.create("a", ["Inbox", "Archive"]);
  let rule = new FilterRuleAction(account);
  rule.toFolder = RulesTestAccount.folder(account, "Archive");
  rule.deleteTrash = true;
  expect(texts(rule).slice(1)).toEqual(["delete it"]);
  rule.deleteImmediately = true;
  expect(texts(rule).slice(1)).toEqual(["permanently delete it"]);
});

test("Missing target folder is broken", () => {
  let rule = new FilterRuleAction(RulesTestAccount.create("a", ["Inbox"]));
  rule.toFolderID = "gone";
  expect(texts(rule)).toContain("move it to the missing folder");
});

test("Parts mark the value, or the placeholder while there is none", () => {
  let rule = new FilterRuleAction(RulesTestAccount.create("a", ["Inbox"]));
  let words = ruleConditions().find(item => item.id == "words");
  expect(words.descriptionParts(rule)).toEqual([
    { text: "with ", isValue: false },
    { text: "specific words", isValue: true, isPlaceholder: true },
    { text: " in the subject or body", isValue: false },
  ]);
  rule.criteria.bodyText = "invoice";
  expect(words.descriptionParts(rule)[1]).toEqual({ text: `"invoice"`, isValue: true, isPlaceholder: false });
  expect(words.listParts()[1].text).toBe("specific words");
});

test("Lines for checked items include those without a value yet", () => {
  let rule = new FilterRuleAction(RulesTestAccount.create("a", ["Inbox"]));
  expect(texts(rule, new Set(["from", "move"]))).toEqual([
    "Apply this rule after the message arrives",
    "from people or public group",
    "move it to the specified folder",
  ]);
});

test("Several categories are listed", () => {
  let rule = new FilterRuleAction(RulesTestAccount.create("a", ["Inbox"]));
  rule.addTags.add(getTagByName("Red"));
  rule.addTags.add(getTagByName("Blue"));
  expect(texts(rule)).toContain("assign it to the Red and Blue category");
});
