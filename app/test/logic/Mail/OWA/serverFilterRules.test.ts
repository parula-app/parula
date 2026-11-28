// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { OWAError } from "../../../../logic/Mail/OWA/OWAError";
import { OWAFilterRule } from "../../../../logic/Mail/OWA/OWAFilterRule";
import { FilterRuleAction, LocalFilterRule } from "../../../../logic/Mail/FilterRules/FilterRuleAction";
import { getTagByName } from "../../../../logic/Abstract/Tag";
import { Person } from "../../../../logic/Abstract/Person";
import { getTagByName } from "../../../../logic/Abstract/Tag";
import kInboxRule from "./TestData/InboxRule.json";
import { expect, test } from "vitest";

appGlobal.me ??= new Person();

/** The inbox rules as `GetInboxRule` of the OWA options returns them.
 * These are the parameters of the PowerShell command `Set-InboxRule`. */
function serverRules(): any[] {
  return [{
    Identity: { RawIdentity: "owner:rule-2", DisplayName: "Invoices" },
    Name: "Invoices",
    Priority: 2,
    Enabled: true,
    SupportedByTask: true,
    SubjectOrBodyContainsWords: ["invoice"],
    MarkAsRead: true,
    HasAttachment: false,
    DeleteMessage: false,
  }, {
    Identity: { RawIdentity: "owner:rule-1", DisplayName: "Newsletters" },
    Name: "Newsletters",
    Priority: 1,
    Enabled: true,
    SupportedByTask: true,
    From: [{ DisplayName: "ACME News", SmtpAddress: "news@acme.example", RoutingType: "SMTP", AddressOrigin: 3 }],
    MyNameInToBox: true,
    ExceptIfSubjectContainsWords: ["urgent"],
    MoveToFolder: { RawIdentity: "owner:LgAAAAB", DisplayName: "Newsletters" },
    StopProcessingRules: true,
    HasAttachment: false,
    MarkAsRead: false,
    DeleteMessage: false,
  }];
}

class TestOWAAccount extends OWAAccount {
  readonly requests: any[] = [];
  readonly rules = serverRules();

  async callOWA(request: any): Promise<any> {
    let json = JSON.parse(JSON.stringify(request));
    this.requests.push({ action: request.action, json });
    if (request.action == "GetInboxRule") {
      return { WasSuccessful: true, InboxRuleCollection: { InboxRules: this.rules } };
    }
    if (request.action == "NewInboxRule") {
      let created = { ...json.InboxRule, Identity: { RawIdentity: "owner:rule-3", DisplayName: json.InboxRule.Name } };
      this.rules.push(created);
      return { WasSuccessful: true, InboxRule: created };
    }
    if (request.action == "RemoveInboxRule") {
      this.rules.splice(this.rules.findIndex(rule => rule.Identity.RawIdentity == json.Identity.RawIdentity), 1);
    }
    return { WasSuccessful: true };
  }

  get changes(): any[] {
    return this.requests.filter(request => request.action != "GetInboxRule");
  }
}

function newTestAccount(): TestOWAAccount {
  appGlobal.remoteApp ??= { OWA: {} } as any; // `OWAAccount` needs the backend only for the login
  let account = new TestOWAAccount();
  account.username = "alice@example.com";
  account.emailAddress = account.username;
  let inbox = account.newFolder();
  inbox.name = "Inbox";
  inbox.id = "inbox-id";
  account.rootFolders.add(inbox);
  let newsletters = account.newFolder();
  newsletters.name = "Newsletters";
  newsletters.id = "newsletters-ews-id";
  inbox.subFolders.add(newsletters);
  return account;
}

function rule(account: OWAAccount, name: string): FilterRuleAction {
  return account.filterRuleActions.find(rule => rule.name == name);
}

test("OWA: The server rules come in the order in which the server runs them", async () => {
  let account = newTestAccount();

  await account.refreshServerFilterRules();

  expect(account.filterRuleActions.contents.map(rule => rule.name)).toEqual(["Newsletters", "Invoices"]);
  let newsletters = rule(account, "Newsletters");
  expect(newsletters.server).toBe(true);
  expect(newsletters.criteria.includesPerson?.emailAddresses.first?.value).toBe("news@acme.example");
  expect(newsletters.toFolder?.name).toBe("Newsletters");
  expect(rule(account, "Invoices").criteria.bodyText).toBe("invoice");
  expect(rule(account, "Invoices").markAsRead).toBe(true);
});

test("OWA: A changed rule sends only what the user changed", async () => {
  let account = newTestAccount();
  await account.refreshServerFilterRules();

  rule(account, "Newsletters").criteria.bodyText = "acme";
  await account.saveServerFilterRules();

  expect(account.changes.length).toBe(1);
  let { action, json } = account.changes[0];
  expect(action).toBe("SetInboxRule");
  expect(json.AlwaysDeleteOutlookRulesBlob).toBe(false);
  expect(json.InboxRule).toEqual({
    Identity: { RawIdentity: "owner:rule-1", DisplayName: "Newsletters" },
    SubjectOrBodyContainsWords: ["acme"],
  });
});

test("OWA: Create and delete server rules", async () => {
  let account = newTestAccount();
  await account.refreshServerFilterRules();
  account.filterRuleActions.remove(rule(account, "Invoices"));
  let created = account.newFilterRule(true);
  created.name = "Offers";
  created.criteria.bodyText = "offer";
  created.toFolder = account.findFolder(folder => folder.name == "Newsletters");
  account.filterRuleActions.add(created);

  await account.saveServerFilterRules();

  expect(account.changes.map(change => change.action)).toEqual(["RemoveInboxRule", "NewInboxRule"]);
  expect(account.changes[0].json.Identity.RawIdentity).toBe("owner:rule-2");
  let newRule = account.changes[1].json.InboxRule;
  expect(newRule.Name).toBe("Offers");
  expect(newRule.SubjectOrBodyContainsWords).toEqual(["offer"]);
  expect(newRule.MoveToFolder.RawIdentity).toBe("newsletters-ews-id");
  expect(created.serverID).toBe("owner:rule-3");
  expect(account.filterRuleActions.contents.filter(rule => rule.name == "Offers").length).toBe(1);
});

test("OWA: The error that the server gives for a rule", async () => {
  let account = newTestAccount();
  await account.refreshServerFilterRules();
  account.callOWA = async () => {
    throw new OWAError({ json: { WasSuccessful: false, ErrorMessage: "The folder doesn't exist." } });
  };

  rule(account, "Invoices").markAsRead = null;

  await expect(account.saveServerFilterRules()).rejects.toThrow("The folder doesn't exist.");
});

test("OWA: A local rule for a tag does not move to the server, because OWA cannot check categories", async () => {
  let account = newTestAccount();
  let local = new LocalFilterRule(account);
  local.name = "Family";
  local.criteria.tags.add(getTagByName("Family"));
  local.markAsRead = true;

  expect(local.cannotRunOnServer).toContain("Family");
  expect(() => local.runBy(true, account.filterRuleActions)).toThrow("Family");
  local.criteria.tags.clear();
  expect(local.runBy(true, account.filterRuleActions)).toBeInstanceOf(OWAFilterRule);
});

test("OWA: After a restart, the server rules are OWA rules, and saving them changes nothing", async () => {
  let account = newTestAccount();
  await account.refreshServerFilterRules();

  let restarted = newTestAccount();
  restarted.fromConfigJSON(JSON.parse(JSON.stringify(account.toConfigJSON())));

  expect(restarted.filterRuleActions.contents.every(rule => rule instanceof OWAFilterRule)).toBe(true);
  expect(rule(restarted, "Newsletters").toFolder?.name).toBe("Newsletters");
  await restarted.saveServerFilterRules();
  expect(restarted.changes).toEqual([]);
});

test("OWA: The parts of a rule that we can't show are listed as text", async () => {
  let account = newTestAccount();
  await account.refreshServerFilterRules();

  let parts = rule(account, "Newsletters").unknownParts;

  expect(parts.length).toBe(3); // my name in To, the exception, stop processing
  expect(parts.some(part => part.includes("urgent"))).toBe(true);
  expect(parts.some(part => /stop processing/i.test(part))).toBe(true);
});

/** With the rule that Exchange Online sent for a rule from classic Outlook, @see `TestData/InboxRule.json` */
function newTestAccountWithInboxRule(json: any): TestOWAAccount {
  let account = newTestAccount();
  let testMails = account.newFolder();
  testMails.name = "Test Mails";
  testMails.id = "test-mails-id";
  account.rootFolders.add(testMails);
  account.rules.push(json);
  return account;
}

test("OWA: A rule with all the parameters that Exchange Online sends is understood", async () => {
  let account = newTestAccountWithInboxRule(structuredClone(kInboxRule));
  await account.refreshServerFilterRules();
  let testMail = rule(account, "Test Mail");

  expect(testMail.criteria.bodyText).toBe("Test Mail");
  expect(testMail.toFolder?.name).toBe("Test Mails");
  expect(testMail.copy).toBe(true);
  expect(testMail.readOnlyReason).toBeNull();
  expect(testMail.unknownParts).toEqual([]);
});

test("OWA: A rule for the word 0 is understood, not dropped", async () => {
  let account = newTestAccountWithInboxRule({ ...structuredClone(kInboxRule), SubjectOrBodyContainsWords: ["0"] });
  await account.refreshServerFilterRules();
  expect(rule(account, "Test Mail").criteria.bodyText).toBe("0");
});

test("OWA: A rule from Exchange Online with a part that we can't show still lists it, and can't move to us", async () => {
  let account = newTestAccountWithInboxRule({
    ...structuredClone(kInboxRule),
    ForwardTo: [{ DisplayName: "Bob", SmtpAddress: "bob@example.com", RoutingType: "SMTP" }],
    WithImportance: "High",
  });
  await account.refreshServerFilterRules();
  let testMail = rule(account, "Test Mail");

  let parts = testMail.unknownParts;
  expect(parts.length).toBe(2);
  expect(parts.join()).toContain("bob@example.com");
  expect(parts.join()).toContain("High");
  expect(() => testMail.runBy(false, account.filterRuleActions)).toThrow("Test Mail");
});

/** A rule from classic Outlook with a category, exceptions and a desktop alert, as Exchange Online sends it */
function newTestAccountWithOutlookRule(): TestOWAAccount {
  return newTestAccountWithInboxRule({
    ...structuredClone(kInboxRule),
    Name: "test rule",
    SubjectOrBodyContainsWords: null,
    CopyToFolder: null,
    AssignedCategories: ["Rote Kategorie"],
    HeaderContainsWords: ["X-MS-Exchange-Inbox-Rules-Loop: ben@bexchange.net"],
    MessageTypeMatches: "Calendaring",
    WithImportance: "High",
    ExceptIfHasAttachment: true,
    ExceptIfMyNameInToBox: true,
    MarkImportance: "High",
    StopProcessingRules: true,
    DisplayAlert: "Default",
  });
}

test("OWA: The category of a rule from Exchange Online is a criterion", async () => {
  let account = newTestAccountWithOutlookRule();
  await account.refreshServerFilterRules();
  let testRule = rule(account, "test rule");

  expect(testRule.criteria.tags.contents.map(tag => tag.name)).toEqual(["Rote Kategorie"]);
  expect(testRule.unknownParts.join()).not.toContain("Rote Kategorie");
});

test("OWA: Exchange Online can check a category, Exchange on premises cannot", async () => {
  let account = newTestAccount();
  await account.refreshServerFilterRules();
  rule(account, "Invoices").criteria.tags.add(getTagByName("Finance"));

  await expect(account.saveServerFilterRules()).rejects.toThrow("Invoices");
  expect(account.changes).toEqual([]);

  account.authorizationHeader = "Bearer token"; // Exchange Online
  await account.saveServerFilterRules();
  expect(account.changes[0].json.InboxRule.AssignedCategories).toEqual(["Finance"]);
});

test("OWA: The parts that we can't show are listed as conditions, exceptions and actions, as for EWS and Graph", async () => {
  let account = newTestAccountWithOutlookRule();
  await account.refreshServerFilterRules();

  let parts = rule(account, "test rule").unknownParts;

  expect(parts.length).toBe(8);
  expect(parts.filter(part => part.startsWith("Conditions: ")).length).toBe(3); // header, message type, importance
  expect(parts.filter(part => part.startsWith("Exceptions: ")).length).toBe(2);
  expect(parts.filter(part => part.startsWith("Actions: ")).length).toBe(3); // importance, stop processing, alert
  expect(parts.join()).not.toContain("Except if");
});

test("OWA: A folder that we can't find by its name is not shown, and stays", async () => {
  let account = newTestAccount();
  account.rules[1].MoveToFolder.DisplayName = "Old newsletters";
  await account.refreshServerFilterRules();
  let newsletters = rule(account, "Newsletters");

  expect(newsletters.toFolderID).toBeNull();
  expect(newsletters.unknownParts.join()).toContain("Old newsletters");

  newsletters.criteria.bodyText = "acme";
  await account.saveServerFilterRules();
  expect(Object.keys(account.changes[0].json.InboxRule)).toEqual(["Identity", "SubjectOrBodyContainsWords"]);
});

test("OWA: While Outlook keeps its own copy of the rules, the server rules become read-only", async () => {
  let account = newTestAccount();
  await account.refreshServerFilterRules();
  let callOWA = account.callOWA.bind(account);
  account.callOWA = async (request: any) => {
    if (request.action == "SetInboxRule") {
      throw new OWAError({ json: { WasSuccessful: false, ErrorCode: 4, UserPrompt: "Using Outlook Web App to modify your rules will delete any rules that were previously created using Outlook." } });
    }
    return await callOWA(request);
  };

  rule(account, "Invoices").markAsRead = null;

  await expect(account.saveServerFilterRules()).rejects.toThrow(/Outlook/);
  expect(rule(account, "Newsletters").readOnlyReason).toMatch(/Outlook/);
});
