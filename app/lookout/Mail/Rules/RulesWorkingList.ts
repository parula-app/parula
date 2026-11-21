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
    this.reload();
  }

  get isChanged(): boolean {
    return this.json() != this.savedJSON;
  }

  /** Takes the rules of the account again, e.g. after the server sent its rules.
   * Keeps our copies of the rules that are still there. */
  reload() {
    let copyOf = new Map([...this.originalOf].map(([copy, original]) => [original, copy]));
    this.originalOf.clear();
    let copies = this.account.filterRuleActions.contents.map(original => {
      let copy = copyOf.get(original);
      if (copy) {
        RuleWizardModel.copyInto(original, copy);
      } else {
        copy = RuleWizardModel.copyOf(original);
      }
      this.originalOf.set(copy, original);
      return copy;
    });
    this.rules.replaceAll(copies);
    this.savedJSON = this.json();
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
    try {
      await this.account.saveServerFilterRules();
    } finally {
      this.reload(); // the IDs of the rules that the server created
    }
  }

  protected json(): string {
    return JSON.stringify(this.rules.contents.map(rule => rule.toJSON()));
  }
}
