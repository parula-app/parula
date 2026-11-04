// @vitest-environment happy-dom
import { RulesTestAccount } from "./RulesTestAccount";
import { Person, ContactEntry } from "../../../../logic/Abstract/Person";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { QuickRule } from "../../../Mail/Rules/QuickRule";
import type { MailAccount } from "../../../../logic/Mail/MailAccount";
import type { EMail } from "../../../../logic/Mail/EMail";
import { beforeEach, expect, test } from "vitest";

let account: MailAccount;
let sender: Person;

function newMessage(knownSender: boolean): EMail {
  let message = account.inbox.newEMail();
  message.subject = "Weekly newsletter";
  message.from = new PersonUID("news@example.com", "News Team");
  if (knownSender) {
    message.from.person = sender;
  }
  return message;
}

beforeEach(() => {
  account = RulesTestAccount.create("a", ["Inbox", "News"]);
  sender = new Person();
  sender.name = "News Team";
  sender.emailAddresses.add(new ContactEntry("news@example.com", "work"));
});

test("Known sender is preselected, subject prefilled", () => {
  let quick = new QuickRule(newMessage(true));
  expect(quick.account).toBe(account);
  expect(quick.fromSender).toBe(true);
  expect(quick.hasText).toBe(false);
  expect(quick.text).toBe("Weekly newsletter");
  expect(quick.disabledReason).toBe("Please select at least one action");
});

test("Unknown sender can't be a condition", () => {
  let quick = new QuickRule(newMessage(false));
  expect(quick.sender).toBeNull();
  expect(quick.fromSender).toBe(false);
  quick.markAsRead = true;
  expect(quick.disabledReason).toBe("Please select at least one condition");
  quick.hasText = true;
  expect(quick.disabledReason).toBeNull();
});

test("Move needs a folder", () => {
  let quick = new QuickRule(newMessage(true));
  quick.moveToFolder = true;
  expect(quick.disabledReason).toBe("Please select a folder");
  quick.folder = RulesTestAccount.folder(account, "News");
  expect(quick.disabledReason).toBeNull();
});

test("Rule from sender and folder", () => {
  let quick = new QuickRule(newMessage(true));
  quick.moveToFolder = true;
  quick.folder = RulesTestAccount.folder(account, "News");
  quick.flag = true;
  let rule = quick.createRule();
  expect(rule.name).toBe("From News Team");
  expect(rule.criteria.includesPerson).toBe(sender);
  expect(rule.criteria.bodyText).toBeFalsy();
  expect(rule.toFolder?.name).toBe("News");
  expect(rule.markAsStarred).toBe(true);
  expect(rule.markAsRead).toBeNull();
  expect(account.filterRuleActions.isEmpty).toBe(true);
});

test("Rule from subject text is named after the text", () => {
  let quick = new QuickRule(newMessage(false));
  quick.hasText = true;
  quick.text = "newsletter";
  quick.markAsRead = true;
  let rule = quick.createRule();
  expect(rule.name).toBe("newsletter");
  expect(rule.criteria.bodyText).toBe("newsletter");
  expect(rule.criteria.includesPerson).toBeFalsy();
  expect(rule.markAsRead).toBe(true);
});

test("Always Move Messages From creates and saves a move rule", async () => {
  let saved = 0;
  account.save = async () => { saved++; };
  let rule = await QuickRule.alwaysMoveFrom(newMessage(true), RulesTestAccount.folder(account, "News"));
  expect(account.filterRuleActions.contents).toEqual([rule]);
  expect(rule.criteria.includesPerson).toBe(sender);
  expect(rule.toFolder?.name).toBe("News");
  expect(rule.copy).toBeFalsy();
  expect(saved).toBe(1);
});

test("Always Move Messages From needs a known sender", async () => {
  await expect(QuickRule.alwaysMoveFrom(newMessage(false), RulesTestAccount.folder(account, "News")))
    .rejects.toThrow("The sender is not in your address book");
  expect(account.filterRuleActions.isEmpty).toBe(true);
});
