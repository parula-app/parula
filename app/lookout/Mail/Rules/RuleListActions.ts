import { FilterRuleAction } from "../../../logic/Mail/FilterRules/FilterRuleAction";
import type { Folder } from "../../../logic/Mail/Folder";
import type { MailAccount } from "../../../logic/Mail/MailAccount";
import { gt } from "../../../l10n/l10n";
import type { ArrayColl } from "svelte-collections";

export class RuleListActions {
  static move(rules: ArrayColl<FilterRuleAction>, rule: FilterRuleAction, offset: number) {
    let index = rules.indexOf(rule);
    let newIndex = index + offset;
    if (index < 0 || newIndex < 0 || newIndex >= rules.length) {
      return;
    }
    rules.splice(index, 1);
    rules.splice(newIndex, 0, rule);
  }

  static copy(rules: ArrayColl<FilterRuleAction>, rule: FilterRuleAction): FilterRuleAction {
    let copy = rule.clone();
    copy.name = gt`Copy of ${rule.name}`;
    let index = rules.indexOf(rule);
    if (index < 0) {
      rules.add(copy);
    } else {
      rules.splice(index + 1, 0, copy);
    }
    return copy;
  }

  static cannotCopyTo(rule: FilterRuleAction, account: MailAccount): string | false {
    if (account == rule.account) {
      return false;
    }
    if (rule.toFolderID || rule.criteria.folderID) {
      return gt`This rule uses a folder of ${rule.account.name}, so it can only be copied within that account`;
    }
    return false;
  }

  static copyToAccount(rule: FilterRuleAction, account: MailAccount, rules: ArrayColl<FilterRuleAction>): FilterRuleAction {
    if (account == rule.account) {
      return RuleListActions.copy(rules, rule);
    }
    let copy = new FilterRuleAction(account);
    copy.fromJSON(rule.toJSON());
    copy.name = rule.name;
    rules.add(copy);
    return copy;
  }

  static moveToFolder(rule: FilterRuleAction, folder: Folder, copy: boolean) {
    rule.toFolder = folder;
    rule.copy = copy;
    rule.deleteTrash = null;
    rule.deleteImmediately = null;
    if (rule.markAsSpam) {
      rule.markAsSpam = null;
    }
  }

  static deleteMessage(rule: FilterRuleAction) {
    // <copied from="../../../frontend/Mail/Search/RuleActions.svelte" updateDelete()>
    rule.markAsSpam = rule.markAsSpam ? true : null;
    rule.markAsStarred = null;
    rule.copy = null;
    rule.toFolder = null;
    rule.addTags.clear();
    // </copied>
    rule.deleteTrash = true;
    rule.deleteImmediately = null;
  }
}
