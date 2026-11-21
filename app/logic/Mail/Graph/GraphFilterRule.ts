import { ServerFilterRule } from "../FilterRules/ServerFilterRule";
import type { FilterRuleAction } from "../FilterRules/FilterRuleAction";
import { getTagByName } from "../../Abstract/Tag";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

/** A rule that the Exchange server runs on incoming mail, as `messageRule` of MS Graph.
 * <https://learn.microsoft.com/en-us/graph/api/resources/messagerule> */
export class GraphFilterRule extends ServerFilterRule {
  protected readonly canCheckDates = false;

  get id(): string | null {
    return sanitize.nonemptystring(this.json.id, null);
  }

  get priority(): number {
    return sanitize.integer(this.json.sequence, 0);
  }

  get isReadOnly(): boolean {
    return this.json.isReadOnly === true;
  }

  get isEnabled(): boolean {
    return this.json.isEnabled !== false;
  }

  get hasError(): boolean {
    return this.json.hasError === true;
  }

  protected get sections(): Record<string, Record<string, any>> {
    return {
      conditions: this.json.conditions ?? {},
      exceptions: this.json.exceptions ?? {},
      actions: this.json.actions ?? {},
    };
  }

  protected isUnderstood(section: string, key: string, value: any): boolean {
    switch (section) {
    case "conditions":
      switch (key) {
      case "bodyOrSubjectContains":
      case "categories": // Exchange checks for any of the categories, we for all
        return this.strings(value).length == 1;
      case "fromAddresses":
        return Array.isArray(value) && value.length == 1 && !!sanitize.emailAddress(value[0]?.emailAddress?.address, null);
      case "hasAttachments":
        return value === true;
      case "messageActionFlag":
        return value == "any";
      case "withinSizeRange":
        return Object.values(value).every((size: any) => sanitize.integer(size, null) != null);
      }
      return false;
    case "exceptions": // Our rules have no exceptions
      return false;
    case "actions":
      switch (key) {
      case "assignCategories":
        return this.strings(value).length > 0;
      case "moveToFolder":
        return typeof value == "string";
      case "copyToFolder":
        return typeof value == "string" && this.isEmpty(this.json.actions.moveToFolder);
      case "markAsRead":
      case "delete":
      case "permanentDelete":
        return value === true;
      }
      return false;
    }
    return false;
  }

  protected fillFilterRule(rule: FilterRuleAction) {
    rule.name = sanitize.nonemptylabel(this.json.displayName, "-");
    let conditions = this.sections.conditions;
    let condition = (key: string) => this.understood("conditions", key);
    let criteria = rule.criteria;
    criteria.bodyText = condition("bodyOrSubjectContains") ? this.strings(conditions.bodyOrSubjectContains)[0] : null;
    criteria.includesPersonEMail = condition("fromAddresses") ? sanitize.emailAddress(conditions.fromAddresses[0].emailAddress.address) : null;
    criteria.tags.replaceAll(condition("categories") ? this.strings(conditions.categories).map(name => getTagByName(name)) : []);
    criteria.hasAttachment = condition("hasAttachments") ? true : null;
    criteria.isStarred = condition("messageActionFlag") ? true : null;
    let size = condition("withinSizeRange") ? conditions.withinSizeRange : {};
    criteria.sizeMin = size.minimumSize ? sanitize.integer(size.minimumSize) * 1024 : null;
    criteria.sizeMax = size.maximumSize ? sanitize.integer(size.maximumSize) * 1024 : null;

    let actions = this.sections.actions;
    let action = (key: string) => this.understood("actions", key);
    rule.markAsRead = action("markAsRead") ? true : null;
    rule.deleteTrash = action("delete") ? true : null;
    rule.deleteImmediately = action("permanentDelete") ? true : null;
    let folderID = action("moveToFolder") ? actions.moveToFolder : action("copyToFolder") ? actions.copyToFolder : null;
    rule.toFolderID = folderID ? sanitize.nonemptystring(folderID) : null;
    rule.copy = !action("moveToFolder") && action("copyToFolder") ? true : null;
    rule.addTags.replaceAll(action("assignCategories") ? this.strings(actions.assignCategories).map(name => getTagByName(name)) : []);
  }

  protected writeChanges(json: any, rule: FilterRuleAction, original: FilterRuleAction) {
    if (rule.name != original.name) {
      json.displayName = rule.name;
    }
    json.isEnabled ??= true;
    let conditions = structuredClone(this.sections.conditions);
    if (this.merge("conditions", conditions, this.conditionsOf(rule), this.conditionsOf(original), rule)) {
      json.conditions = conditions;
    }
    let actions = structuredClone(this.sections.actions);
    if (this.merge("actions", actions, this.actionsOf(rule), this.actionsOf(original), rule)) {
      json.actions = actions;
    }
  }

  protected setPriority(priority: number) {
    this.json.sequence = priority;
  }

  protected conditionsOf(rule: FilterRuleAction): Record<string, any> {
    let criteria = rule.criteria;
    let conditions: Record<string, any> = {};
    if (criteria.bodyText) {
      conditions.bodyOrSubjectContains = [criteria.bodyText];
    }
    if (criteria.includesPersonEMail) {
      conditions.fromAddresses = [{ emailAddress: { address: criteria.includesPersonEMail } }];
    }
    if (criteria.tags.hasItems) {
      conditions.categories = criteria.tags.contents.map(tag => tag.name);
    }
    if (criteria.hasAttachment) {
      conditions.hasAttachments = true;
    }
    if (criteria.isStarred) {
      conditions.messageActionFlag = "any";
    }
    if (criteria.sizeMin || criteria.sizeMax) {
      conditions.withinSizeRange = {};
      if (criteria.sizeMin) {
        conditions.withinSizeRange.minimumSize = Math.floor(criteria.sizeMin / 1024);
      }
      if (criteria.sizeMax) {
        conditions.withinSizeRange.maximumSize = Math.ceil(criteria.sizeMax / 1024);
      }
    }
    return conditions;
  }

  protected actionsOf(rule: FilterRuleAction): Record<string, any> {
    let actions: Record<string, any> = {};
    if (rule.addTags.hasItems) {
      actions.assignCategories = rule.addTags.contents.map(tag => tag.name);
    }
    if (rule.toFolderID) {
      actions[rule.copy ? "copyToFolder" : "moveToFolder"] = rule.toFolderID;
    }
    if (rule.deleteTrash) {
      actions.delete = true;
    }
    if (rule.markAsRead) {
      actions.markAsRead = true;
    }
    if (rule.deleteImmediately) {
      actions.permanentDelete = true;
    }
    return actions;
  }

  /** For creating the rule */
  get newProperties(): Record<string, any> {
    let { displayName, sequence, isEnabled, conditions, exceptions, actions } = this.json;
    return { displayName, sequence, isEnabled, conditions, exceptions, actions };
  }

  /** Shows an email address without the name */
  protected plainText(value: any): string {
    if (typeof value?.address == "string") {
      return sanitize.label(value.address, "");
    }
    return super.plainText(value);
  }
}
