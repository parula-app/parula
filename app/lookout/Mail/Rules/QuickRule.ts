import type { EMail } from "../../../logic/Mail/EMail";
import type { MailAccount } from "../../../logic/Mail/MailAccount";
import type { Folder } from "../../../logic/Mail/Folder";
import type { Person } from "../../../logic/Abstract/Person";
import { FilterRuleAction } from "../../../logic/Mail/FilterRules/FilterRuleAction";
import { assert } from "../../../logic/util/util";
import { gt } from "../../../l10n/l10n";

export class QuickRule {
  readonly account: MailAccount;
  readonly sender: Person | null;
  readonly senderName: string;
  fromSender = false;
  hasText = false;
  text: string;
  moveToFolder = false;
  folder: Folder | null = null;
  markAsRead = false;
  flag = false;

  constructor(message: EMail) {
    this.account = message.folder?.account;
    assert(this.account, gt`The message has no account`);
    this.sender = message.from?.findPerson() ?? null;
    this.senderName = message.from?.name || message.from?.emailAddress || "";
    this.fromSender = !!this.sender;
    this.text = message.subject ?? "";
  }

  get hasCondition(): boolean {
    return (this.fromSender && !!this.sender) || (this.hasText && !!this.text);
  }

  get hasAction(): boolean {
    return (this.moveToFolder && !!this.folder) || this.markAsRead || this.flag;
  }

  get disabledReason(): string | null {
    if (this.moveToFolder && !this.folder) {
      return gt`Please select a folder`;
    }
    if (!this.hasCondition) {
      return gt`Please select at least one condition`;
    }
    if (!this.hasAction) {
      return gt`Please select at least one action`;
    }
    return null;
  }

  createRule(): FilterRuleAction {
    let rule = new FilterRuleAction(this.account);
    if (this.fromSender && this.sender) {
      rule.criteria.includesPerson = this.sender;
    }
    if (this.hasText && this.text) {
      rule.criteria.bodyText = this.text;
    }
    if (this.moveToFolder && this.folder) {
      rule.toFolder = this.folder;
    }
    if (this.markAsRead) {
      rule.markAsRead = true;
    }
    if (this.flag) {
      rule.markAsStarred = true;
    }
    rule.name = this.fromSender && this.sender
      ? gt`From ${this.senderName}`
      : this.text || gt`New rule`;
    return rule;
  }

  static async alwaysMoveFrom(message: EMail, folder: Folder): Promise<FilterRuleAction> {
    let quickRule = new QuickRule(message);
    assert(quickRule.sender, gt`The sender is not in your address book`);
    quickRule.fromSender = true;
    quickRule.moveToFolder = true;
    quickRule.folder = folder;
    return await quickRule.save();
  }

  async save(): Promise<FilterRuleAction> {
    let rule = this.createRule();
    this.account.filterRuleActions.add(rule);
    await this.account.save();
    return rule;
  }
}
