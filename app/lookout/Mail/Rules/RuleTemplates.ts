import { FilterMoment } from "../../../logic/Mail/FilterRules/FilterMoments";
import { gt } from "../../../l10n/l10n";

export class RuleTemplate {
  constructor(
    readonly id: string,
    readonly group: string,
    readonly label: string,
    readonly when: FilterMoment,
    readonly conditionIDs: string[],
    readonly actionIDs: string[],
    readonly example: string | null,
  ) {
  }
}

export function ruleTemplates(): RuleTemplate[] {
  let organized = gt`Stay Organized`;
  let blank = gt`Start from a blank rule`;
  return [
    new RuleTemplate("move-from", organized, gt`Move messages from someone to a folder`,
      FilterMoment.IncomingBeforeSpam, ["from"], ["move"],
      gt`Move mail from my manager to my High Importance folder`),
    new RuleTemplate("move-words", organized, gt`Move messages with specific words in the subject or body to a folder`,
      FilterMoment.IncomingBeforeSpam, ["words"], ["move"],
      gt`Move mail with Invoice in the subject to my Accounting folder`),
    new RuleTemplate("flag-from", organized, gt`Flag messages from someone for follow-up`,
      FilterMoment.IncomingBeforeSpam, ["from"], ["flag"],
      gt`Flag mail from my team lead for follow-up`),
    new RuleTemplate("receive", blank, gt`Apply rule on messages I receive`,
      FilterMoment.IncomingBeforeSpam, [], [], null),
    new RuleTemplate("receive-after-junk", blank, gt`Apply rule on messages I receive, after the junk check`,
      FilterMoment.IncomingAfterSpam, [], [], null),
    new RuleTemplate("send", blank, gt`Apply rule on messages I send`,
      FilterMoment.Outgoing, [], [], null),
  ];
}
