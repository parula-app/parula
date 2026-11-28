import { ServerFilterRule } from "../FilterRules/ServerFilterRule";
import type { FilterRuleAction } from "../FilterRules/FilterRuleAction";
import type { Folder } from "../Folder";
import { getTagByName } from "../../Abstract/Tag";
import { Provider } from "../../Auth/OAuth2URLs";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

/** A rule that the Exchange server runs on incoming mail, as `InboxRule` of the OWA options.
 * These are the parameters of the PowerShell command `Set-InboxRule`.
 * The server changes only the parameters that we send. */
export class OWAFilterRule extends ServerFilterRule {
  /** Only Exchange Online has the parameter `AssignedCategories` */
  protected readonly canCheckCategories = this.account.provider() == Provider.Office365;
  protected readonly canDeleteImmediately = false;
  /** The server sets them, or they describe the rule */
  static readonly kOutputOnly = ["__type", "Identity", "Enabled", "InError", "ErrorType", "SupportedByTask", "Description",
    "DescriptionTimeFormat", "DescriptionTimeZone", "WarningMessages", "RuleProvider"];

  get id(): string | null {
    return sanitize.nonemptystring(this.json.Identity?.RawIdentity, null);
  }

  get priority(): number {
    return sanitize.integer(this.json.Priority, 0);
  }

  get isReadOnly(): boolean {
    return !sanitize.boolean(this.json.SupportedByTask ?? true, true);
  }

  get isEnabled(): boolean {
    return sanitize.boolean(this.json.Enabled ?? true, true);
  }

  get hasError(): boolean {
    return sanitize.boolean(this.json.InError, false);
  }

  /** The parameters, in the sections of EWS and Graph. The exceptions without their prefix `ExceptIf`. */
  protected get sections(): Record<string, Record<string, any>> {
    const kActions = ["ApplyCategory", "ApplySystemCategory", "AutoReplyWithTemplate", "ClearCategories", "ClearFlag",
      "CompleteFlag", "CopyToFolder", "DeleteMessage", "DeleteSystemCategory", "DisplayAlert", "FlagMessage",
      "ForwardAsAttachmentTo", "ForwardTo", "MarkAsRead", "MarkImportance", "MoveToFolder", "PermanentDelete", "PinMessage",
      "PlaySound", "RedirectTo", "SendTextMessageNotificationTo", "SoftDeleteMessage", "StopProcessingRules"];
    let sections: Record<string, Record<string, any>> = { Conditions: {}, Exceptions: {}, Actions: {} };
    for (let [key, value] of Object.entries(this.json)) {
      // The server sends an enum that is not set as "Null" and its type, e.g. "NullImportance"
      if (OWAFilterRule.kOutputOnly.includes(key) || key == "Name" || key == "Priority" ||
          typeof value == "string" && value.startsWith("Null")) {
        continue;
      }
      if (key.startsWith("ExceptIf")) {
        sections.Exceptions[key.substring("ExceptIf".length)] = value;
      } else if (kActions.includes(key)) {
        sections.Actions[key] = value;
      } else {
        sections.Conditions[key] = value;
      }
    }
    return sections;
  }

  protected isUnderstood(section: string, key: string, value: any): boolean {
    switch (section) {
    case "Conditions":
      switch (key) {
      case "SubjectOrBodyContainsWords":
      case "AssignedCategories": // Exchange checks for any of the categories, we for all
        return this.strings(value).length == 1;
      case "From":
        return sanitize.array(value, []).length == 1 && !!sanitize.emailAddress(value[0]?.SmtpAddress, null);
      case "HasAttachment":
        return sanitize.boolean(value, false);
      case "FlaggedForAction":
        return value == "Any";
      case "WithinSizeRangeMinimum":
      case "WithinSizeRangeMaximum":
        return sanitize.integer(value, null) != null;
      case "ReceivedAfterDate":
      case "ReceivedBeforeDate":
        return !!sanitize.date(value, null);
      }
      return false;
    case "Exceptions": // Our rules have no exceptions
      return false;
    case "Actions":
      switch (key) {
      case "MarkAsRead":
      case "DeleteMessage":
        return sanitize.boolean(value, false);
      case "MoveToFolder":
        return !!this.folder(value);
      case "CopyToFolder":
        return !!this.folder(value) && this.isEmpty(this.json.MoveToFolder);
      case "ApplyCategory":
        return this.strings(value).length > 0;
      }
      return false;
    }
    return false;
  }

  /** The server identifies the folder in its own way, but tells its name */
  protected folder(identity: any): Folder | null {
    let name = sanitize.nonemptylabel(identity?.DisplayName, null);
    let folders = name ? this.account.getAllFolders().filterOnce(folder => folder.name == name) : null;
    return folders?.length == 1 ? folders.first : null;
  }

  protected fillFilterRule(rule: FilterRuleAction) {
    let json = this.json;
    rule.name = sanitize.nonemptylabel(json.Name, "-");
    let condition = (key: string) => this.understood("Conditions", key);
    let criteria = rule.criteria;
    criteria.bodyText = condition("SubjectOrBodyContainsWords") ? this.strings(json.SubjectOrBodyContainsWords)[0] : null;
    criteria.includesPersonEMail = condition("From") ? sanitize.emailAddress(json.From[0].SmtpAddress) : null;
    criteria.tags.replaceAll(condition("AssignedCategories") ? this.strings(json.AssignedCategories).map(name => getTagByName(name)) : []);
    criteria.hasAttachment = condition("HasAttachment") ? true : null;
    criteria.isStarred = condition("FlaggedForAction") ? true : null;
    criteria.sizeMin = condition("WithinSizeRangeMinimum") ? sanitize.integer(json.WithinSizeRangeMinimum) : null;
    criteria.sizeMax = condition("WithinSizeRangeMaximum") ? sanitize.integer(json.WithinSizeRangeMaximum) : null;
    criteria.sentDateMin = condition("ReceivedAfterDate") ? sanitize.date(json.ReceivedAfterDate) : null;
    criteria.sentDateMax = condition("ReceivedBeforeDate") ? sanitize.date(json.ReceivedBeforeDate) : null;

    let action = (key: string) => this.understood("Actions", key);
    rule.markAsRead = action("MarkAsRead") ? true : null;
    rule.deleteTrash = action("DeleteMessage") ? true : null;
    let folder = action("MoveToFolder") ? json.MoveToFolder : action("CopyToFolder") ? json.CopyToFolder : null;
    rule.toFolderID = folder ? this.folder(folder).id : null;
    rule.copy = !action("MoveToFolder") && action("CopyToFolder") ? true : null;
    rule.addTags.replaceAll(action("ApplyCategory") ? this.strings(json.ApplyCategory).map(name => getTagByName(name)) : []);
  }

  protected writeChanges(json: any, rule: FilterRuleAction, original: FilterRuleAction) {
    if (rule.name != original.name) {
      json.Name = rule.name;
    }
    this.merge("Conditions", json, this.conditionsOf(rule), this.conditionsOf(original), rule);
    this.merge("Actions", json, this.actionsOf(rule), this.actionsOf(original), rule);
  }

  protected setPriority(priority: number) {
    this.json.Priority = priority;
  }

  /** All conditions that we understand. For a missing criterion, its empty value. */
  protected conditionsOf(rule: FilterRuleAction): Record<string, any> {
    let criteria = rule.criteria;
    return {
      SubjectOrBodyContainsWords: criteria.bodyText ? [criteria.bodyText] : null,
      From: criteria.includesPersonEMail
        ? [{ SmtpAddress: criteria.includesPersonEMail, DisplayName: criteria.includesPersonEMail, RoutingType: "SMTP" }]
        : null,
      AssignedCategories: criteria.tags.hasItems ? criteria.tags.contents.map(tag => tag.name) : null,
      HasAttachment: !!criteria.hasAttachment,
      FlaggedForAction: criteria.isStarred ? "Any" : null,
      WithinSizeRangeMinimum: criteria.sizeMin || null,
      WithinSizeRangeMaximum: criteria.sizeMax || null,
      ReceivedAfterDate: criteria.sentDateMin?.toISOString() ?? null,
      ReceivedBeforeDate: criteria.sentDateMax?.toISOString() ?? null,
    };
  }

  /** All actions that we understand. For a missing action, its empty value. */
  protected actionsOf(rule: FilterRuleAction): Record<string, any> {
    let folder = rule.toFolderID ? { RawIdentity: rule.toFolderID, DisplayName: rule.toFolder?.name ?? "" } : null;
    return {
      MarkAsRead: !!rule.markAsRead,
      DeleteMessage: !!rule.deleteTrash,
      MoveToFolder: rule.copy ? null : folder,
      CopyToFolder: rule.copy ? folder : null,
      ApplyCategory: rule.addTags.hasItems ? rule.addTags.contents.map(tag => tag.name) : null,
    };
  }

  /** For `NewInboxRule` */
  get newParameters(): Record<string, any> {
    let parameters: Record<string, any> = {};
    for (let [key, value] of Object.entries(this.json)) {
      if (!OWAFilterRule.kOutputOnly.includes(key) && value != null && value !== false) {
        parameters[key] = value;
      }
    }
    return parameters;
  }

  /** For `SetInboxRule` */
  setParameters(original: OWAFilterRule): Record<string, any> {
    return { Identity: this.json.Identity, ...this.changedProperties(original) };
  }

  /** Shows a person as their email address, and a folder as its name */
  protected plainText(value: any): string {
    let text = value?.SmtpAddress ?? value?.DisplayName;
    if (typeof text == "string") {
      return sanitize.label(text, "");
    }
    return super.plainText(value);
  }
}
