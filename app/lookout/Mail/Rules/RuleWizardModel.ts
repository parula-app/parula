import type { MailAccount } from "../../../logic/Mail/MailAccount";
import { FilterRuleAction } from "../../../logic/Mail/FilterRules/FilterRuleAction";
import { FilterMoment } from "../../../logic/Mail/FilterRules/FilterMoments";
import { ruleDescriptionLines, type RuleDescriptionLine } from "./RuleDescription";
import { ruleConditions, ruleActions, allRuleItems, tagNames, type RuleItem } from "./RuleItems";
import { ruleTemplates, type RuleTemplate } from "./RuleTemplates";
import { gt } from "../../../l10n/l10n";

export enum RuleWizardPage {
  Templates = "templates",
  Conditions = "conditions",
  Actions = "actions",
  Finish = "finish",
}

export class RuleWizardModel {
  readonly account: MailAccount;
  readonly conditions = ruleConditions();
  readonly actions = ruleActions();
  readonly templates: RuleTemplate[];
  readonly pages: RuleWizardPage[];
  readonly isNew: boolean;
  page: RuleWizardPage;
  rule: FilterRuleAction;
  name: string;
  template: RuleTemplate | null = null;
  readonly checked = new Set<string>();
  protected readonly shownIDs = new Set<string>();
  protected autoName = "";

  protected constructor(rule: FilterRuleAction, withTemplates: boolean, isNew: boolean) {
    this.account = rule.account;
    this.isNew = isNew;
    this.templates = withTemplates ? ruleTemplates() : [];
    this.pages = [
      ...(withTemplates ? [RuleWizardPage.Templates] : []),
      RuleWizardPage.Conditions,
      RuleWizardPage.Actions,
      RuleWizardPage.Finish,
    ];
    this.page = this.pages[0];
    this.rule = RuleWizardModel.copyOf(rule);
    this.name = rule.name ?? "";
    for (let item of allRuleItems().filter(item => item.isActive(this.rule))) {
      this.checked.add(item.id);
      this.shownIDs.add(item.id);
    }
    if (withTemplates) {
      this.selectTemplate(this.templates[0]);
    }
  }

  static forNewRule(account: MailAccount): RuleWizardModel {
    return new RuleWizardModel(new FilterRuleAction(account), true, true);
  }

  static forRule(rule: FilterRuleAction, isNew = false): RuleWizardModel {
    return new RuleWizardModel(rule, false, isNew);
  }

  static copyOf(rule: FilterRuleAction): FilterRuleAction {
    let copy = rule.clone();
    copy.name = rule.name;
    return copy;
  }

  static copyInto(source: FilterRuleAction, target: FilterRuleAction) {
    target.fromJSON(source.toJSON());
    target.name = source.name;
  }

  get items(): RuleItem[] {
    return [...this.conditions, ...this.actions];
  }

  get shownConditions(): RuleItem[] {
    return this.conditions.filter(item => !item.onlyWhenActive || this.shownIDs.has(item.id));
  }

  item(id: string): RuleItem | null {
    return this.items.find(item => item.id == id) ?? null;
  }

  isChecked(item: RuleItem): boolean {
    return this.checked.has(item.id);
  }

  setChecked(item: RuleItem, checked: boolean) {
    if (!checked) {
      this.checked.delete(item.id);
      item.uncheck(this.rule);
      return;
    }
    for (let excluded of this.items.filter(candidate => item.excludes(candidate) && this.isChecked(candidate))) {
      this.setChecked(excluded, false);
    }
    this.checked.add(item.id);
    item.check(this.rule);
  }

  valueChanged(item: RuleItem) {
    if (!this.isChecked(item) && !item.isMissingValue(this.rule)) {
      this.setChecked(item, true);
    }
  }

  selectTemplate(template: RuleTemplate) {
    this.template = template;
    this.rule = new FilterRuleAction(this.account);
    this.rule.when = template.when;
    this.checked.clear();
    for (let id of [...template.conditionIDs, ...template.actionIDs]) {
      this.setChecked(this.item(id), true);
    }
  }

  get lines(): RuleDescriptionLine[] {
    return ruleDescriptionLines(this.rule, this.checked);
  }

  get hasConditions(): boolean {
    return this.conditions.some(item => this.isChecked(item));
  }

  get hasActions(): boolean {
    return this.actions.some(item => this.isChecked(item));
  }

  get noConditionsQuestion(): string {
    return this.rule.when == FilterMoment.Outgoing
      ? gt`This rule will be applied to every message you send. Is this correct?`
      : gt`This rule will be applied to every message you receive. Is this correct?`;
  }

  get pageIndex(): number {
    return this.pages.indexOf(this.page);
  }

  get canGoBack(): boolean {
    return this.pageIndex > 0;
  }

  back() {
    if (this.canGoBack) {
      this.page = this.pages[this.pageIndex - 1];
    }
  }

  get nextDisabledReason(): string | null {
    switch (this.page) {
      case RuleWizardPage.Finish:
        return gt`This is the last step`;
      case RuleWizardPage.Conditions:
        return this.missingValueReason(this.conditions);
      case RuleWizardPage.Actions:
        if (!this.hasActions) {
          return gt`Select at least one action`;
        }
        return this.missingValueReason(this.actions);
      default:
        return null;
    }
  }

  get asksNoConditionsQuestion(): boolean {
    return this.pageIndex <= this.pages.indexOf(RuleWizardPage.Conditions) && !this.hasConditions;
  }

  next() {
    if (this.nextDisabledReason) {
      return;
    }
    this.page = this.pages[this.pageIndex + 1];
    if (this.page == RuleWizardPage.Finish) {
      this.suggestName();
    }
  }

  get finishDisabledReason(): string | null {
    let missing = this.missingValueReason(this.items);
    if (missing) {
      return missing;
    }
    if (!this.hasActions) {
      return gt`Select at least one action`;
    }
    if ((!!this.rule.toFolderID && !this.rule.toFolder) || (!!this.rule.criteria.folderID && !this.rule.criteria.folder)) {
      return gt`The folder of this rule does not exist anymore. Choose another folder.`;
    }
    if (this.page == RuleWizardPage.Finish && !this.name.trim()) {
      return gt`Enter a name for this rule`;
    }
    return null;
  }

  finish(): FilterRuleAction {
    this.clearUnchecked();
    if (!this.name.trim()) {
      this.suggestName();
    }
    this.rule.name = this.name.trim();
    return this.rule;
  }

  suggestName() {
    if (this.name.trim() && this.name != this.autoName) {
      return;
    }
    this.name = this.autoName = this.suggestedName();
  }

  protected suggestedName(): string {
    let criteria = this.rule.criteria;
    if (this.checked.has("from") && criteria.includesPerson) {
      let person = criteria.includesPerson;
      return gt`From ${person.name || person.emailAddresses.first?.value}`;
    }
    if (this.checked.has("words") && criteria.bodyText) {
      return criteria.bodyText;
    }
    if (this.checked.has("category") && criteria.tags.hasItems) {
      return tagNames(criteria.tags);
    }
    if ((this.checked.has("move") || this.checked.has("copy")) && this.rule.toFolder) {
      return this.rule.toFolder.name;
    }
    return gt`New rule`;
  }

  protected missingValueReason(items: RuleItem[]): string | null {
    if (items.some(item => this.isChecked(item) && item.isMissingValue(this.rule))) {
      return gt`Click each underlined value in the rule description and choose a value`;
    }
    return null;
  }

  protected clearUnchecked() {
    for (let i = 0; i < this.items.length; i++) {
      let stale = this.items.find(item => !this.isChecked(item) && item.isActive(this.rule));
      if (!stale) {
        return;
      }
      stale.uncheck(this.rule);
    }
  }
}
