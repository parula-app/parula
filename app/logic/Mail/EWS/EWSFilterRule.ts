import { ServerFilterRule } from "../FilterRules/ServerFilterRule";
import type { FilterRuleAction } from "../FilterRules/FilterRuleAction";
import { getTagByName } from "../../Abstract/Tag";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { ensureArray } from "../../util/util";

/** A rule that the Exchange server runs on incoming mail, as EWS `RuleType`,
 * in the notation of `XML2JSON()`.
 * <https://learn.microsoft.com/en-us/exchange/client-developer/exchange-web-services/inbox-rules-in-ews-for-exchange> */
export class EWSFilterRule extends ServerFilterRule {
  protected readonly canReorderReadOnly = true;

  get id(): string | null {
    return sanitize.nonemptystring(this.json.RuleId, null);
  }

  get priority(): number {
    return sanitize.integer(this.json.Priority, 0);
  }

  /** Exchange allows to change only the order */
  get isReadOnly(): boolean {
    return this.json.IsNotSupported == "true";
  }

  get isEnabled(): boolean {
    return this.json.IsEnabled != "false";
  }

  get hasError(): boolean {
    return this.json.IsInError == "true";
  }

  protected get sections(): Record<string, Record<string, any>> {
    return {
      Conditions: this.json.Conditions || {},
      Exceptions: this.json.Exceptions || {},
      Actions: this.json.Actions || {},
    };
  }

  protected isUnderstood(section: string, key: string, value: any): boolean {
    switch (section) {
    case "Conditions":
      switch (key) {
      case "ContainsSubjectOrBodyStrings":
      case "Categories": // Exchange checks for any of the categories, we for all
        return this.strings(value).length == 1;
      case "FromAddresses": {
        let addresses = ensureArray(value.Address);
        return addresses.length == 1 && !!sanitize.emailAddress(addresses[0]?.EmailAddress, null);
      }
      case "HasAttachments":
        return value == "true";
      case "FlaggedForAction":
        return value == "Any";
      case "WithinSizeRange":
        return Object.values(value).every((size: any) => sanitize.integer(size, null) != null);
      case "WithinDateRange":
        return Object.values(value).every((date: any) => sanitize.date(date, null));
      }
      return false;
    case "Exceptions": // Our rules have no exceptions
      return false;
    case "Actions":
      switch (key) {
      case "AssignCategories":
        return this.strings(value).length > 0;
      case "MoveToFolder":
        return !!value.FolderId?.Id;
      case "CopyToFolder":
        return !!value.FolderId?.Id && this.isEmpty(this.json.Actions.MoveToFolder);
      case "Delete":
      case "MarkAsRead":
      case "PermanentDelete":
        return value == "true";
      }
      return false;
    }
    return false;
  }

  protected fillFilterRule(rule: FilterRuleAction) {
    rule.name = sanitize.nonemptylabel(this.json.DisplayName, "-");
    let conditions = this.sections.Conditions;
    let criteria = rule.criteria;
    let condition = (key: string) => this.understood("Conditions", key);
    criteria.bodyText = condition("ContainsSubjectOrBodyStrings") ? this.strings(conditions.ContainsSubjectOrBodyStrings)[0] : null;
    criteria.includesPersonEMail = condition("FromAddresses") ? sanitize.emailAddress(ensureArray(conditions.FromAddresses.Address)[0].EmailAddress) : null;
    criteria.tags.replaceAll(condition("Categories") ? this.strings(conditions.Categories).map(name => getTagByName(name)) : []);
    criteria.hasAttachment = condition("HasAttachments") ? true : null;
    criteria.isStarred = condition("FlaggedForAction") ? true : null;
    let size = condition("WithinSizeRange") ? conditions.WithinSizeRange : {};
    criteria.sizeMin = size.MinimumSize ? sanitize.integer(size.MinimumSize) * 1024 : null;
    criteria.sizeMax = size.MaximumSize ? sanitize.integer(size.MaximumSize) * 1024 : null;
    let dates = condition("WithinDateRange") ? conditions.WithinDateRange : {};
    criteria.sentDateMin = dates.StartDateTime ? sanitize.date(dates.StartDateTime) : null;
    criteria.sentDateMax = dates.EndDateTime ? sanitize.date(dates.EndDateTime) : null;

    let actions = this.sections.Actions;
    let action = (key: string) => this.understood("Actions", key);
    rule.markAsRead = action("MarkAsRead") ? true : null;
    rule.deleteTrash = action("Delete") ? true : null;
    rule.deleteImmediately = action("PermanentDelete") ? true : null;
    let folder = action("MoveToFolder") ? actions.MoveToFolder : action("CopyToFolder") ? actions.CopyToFolder : null;
    rule.toFolderID = folder ? sanitize.nonemptystring(folder.FolderId.Id) : null;
    rule.copy = !action("MoveToFolder") && action("CopyToFolder") ? true : null;
    rule.addTags.replaceAll(action("AssignCategories") ? this.strings(actions.AssignCategories).map(name => getTagByName(name)) : []);
  }

  protected writeChanges(json: any, rule: FilterRuleAction, original: FilterRuleAction) {
    if (rule.name != original.name) {
      json.DisplayName = rule.name;
    }
    json.IsEnabled ??= "true";
    let conditions = structuredClone(this.sections.Conditions);
    if (this.merge("Conditions", conditions, this.conditionsOf(rule), this.conditionsOf(original), rule)) {
      json.Conditions = conditions;
    }
    let actions = structuredClone(this.sections.Actions);
    if (this.merge("Actions", actions, this.actionsOf(rule), this.actionsOf(original), rule)) {
      json.Actions = actions;
    }
  }

  protected setPriority(priority: number) {
    this.json.Priority = String(priority);
  }

  protected conditionsOf(rule: FilterRuleAction): Record<string, any> {
    let criteria = rule.criteria;
    let conditions: Record<string, any> = {};
    if (criteria.bodyText) {
      conditions.ContainsSubjectOrBodyStrings = { String: [criteria.bodyText] };
    }
    if (criteria.includesPersonEMail) {
      conditions.FromAddresses = { Address: [{ EmailAddress: criteria.includesPersonEMail }] };
    }
    if (criteria.tags.hasItems) {
      conditions.Categories = { String: criteria.tags.contents.map(tag => tag.name) };
    }
    if (criteria.hasAttachment) {
      conditions.HasAttachments = "true";
    }
    if (criteria.isStarred) {
      conditions.FlaggedForAction = "Any";
    }
    if (criteria.sizeMin || criteria.sizeMax) {
      conditions.WithinSizeRange = {};
      if (criteria.sizeMin) {
        conditions.WithinSizeRange.MinimumSize = String(Math.floor(criteria.sizeMin / 1024));
      }
      if (criteria.sizeMax) {
        conditions.WithinSizeRange.MaximumSize = String(Math.ceil(criteria.sizeMax / 1024));
      }
    }
    if (criteria.sentDateMin || criteria.sentDateMax) {
      conditions.WithinDateRange = {};
      if (criteria.sentDateMin) {
        conditions.WithinDateRange.StartDateTime = criteria.sentDateMin.toISOString();
      }
      if (criteria.sentDateMax) {
        conditions.WithinDateRange.EndDateTime = criteria.sentDateMax.toISOString();
      }
    }
    return conditions;
  }

  protected actionsOf(rule: FilterRuleAction): Record<string, any> {
    let actions: Record<string, any> = {};
    if (rule.addTags.hasItems) {
      actions.AssignCategories = { String: rule.addTags.contents.map(tag => tag.name) };
    }
    if (rule.toFolderID) {
      actions[rule.copy ? "CopyToFolder" : "MoveToFolder"] = { FolderId: { Id: rule.toFolderID } };
    }
    if (rule.deleteTrash) {
      actions.Delete = "true";
    }
    if (rule.markAsRead) {
      actions.MarkAsRead = "true";
    }
    if (rule.deleteImmediately) {
      actions.PermanentDelete = "true";
    }
    return actions;
  }

  /** For `UpdateInboxRules`: With namespace prefixes, and in the element order of the schema.
   * The server does not accept `IsNotSupported`, and of rules that it does not support,
   * it accepts only the priority.
   * @param isNew For `CreateRuleOperation`, without the ID */
  toRequest(isNew = false): any {
    const kRuleOrder = ["RuleId", "DisplayName", "Priority", "IsEnabled", "IsInError", "Conditions", "Exceptions", "Actions"];
    if (this.isReadOnly) {
      return this.withNamespaces(this.ordered(this.json, kRuleOrder.slice(0, 4), false));
    }
    const kNewRuleOrder = ["DisplayName", "Priority", "IsEnabled", "Conditions", "Exceptions", "Actions"];
    let rule = this.ordered(this.json, isNew ? kNewRuleOrder : kRuleOrder, false);
    const kPredicatesOrder = ["Categories", "ContainsBodyStrings", "ContainsHeaderStrings", "ContainsRecipientStrings",
      "ContainsSenderStrings", "ContainsSubjectOrBodyStrings", "ContainsSubjectStrings", "FlaggedForAction", "FromAddresses",
      "FromConnectedAccounts", "HasAttachments", "Importance", "IsApprovalRequest", "IsAutomaticForward", "IsAutomaticReply",
      "IsEncrypted", "IsMeetingRequest", "IsMeetingResponse", "IsNDR", "IsPermissionControlled", "IsReadReceipt", "IsSigned",
      "IsVoicemail", "ItemClasses", "MessageClassifications", "NotSentToMe", "SentCcMe", "SentOnlyToMe", "SentToAddresses",
      "SentToMe", "SentToOrCcMe", "Sensitivity", "WithinDateRange", "WithinSizeRange"];
    for (let predicates of ["Conditions", "Exceptions"]) {
      if (typeof rule[predicates] == "object") {
        rule[predicates] = this.ordered(rule[predicates], kPredicatesOrder);
      }
    }
    const kActionsOrder = ["AssignCategories", "CopyToFolder", "Delete", "ForwardAsAttachmentToRecipients",
      "ForwardToRecipients", "MarkImportance", "MarkAsRead", "MoveToFolder", "PermanentDelete", "RedirectToRecipients",
      "SendSMSAlertToRecipients", "ServerReplyWithMessage", "StopProcessingRules"];
    if (typeof rule.Actions == "object") {
      rule.Actions = this.ordered(rule.Actions, kActionsOrder);
    }
    return this.withNamespaces(rule);
  }

  /** @param order The known elements
   * @param withUnknown Adds the unknown elements after the known ones */
  protected ordered(json: Record<string, any>, order: string[], withUnknown = true): Record<string, any> {
    let result: Record<string, any> = {};
    for (let key of order) {
      if (key in json) {
        result[key] = json[key];
      }
    }
    if (!withUnknown) {
      return result;
    }
    for (let key in json) {
      if (!(key in result)) {
        result[key] = json[key];
      }
    }
    return result;
  }

  /** `XML2JSON()` doesn't say which values were XML attributes.
   * In rules, these are only the IDs of folders and items. */
  protected withNamespaces(json: any): any {
    const kAttributes = ["Id", "ChangeKey"];
    if (Array.isArray(json)) {
      return json.map(value => this.withNamespaces(value));
    }
    if (!json || typeof json != "object") {
      return json;
    }
    let result: Record<string, any> = {};
    for (let key in json) {
      result[kAttributes.includes(key) ? key : "t$" + key] = this.withNamespaces(json[key]);
    }
    return result;
  }

  /** Shows an address as its email address, and a folder as its ID */
  protected plainText(value: any): string {
    let text = value?.EmailAddress ?? value?.Id;
    if (typeof text == "string") {
      return sanitize.label(text, "");
    }
    return super.plainText(value);
  }

  /** A list of strings is a `<String>` element for each string */
  protected strings(json: any): string[] {
    return super.strings(ensureArray(json?.String));
  }
}
