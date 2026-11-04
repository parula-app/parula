import type { FilterRuleAction } from "../../../logic/Mail/FilterRules/FilterRuleAction";
import { FilterMoment } from "../../../logic/Mail/FilterRules/FilterMoments";
import { allRuleItems, type RuleItem, type RulePhrasePart } from "./RuleItems";
import { gt } from "../../../l10n/l10n";

export interface RuleDescriptionLine {
  item: RuleItem | null;
  parts: RulePhrasePart[];
}

export function ruleDescriptionLines(rule: FilterRuleAction, checkedIDs?: Set<string>): RuleDescriptionLine[] {
  let items = checkedIDs
    ? allRuleItems().filter(item => checkedIDs.has(item.id))
    : allRuleItems().filter(item => item.isActive(rule));
  return [
    { item: null, parts: [{ text: ruleWhenText(rule.when), isValue: false }] },
    ...items.map(item => ({ item, parts: item.descriptionParts(rule) })),
  ];
}

export function ruleWhenText(when: FilterMoment): string {
  switch (when) {
    case FilterMoment.IncomingAfterSpam:
      return gt`Apply this rule after the message arrives and after the junk check`;
    case FilterMoment.Outgoing:
      return gt`Apply this rule after I send the message`;
    default:
      return gt`Apply this rule after the message arrives`;
  }
}
