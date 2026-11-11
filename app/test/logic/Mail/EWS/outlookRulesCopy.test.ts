import { OutlookRulesCopy } from "../../../../logic/Mail/EWS/OutlookRulesCopy";
import type { FilterRuleAction } from "../../../../logic/Mail/FilterRules/FilterRuleAction";
import { outlookRulesStream } from "./outlookRulesStream";
import { expect, test } from "vitest";

function serverRules(...names: string[]): FilterRuleAction[] {
  return names.map(name => ({ name }) as FilterRuleAction);
}

test("Outlook's copy of the rules: name, state and moment of each rule", () => {
  let longName = "Newsletters ".repeat(30);
  let copy = new OutlookRulesCopy(outlookRulesStream([
    { name: "Invoices" },
    { name: "Cc my boss", isForSentMail: true },
    { name: "Old", isEnabled: false },
    { name: longName },
  ]));

  expect(copy.rules.contents.map(rule => rule.name)).toEqual(["Invoices", "Cc my boss", "Old", longName]);
  expect(copy.rules.contents.map(rule => rule.isEnabled)).toEqual([true, true, false, true]);
  expect(copy.rules.contents.map(rule => rule.isForSentMail)).toEqual([false, true, false, false]);
});

test("Outlook's copy of the rules without rules", () => {
  expect(new OutlookRulesCopy(outlookRulesStream([])).rules.isEmpty).toBe(true);
});

test("Outlook's copy of the rules: The rules that only the copy has", () => {
  let copy = new OutlookRulesCopy(outlookRulesStream([
    { name: "Invoices" },
    { name: "Invoices", isForSentMail: true },
    { name: "Old", isEnabled: false },
    { name: "Family" },
    { name: "Family" },
  ]));

  let lost = copy.lostRules(serverRules("Family", "Invoices", "Created in OWA"));

  // The rule for sent mail is lost, although the server has a rule with the same name
  expect(lost.contents.map(rule => rule.name)).toEqual(["Invoices", "Old", "Family"]);
  expect(lost.contents[0].isForSentMail).toBe(true);
});

test("Outlook's copy of the rules: Nothing is lost, if the server has all rules", () => {
  let copy = new OutlookRulesCopy(outlookRulesStream([{ name: "Invoices" }, { name: "Old", isEnabled: false }]));

  expect(copy.lostRules(serverRules("Old", "Invoices")).isEmpty).toBe(true);
});

test("Outlook's copy of the rules: A format that we don't know is refused", () => {
  let stream = outlookRulesStream([{ name: "Invoices" }]);
  let outlook2000 = stream.slice();
  new DataView(outlook2000.buffer).setUint32(0, 980413, true);
  expect(() => new OutlookRulesCopy(outlook2000)).toThrow();

  expect(() => new OutlookRulesCopy(stream.subarray(0, stream.length - 1))).toThrow();
  expect(() => new OutlookRulesCopy(stream.subarray(0, 60))).toThrow();
  expect(() => new OutlookRulesCopy(new Uint8Array([...stream, 0, 0]))).toThrow();
  expect(() => new OutlookRulesCopy(new Uint8Array())).toThrow();

  let withoutMoment = stream.slice();
  let momentElement = withoutMoment.findIndex((byte, i) => byte == 0x90 && withoutMoment[i + 1] == 0x01);
  withoutMoment[momentElement] = 0x91;
  expect(() => new OutlookRulesCopy(withoutMoment)).toThrow();
});
