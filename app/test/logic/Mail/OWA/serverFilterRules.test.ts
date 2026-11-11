// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { FilterRuleAction } from "../../../../logic/Mail/FilterRules/FilterRuleAction";
import { Person } from "../../../../logic/Abstract/Person";
import { outlookRulesStream, base64 } from "../EWS/outlookRulesStream";
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
  /** The copy of the rules that classic Outlook keeps, @see `OutlookRulesCopy` */
  outlookRulesStreams: Uint8Array[] = [];

  async callOWA(request: any): Promise<any> {
    let json = JSON.parse(JSON.stringify(request));
    this.requests.push({ action: request.action, json });
    if (request.action == "FindItem") {
      expect(json.Body.Traversal).toBe("Associated");
      return { RootFolder: { Items: this.outlookRulesStreams.map((_stream, i) => ({ ItemId: { Id: "copy-" + i } })) } };
    }
    if (request.action == "GetItem") {
      let stream = this.outlookRulesStreams[Number(json.Body.ItemIds[0].Id.replace("copy-", ""))];
      return { Items: [{ ExtendedProperty: [{ ExtendedFieldURI: { PropertyTag: "0x6802", PropertyType: "Binary" }, Value: base64(stream) }] }] };
    }
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
    return this.requests.filter(request => !["GetInboxRule", "FindItem", "GetItem"].includes(request.action));
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
  let created = new FilterRuleAction(account);
  created.name = "Offers";
  created.server = true;
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
  account.callOWA = async () => ({ WasSuccessful: false, ErrorMessage: "The folder doesn't exist." });

  rule(account, "Invoices").markAsRead = null;

  await expect(account.saveServerFilterRules()).rejects.toThrow("The folder doesn't exist.");
});

test("OWA: The parts of a rule that we can't show are listed as text", async () => {
  let account = newTestAccount();
  await account.refreshServerFilterRules();

  let parts = rule(account, "Newsletters").serverRule.unknownParts;

  expect(parts.length).toBe(3); // my name in To, the exception, stop processing
  expect(parts.some(part => part.includes("urgent"))).toBe(true);
  expect(parts.some(part => /stop processing/i.test(part))).toBe(true);
});

test("OWA: A folder that we can't find by its name is not shown, and stays", async () => {
  let account = newTestAccount();
  account.rules[1].MoveToFolder.DisplayName = "Old newsletters";
  await account.refreshServerFilterRules();
  let newsletters = rule(account, "Newsletters");

  expect(newsletters.toFolderID).toBeNull();
  expect(newsletters.serverRule.unknownParts.join()).toContain("Old newsletters");

  newsletters.criteria.bodyText = "acme";
  await account.saveServerFilterRules();
  expect(Object.keys(account.changes[0].json.InboxRule)).toEqual(["Identity", "SubjectOrBodyContainsWords"]);
});

test("OWA: While Outlook keeps its own copy of the rules, the server rules become read-only", async () => {
  let account = newTestAccount();
  await account.refreshServerFilterRules();
  let callOWA = account.callOWA.bind(account);
  account.callOWA = async (request: any) => request.action == "SetInboxRule"
    ? { WasSuccessful: false, ErrorCode: 4, UserPrompt: "Using Outlook Web App to modify your rules will delete any rules that were previously created using Outlook." }
    : await callOWA(request);

  rule(account, "Invoices").markAsRead = null;

  await expect(account.saveServerFilterRules()).rejects.toThrow(/Outlook/);
  expect(rule(account, "Newsletters").readOnlyReason).toMatch(/Outlook/);
});

test("OWA: When Outlook's copy of the rules has no rules of its own, the server rules stay editable, and Exchange may delete the copy", async () => {
  let account = newTestAccount();
  account.outlookRulesStreams = [outlookRulesStream([{ name: "Newsletters" }, { name: "Invoices" }])];

  await account.refreshServerFilterRules();
  expect(rule(account, "Invoices").readOnlyReason).toBeNull();
  expect(account.serverFilterRulesNotice).toMatch(/Outlook/);

  rule(account, "Invoices").criteria.bodyText = "bill";
  account.requests.length = 0;
  await account.saveServerFilterRules();

  let change = account.changes[0];
  expect(change.action).toBe("SetInboxRule");
  expect(change.json.Force).toBe(true);
  // It would hide the warning also for later changes in Outlook on the web
  expect(change.json.AlwaysDeleteOutlookRulesBlob).toBe(false);
  // Outlook may have changed its copy in the meantime
  let actions = account.requests.map(request => request.action);
  expect(actions.slice(0, actions.indexOf("SetInboxRule"))).toContain("GetItem");
});

test("OWA: The rules that only Outlook's copy of the rules has keep the server rules read-only, and the user sees their names", async () => {
  let account = newTestAccount();
  account.outlookRulesStreams = [outlookRulesStream([
    { name: "Newsletters" },
    { name: "Cc my boss", isForSentMail: true },
    { name: "Invoices" },
  ])];

  await account.refreshServerFilterRules();

  let reason = rule(account, "Invoices").readOnlyReason;
  expect(reason).toContain("Cc my boss");
  expect(reason).not.toContain("Newsletters");
  expect(account.serverFilterRulesNotice).toBeNull();
});

test("OWA: If we can't look for Outlook's copy of the rules, the server asks before it deletes the copy", async () => {
  let account = newTestAccount();
  let callOWA = account.callOWA.bind(account);
  account.callOWA = async (request: any) => {
    if (request.action == "FindItem") {
      throw new Error("FindItem is not available");
    }
    return await callOWA(request);
  };

  await account.refreshServerFilterRules();
  expect(rule(account, "Invoices").readOnlyReason).toBeNull();
  expect(account.dataErrors.length).toBe(1);

  rule(account, "Invoices").criteria.bodyText = "bill";
  await account.saveServerFilterRules();
  expect(account.changes[0].json.Force).toBe(false);
});
