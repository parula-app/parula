// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import { FilterRuleAction } from "../../../../logic/Mail/FilterRules/FilterRuleAction";
import { AuthMethod } from "../../../../logic/Abstract/Account";
import { Person } from "../../../../logic/Abstract/Person";
import { outlookRulesStream, base64 } from "./outlookRulesStream";
import { expect, test } from "vitest";

appGlobal.me ??= new Person();

/** Exchange prefixes the elements with `m:` and `t:`, but happy-dom's
 * `querySelector()` does not find prefixed elements, unlike Chromium,
 * so these responses use default namespaces. */
const kNewslettersRule = `
  <Rule xmlns="http://schemas.microsoft.com/exchange/services/2006/types">
    <RuleId>rule-1</RuleId>
    <DisplayName>Newsletters</DisplayName>
    <Priority>1</Priority>
    <IsEnabled>true</IsEnabled>
    <IsNotSupported>false</IsNotSupported>
    <Conditions>
      <FromAddresses>
        <Address><Name>ACME News</Name><EmailAddress>news@acme.example</EmailAddress><RoutingType>SMTP</RoutingType></Address>
      </FromAddresses>
      <SentToMe>true</SentToMe>
    </Conditions>
    <Exceptions>
      <ContainsSubjectStrings><String>urgent</String></ContainsSubjectStrings>
    </Exceptions>
    <Actions>
      <MoveToFolder><FolderId Id="folder-newsletters" ChangeKey="AQAAAA=="/></MoveToFolder>
      <StopProcessingRules>true</StopProcessingRules>
    </Actions>
  </Rule>`;

const kInvoicesRule = `
  <Rule xmlns="http://schemas.microsoft.com/exchange/services/2006/types">
    <RuleId>rule-2</RuleId>
    <DisplayName>Invoices</DisplayName>
    <Priority>2</Priority>
    <IsEnabled>true</IsEnabled>
    <Conditions>
      <ContainsSubjectOrBodyStrings><String>invoice</String></ContainsSubjectOrBodyStrings>
    </Conditions>
    <Actions>
      <MarkAsRead>true</MarkAsRead>
    </Actions>
  </Rule>`;

function envelope(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
    <Envelope xmlns="http://schemas.xmlsoap.org/soap/envelope/"><Body>${body}</Body></Envelope>`;
}

const kTypes = `xmlns="http://schemas.microsoft.com/exchange/services/2006/types"`;

function success(operation: string, content: string): string {
  return envelope(`<${operation}Response xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
    <ResponseMessages>
      <${operation}ResponseMessage ResponseClass="Success">
        <ResponseCode>NoError</ResponseCode>
        ${content}
      </${operation}ResponseMessage>
    </ResponseMessages>
  </${operation}Response>`);
}

/** An Exchange server with inbox rules.
 * Answers `GetInboxRules` with `rules`, and remembers the `UpdateInboxRules` requests. */
function newTestAccount(rules: string[]) {
  let account = new EWSAccount();
  account.name = "Alice";
  account.username = "alice@example.com";
  account.emailAddress = account.username;
  account.url = "https://exchange.example.com/EWS/Exchange.asmx";
  account.authMethod = AuthMethod.Unknown; // no credentials needed
  let updates: Document[] = [];
  let server = {
    rules,
    /** Classic Outlook saved its own copy of the rules */
    outlookRulesExist: false,
    /** The copy, @see `OutlookRulesCopy`. Exchange says that it exists, but we can't find it, if empty. */
    outlookRulesStreams: [] as Uint8Array[],
    /** The names of the operations, in the order of the requests */
    operations: [] as string[],
    /** What the server does with the update */
    onUpdate: () => {},
    updateResponse: `<UpdateInboxRulesResponse ResponseClass="Success" xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
      <ResponseCode>NoError</ResponseCode>
    </UpdateInboxRulesResponse>`,
  };
  globalThis.fetch = (async (_url: string, options: any) => {
    let request = new DOMParser().parseFromString(options.body, "text/xml");
    server.operations.push(request.getElementsByTagName("s:Body")[0]?.firstElementChild?.localName);
    if (request.getElementsByTagName("m:FindItem").length) {
      expect(request.getElementsByTagName("m:FindItem")[0].getAttribute("Traversal")).toBe("Associated");
      let copies = server.outlookRulesExist ? server.outlookRulesStreams : [];
      return { status: 200, text: async () => success("FindItem", `<RootFolder TotalItemsInView="${copies.length}" IncludesLastItemInRange="true"><Items ${kTypes}>
        ${copies.map((_stream, i) => `<Message><ItemId Id="copy-${i}" ChangeKey="AQAAAA=="/></Message>`).join("")}
      </Items></RootFolder>`) };
    }
    if (request.getElementsByTagName("m:GetItem").length) {
      let id = request.getElementsByTagName("t:ItemId")[0].getAttribute("Id");
      let stream = server.outlookRulesStreams[Number(id.replace("copy-", ""))];
      return { status: 200, text: async () => success("GetItem", `<Items><Message ${kTypes}>
        <ItemId Id="${id}" ChangeKey="AQAAAA=="/>
        <ExtendedProperty><ExtendedFieldURI PropertyTag="0x6802" PropertyType="Binary"/><Value>${base64(stream)}</Value></ExtendedProperty>
      </Message></Items>`) };
    }
    if (request.getElementsByTagName("m:UpdateInboxRules").length) {
      updates.push(request);
      server.onUpdate();
      return { status: 200, text: async () => envelope(server.updateResponse) };
    }
    return {
      status: 200,
      text: async () => envelope(`<GetInboxRulesResponse ResponseClass="Success" xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
        <ResponseCode>NoError</ResponseCode>
        <OutlookRuleBlobExists>${server.outlookRulesExist}</OutlookRuleBlobExists>
        <InboxRules>${server.rules.join("")}</InboxRules>
      </GetInboxRulesResponse>`),
    };
  }) as any;
  return { account, updates, server };
}

function localRule(account: EWSAccount, name: string): FilterRuleAction {
  let rule = new FilterRuleAction(account);
  rule.name = name;
  rule.markAsRead = true;
  account.filterRuleActions.add(rule);
  return rule;
}

function rule(account: EWSAccount, name: string): FilterRuleAction {
  return account.filterRuleActions.find(rule => rule.name == name);
}

function childNames(element: Element): string[] {
  return [...element.children].map(child => child.localName);
}

test("EWS: The server rules come in the order in which the server runs them, and the local rules stay", async () => {
  let { account } = newTestAccount([kInvoicesRule, kNewslettersRule]);
  let local = localRule(account, "Local");

  await account.refreshServerFilterRules();

  expect(account.filterRuleActions.contents).toContain(local);
  let serverRules = account.filterRuleActions.contents.filter(rule => rule.server);
  expect(serverRules.map(rule => rule.name)).toEqual(["Newsletters", "Invoices"]);
  let newsletters = rule(account, "Newsletters");
  expect(newsletters.criteria.includesPerson?.emailAddresses.first?.value).toBe("news@acme.example");
  expect(newsletters.toFolderID).toBe("folder-newsletters");
  expect(newsletters.copy).toBeFalsy();
  let invoices = rule(account, "Invoices");
  expect(invoices.criteria.bodyText).toBe("invoice");
  expect(invoices.markAsRead).toBe(true);
});

test("EWS: A server rule that the user changes keeps the parts that we don't understand", async () => {
  let { account, updates } = newTestAccount([kNewslettersRule, kInvoicesRule]);
  await account.refreshServerFilterRules();

  rule(account, "Newsletters").criteria.bodyText = "acme";
  await account.saveServerFilterRules();

  expect(updates.length).toBe(1);
  let update = updates[0];
  expect(update.getElementsByTagName("m:RemoveOutlookRuleBlob")[0].textContent).toBe("false");
  // Only the changed rule
  let setRules = [...update.getElementsByTagName("t:SetRuleOperation")].map(operation => operation.getElementsByTagName("t:Rule")[0]);
  expect(setRules.length).toBe(1);
  expect(update.getElementsByTagName("t:CreateRuleOperation").length).toBe(0);
  expect(update.getElementsByTagName("t:DeleteRuleOperation").length).toBe(0);
  let sent = setRules[0];
  expect(sent.getElementsByTagName("t:RuleId")[0].textContent).toBe("rule-1");
  // The server refuses to set it
  expect(sent.getElementsByTagName("t:IsNotSupported").length).toBe(0);
  // in schema order
  let conditions = sent.getElementsByTagName("t:Conditions")[0];
  expect(childNames(conditions)).toEqual(["ContainsSubjectOrBodyStrings", "FromAddresses", "SentToMe"]);
  expect(conditions.getElementsByTagName("t:ContainsSubjectOrBodyStrings")[0].textContent).toBe("acme");
  expect(conditions.getElementsByTagName("t:Name")[0].textContent).toBe("ACME News");
  expect(sent.getElementsByTagName("t:Exceptions")[0].getElementsByTagName("t:String")[0].textContent).toBe("urgent");
  let actions = sent.getElementsByTagName("t:Actions")[0];
  expect(childNames(actions)).toEqual(["MoveToFolder", "StopProcessingRules"]);
  let folder = actions.getElementsByTagName("t:FolderId")[0];
  expect(folder.getAttribute("Id")).toBe("folder-newsletters");
  expect(folder.getAttribute("ChangeKey")).toBe("AQAAAA==");
});

test("EWS: Saving without changes does not change the server rules", async () => {
  let { account, updates } = newTestAccount([kNewslettersRule, kInvoicesRule]);
  await account.refreshServerFilterRules();

  await account.saveServerFilterRules();

  expect(updates).toEqual([]);
});

test("EWS: Create, delete and reorder server rules", async () => {
  let { account, updates, server } = newTestAccount([kNewslettersRule, kInvoicesRule]);
  await account.refreshServerFilterRules();
  account.filterRuleActions.remove(rule(account, "Newsletters"));
  let created = localRule(account, "Created");
  created.criteria.bodyText = "offer";
  created.server = true;
  server.onUpdate = () => server.rules = [
    kInvoicesRule.replace("<Priority>2", "<Priority>1"),
    kInvoicesRule.replace("rule-2", "rule-3").replace("Invoices", "Created"), // with a new ID
  ];

  await account.saveServerFilterRules();

  expect(updates.length).toBe(1);
  let update = updates[0];
  let deleted = update.getElementsByTagName("t:DeleteRuleOperation");
  expect([...deleted].map(operation => operation.textContent.trim())).toEqual(["rule-1"]);
  let create = update.getElementsByTagName("t:CreateRuleOperation")[0].getElementsByTagName("t:Rule")[0];
  expect(create.getElementsByTagName("t:RuleId").length).toBe(0);
  expect(create.getElementsByTagName("t:DisplayName")[0].textContent).toBe("Created");
  // "Invoices" moved up
  let set = update.getElementsByTagName("t:SetRuleOperation")[0].getElementsByTagName("t:Rule")[0];
  expect(set.getElementsByTagName("t:RuleId")[0].textContent).toBe("rule-2");
  expect(set.getElementsByTagName("t:Priority")[0].textContent).toBe("1");
  expect(Number(create.getElementsByTagName("t:Priority")[0].textContent)).toBeGreaterThan(1);
  expect(created.serverID).toBe("rule-3");
  expect(account.filterRuleActions.contents.filter(rule => rule.server).map(rule => rule.name)).toEqual(["Invoices", "Created"]);
});

test("EWS: A rule that the user made local again is deleted on the server", async () => {
  let { account, updates } = newTestAccount([kNewslettersRule, kInvoicesRule]);
  await account.refreshServerFilterRules();
  let invoices = rule(account, "Invoices");

  invoices.server = false;
  await account.saveServerFilterRules();

  let deleted = updates[0].getElementsByTagName("t:DeleteRuleOperation");
  expect([...deleted].map(operation => operation.textContent.trim())).toEqual(["rule-2"]);
  expect(invoices.serverID).toBeNull();
  expect(account.filterRuleActions.contents).toContain(invoices);
});

test("EWS: A criterion that Exchange cannot check is not saved to the server", async () => {
  let { account, updates } = newTestAccount([kNewslettersRule]);
  await account.refreshServerFilterRules();

  rule(account, "Newsletters").criteria.isReplied = false;

  await expect(account.saveServerFilterRules()).rejects.toThrow();
  expect(updates).toEqual([]);
});

test("EWS: Rules that Outlook runs are not deleted", async () => {
  let { account, server } = newTestAccount([kNewslettersRule]);
  await account.refreshServerFilterRules();
  server.updateResponse = `<UpdateInboxRulesResponse ResponseClass="Error" xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
    <MessageText>Outlook rule blob exists.</MessageText>
    <ResponseCode>ErrorOutlookRuleBlobExists</ResponseCode>
  </UpdateInboxRulesResponse>`;

  rule(account, "Newsletters").markAsRead = true;

  await expect(account.saveServerFilterRules()).rejects.toThrow(/Outlook/);
});

const kTwoSendersRule = `
  <Rule xmlns="http://schemas.microsoft.com/exchange/services/2006/types">
    <RuleId>rule-4</RuleId>
    <DisplayName>Family</DisplayName>
    <Priority>1</Priority>
    <IsEnabled>true</IsEnabled>
    <Conditions>
      <FromAddresses>
        <Address><EmailAddress>mom@example.com</EmailAddress></Address>
        <Address><EmailAddress>dad@example.com</EmailAddress></Address>
      </FromAddresses>
    </Conditions>
    <Actions>
      <AssignCategories><String>Family</String></AssignCategories>
    </Actions>
  </Rule>`;

test("EWS: The parts of a rule that we can't show are listed as text", async () => {
  let { account } = newTestAccount([kNewslettersRule]);
  await account.refreshServerFilterRules();

  let parts = rule(account, "Newsletters").serverRule.unknownParts;

  expect(parts.length).toBe(3); // sent to me, the exception, stop processing
  expect(parts.some(part => part.includes("urgent"))).toBe(true);
  expect(parts.some(part => /stop processing/i.test(part))).toBe(true);
  expect(parts.join()).not.toContain("news@acme.example"); // we show the sender
});

test("EWS: A condition with several senders is not shown as one sender, and stays", async () => {
  let { account, updates } = newTestAccount([kTwoSendersRule]);
  await account.refreshServerFilterRules();
  let family = rule(account, "Family");

  expect(family.criteria.includesPersonEMail).toBeNull();
  expect(family.serverRule.unknownParts.join()).toContain("dad@example.com");

  family.name = "Parents";
  await account.saveServerFilterRules();
  let addresses = [...updates[0].getElementsByTagName("t:EmailAddress")].map(element => element.textContent);
  expect(addresses).toEqual(["mom@example.com", "dad@example.com"]);
});

test("EWS: The user cannot overwrite a condition that we can't show", async () => {
  let { account, updates } = newTestAccount([kTwoSendersRule]);
  await account.refreshServerFilterRules();
  let family = rule(account, "Family");

  family.criteria.includesPersonEMail = "mom@example.com";

  await expect(account.saveServerFilterRules()).rejects.toThrow();
  expect(updates).toEqual([]);
});

test("EWS: A rule that Exchange does not support is read-only, but can move", async () => {
  let unsupported = kTwoSendersRule.replace("<IsEnabled>true</IsEnabled>", "<IsEnabled>true</IsEnabled><IsNotSupported>true</IsNotSupported>");
  let { account, updates } = newTestAccount([kInvoicesRule.replace("<Priority>2", "<Priority>1"), unsupported.replace("<Priority>1", "<Priority>2")]);
  await account.refreshServerFilterRules();
  let family = rule(account, "Family");
  expect(family.readOnlyReason).toBeTruthy();
  expect(rule(account, "Invoices").readOnlyReason).toBeNull();
  await account.saveServerFilterRules();
  expect(updates).toEqual([]);

  account.filterRuleActions.replaceAll([family, rule(account, "Invoices")]);
  await account.saveServerFilterRules();
  let set = [...updates[0].getElementsByTagName("t:SetRuleOperation")].map(operation => operation.getElementsByTagName("t:Rule")[0]);
  let sentFamily = set.find(sent => sent.getElementsByTagName("t:RuleId")[0].textContent == "rule-4");
  expect(sentFamily.getElementsByTagName("t:Priority")[0].textContent).toBe("1");
  expect(sentFamily.getElementsByTagName("t:Conditions").length).toBe(0); // Exchange accepts only the order

  family.markAsRead = true;
  await expect(account.saveServerFilterRules()).rejects.toThrow();
});

test("EWS: While Outlook keeps its own copy of the rules, the server rules are read-only, and the local rules not", async () => {
  let { account, server } = newTestAccount([kInvoicesRule]);
  server.outlookRulesExist = true;
  let local = localRule(account, "Local");

  await account.refreshServerFilterRules();

  expect(account.serverFilterRulesReadOnlyReason).toMatch(/Outlook/);
  expect(rule(account, "Invoices").readOnlyReason).toBe(account.serverFilterRulesReadOnlyReason);
  expect(local.readOnlyReason).toBeNull();

  server.outlookRulesExist = false;
  await account.refreshServerFilterRules();
  expect(rule(account, "Invoices").readOnlyReason).toBeNull();
});

test("EWS: When Outlook's copy of the rules has no rules of its own, the server rules stay editable, and Exchange may delete the copy", async () => {
  let { account, updates, server } = newTestAccount([kNewslettersRule, kInvoicesRule]);
  server.outlookRulesExist = true;
  server.outlookRulesStreams = [outlookRulesStream([{ name: "Newsletters" }, { name: "Invoices" }])];

  await account.refreshServerFilterRules();
  expect(rule(account, "Invoices").readOnlyReason).toBeNull();
  expect(account.serverFilterRulesNotice).toMatch(/Outlook/);

  rule(account, "Invoices").criteria.bodyText = "bill";
  server.operations.length = 0;
  await account.saveServerFilterRules();

  expect(updates.length).toBe(1);
  expect(updates[0].getElementsByTagName("m:RemoveOutlookRuleBlob")[0].textContent).toBe("true");
  // Outlook may have changed its copy in the meantime
  expect(server.operations.slice(0, server.operations.indexOf("UpdateInboxRules"))).toContain("GetItem");
});

test("EWS: The rules that only Outlook's copy of the rules has keep the server rules read-only, and the user sees their names", async () => {
  let { account, server } = newTestAccount([kNewslettersRule, kInvoicesRule]);
  server.outlookRulesExist = true;
  server.outlookRulesStreams = [outlookRulesStream([
    { name: "Newsletters" },
    { name: "Cc my boss", isForSentMail: true },
    { name: "Invoices" },
    { name: "Old", isEnabled: false },
  ])];
  let local = localRule(account, "Local");

  await account.refreshServerFilterRules();

  let reason = rule(account, "Invoices").readOnlyReason;
  expect(reason).toContain("Cc my boss");
  expect(reason).toContain("Old");
  expect(reason).not.toContain("Newsletters");
  expect(account.serverFilterRulesNotice).toBeNull();
  expect(local.readOnlyReason).toBeNull();
});

test("EWS: When Outlook adds a rule for sent mail after we read its copy of the rules, the change is refused", async () => {
  let { account, updates, server } = newTestAccount([kInvoicesRule]);
  server.outlookRulesExist = true;
  server.outlookRulesStreams = [outlookRulesStream([{ name: "Invoices" }])];
  await account.refreshServerFilterRules();
  rule(account, "Invoices").criteria.bodyText = "bill";

  server.outlookRulesStreams = [outlookRulesStream([{ name: "Invoices" }, { name: "Cc my boss", isForSentMail: true }])];

  await expect(account.saveServerFilterRules()).rejects.toThrow("Cc my boss");
  expect(updates).toEqual([]);
  expect(rule(account, "Invoices").readOnlyReason).toContain("Cc my boss");
});

test("EWS: A copy of the rules that we can't read keeps the server rules read-only", async () => {
  let { account, server } = newTestAccount([kInvoicesRule]);
  server.outlookRulesExist = true;
  server.outlookRulesStreams = [new Uint8Array([1, 2, 3, 4])];

  await account.refreshServerFilterRules();

  expect(rule(account, "Invoices").readOnlyReason).toMatch(/Outlook/);
  expect(account.dataErrors.length).toBe(1);
});

test("EWS: A copy of a server rule keeps the parts that we can't show", async () => {
  let { account, updates } = newTestAccount([kNewslettersRule]);
  await account.refreshServerFilterRules();
  let copy = rule(account, "Newsletters").clone();
  copy.name = "Copy of Newsletters";
  copy.serverID = null;
  account.filterRuleActions.add(copy);

  await account.saveServerFilterRules();

  let created = updates[0].getElementsByTagName("t:CreateRuleOperation")[0].getElementsByTagName("t:Rule")[0];
  expect(created.getElementsByTagName("t:RuleId").length).toBe(0);
  expect(created.getElementsByTagName("t:DisplayName")[0].textContent).toBe("Copy of Newsletters");
  expect(created.getElementsByTagName("t:Exceptions")[0].textContent).toContain("urgent");
  expect(created.getElementsByTagName("t:StopProcessingRules").length).toBe(1);
});

test("EWS: A rule with parts that we can't run does not move to us", async () => {
  let { account, updates } = newTestAccount([kNewslettersRule]);
  await account.refreshServerFilterRules();

  rule(account, "Newsletters").server = false;

  await expect(account.saveServerFilterRules()).rejects.toThrow();
  expect(updates).toEqual([]);
});
