// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { GraphAccount } from "../../../../logic/Mail/Graph/GraphAccount";
import { FilterRuleAction } from "../../../../logic/Mail/FilterRules/FilterRuleAction";
import { Person } from "../../../../logic/Abstract/Person";
import { expect, test } from "vitest";

appGlobal.me ??= new Person();

/** `messageRule`s, as MS Graph returns them */
function serverRules(): any[] {
  return [{
    id: "rule-2",
    displayName: "Invoices",
    sequence: 2,
    isEnabled: true,
    hasError: false,
    isReadOnly: false,
    conditions: { bodyOrSubjectContains: ["invoice"] },
    actions: { markAsRead: true },
  }, {
    id: "rule-1",
    displayName: "Newsletters",
    sequence: 1,
    isEnabled: true,
    hasError: false,
    isReadOnly: false,
    conditions: {
      fromAddresses: [{ emailAddress: { name: "ACME News", address: "news@acme.example" } }],
      sentToMe: true,
    },
    exceptions: { subjectContains: ["urgent"] },
    actions: { moveToFolder: "folder-newsletters", stopProcessingRules: true },
  }];
}

class TestGraphAccount extends GraphAccount {
  readonly requests: any[] = [];
  readonly rules = serverRules();

  constructor() {
    appGlobal.remoteApp ??= {} as any;
    appGlobal.remoteApp.kyCreate ??= (() => null) as any; // `GraphAccount` needs the backend only for HTTP
    super();
  }

  async graphGetAll<T>(path: string): Promise<T[]> {
    return structuredClone(this.rules) as T[];
  }
  async graphPost(path: string, json: any): Promise<any> {
    this.requests.push({ method: "post", path, json });
    let created = { ...json, id: "rule-3" };
    this.rules.push(created);
    return created;
  }
  async graphPatch(path: string, json: any): Promise<any> {
    this.requests.push({ method: "patch", path, json });
    return {};
  }
  async graphDelete(path: string): Promise<any> {
    this.requests.push({ method: "delete", path });
    return {};
  }
}

function rule(account: GraphAccount, name: string): FilterRuleAction {
  return account.filterRuleActions.find(rule => rule.name == name);
}

test("Graph: The server rules come in the order in which the server runs them", async () => {
  let account = new TestGraphAccount();

  await account.refreshServerFilterRules();

  expect(account.filterRuleActions.contents.map(rule => rule.name)).toEqual(["Newsletters", "Invoices"]);
  let newsletters = rule(account, "Newsletters");
  expect(newsletters.criteria.includesPerson?.emailAddresses.first?.value).toBe("news@acme.example");
  expect(newsletters.toFolderID).toBe("folder-newsletters");
  expect(rule(account, "Invoices").markAsRead).toBe(true);
});

test("Graph: A changed rule keeps the parts that we don't understand", async () => {
  let account = new TestGraphAccount();
  await account.refreshServerFilterRules();

  rule(account, "Newsletters").criteria.bodyText = "acme";
  await account.saveServerFilterRules();

  expect(account.requests.length).toBe(1);
  let { method, path, json } = account.requests[0];
  expect(method).toBe("patch");
  expect(path).toMatch(/\/rule-1$/);
  expect(Object.keys(json)).toEqual(["conditions"]);
  expect(json.conditions.bodyOrSubjectContains).toEqual(["acme"]);
  expect(json.conditions.sentToMe).toBe(true);
  expect(json.conditions.fromAddresses[0].emailAddress.name).toBe("ACME News");
});

test("Graph: Create a server rule, and delete one", async () => {
  let account = new TestGraphAccount();
  await account.refreshServerFilterRules();
  account.filterRuleActions.remove(rule(account, "Invoices"));
  account.rules.splice(0, 1); // The server deleted it
  let created = new FilterRuleAction(account);
  created.name = "Offers";
  created.server = true;
  created.criteria.bodyText = "offer";
  created.deleteTrash = true;
  account.filterRuleActions.add(created);

  await account.saveServerFilterRules();

  expect(account.requests.map(request => request.method)).toEqual(["delete", "post"]);
  expect(account.requests[0].path).toMatch(/\/rule-2$/);
  let newRule = account.requests[1].json;
  expect(newRule.displayName).toBe("Offers");
  expect(newRule.conditions.bodyOrSubjectContains).toEqual(["offer"]);
  expect(newRule.actions.delete).toBe(true);
  expect(created.serverID).toBe("rule-3");
  expect(account.filterRuleActions.contents.map(rule => rule.name)).toEqual(["Newsletters", "Offers"]);
});

test("Graph: A date span is not saved to the server, because Graph cannot check it", async () => {
  let account = new TestGraphAccount();
  await account.refreshServerFilterRules();

  rule(account, "Invoices").criteria.sentDateMin = new Date("2026-01-01T00:00:00Z");

  await expect(account.saveServerFilterRules()).rejects.toThrow();
  expect(account.requests).toEqual([]);
});

test("Graph: The parts of a rule that we can't show are listed as text", async () => {
  let account = new TestGraphAccount();
  await account.refreshServerFilterRules();

  let parts = rule(account, "Newsletters").serverRule.unknownParts;

  expect(parts.length).toBe(3); // sent to me, the exception, stop processing
  expect(parts.some(part => part.includes("urgent"))).toBe(true);
});

test("Graph: A read-only rule is neither changed nor moved", async () => {
  let account = new TestGraphAccount();
  account.rules[1].isReadOnly = true; // "Newsletters", which runs first
  await account.refreshServerFilterRules();
  let newsletters = rule(account, "Newsletters");
  expect(newsletters.readOnlyReason).toBeTruthy();

  account.filterRuleActions.replaceAll([rule(account, "Invoices"), newsletters]);
  await account.saveServerFilterRules();
  expect(account.requests.map(request => request.path)).toEqual(["mailFolders/inbox/messageRules/rule-2"]);

  newsletters.markAsRead = true;
  await expect(account.saveServerFilterRules()).rejects.toThrow();
});
