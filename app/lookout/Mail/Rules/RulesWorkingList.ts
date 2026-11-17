import type { MailAccount } from "../../../logic/Mail/MailAccount";
import { FilterRuleAction } from "../../../logic/Mail/FilterRules/FilterRuleAction";
import { RuleWizardModel } from "./RuleWizardModel";
import { ArrayColl } from "svelte-collections";

export class RulesWorkingList {
  readonly account: MailAccount;
  readonly rules = new ArrayColl<FilterRuleAction>();
  protected readonly originalOf = new Map<FilterRuleAction, FilterRuleAction>();
  protected savedJSON = "";

  constructor(account: MailAccount) {
    this.account = account;
    for (let original of account.filterRuleActions) {
      let copy = RuleWizardModel.copyOf(original);
      this.originalOf.set(copy, original);
      this.rules.add(copy);
    }
    this.savedJSON = this.json();
  }

  get isChanged(): boolean {
    return this.json() != this.savedJSON;
  }

  async apply() {
    if (!this.isChanged) {
      return;
    }
    let originals = this.rules.contents.map(copy => {
      let original = this.originalOf.get(copy) ?? new FilterRuleAction(this.account);
      RuleWizardModel.copyInto(copy, original);
      this.originalOf.set(copy, original);
      return original;
    });
    this.account.filterRuleActions.replaceAll(originals);
    await this.account.save();
    this.savedJSON = this.json();
  }

  protected json(): string {
    return JSON.stringify(this.rules.contents.map(rule => rule.toJSON()));
  }
}
