import { ServerFilterRule } from "../FilterRules/ServerFilterRule";
import type { FilterRuleAction } from "../FilterRules/FilterRuleAction";
import type { Folder } from "../Folder";
import { getTagByName } from "../../Abstract/Tag";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

/** A rule that the Exchange server runs on incoming mail, as `InboxRule` of the OWA options.
 * These are the parameters of the PowerShell command `Set-InboxRule`.
 * The server changes only the parameters that we send. */
export class OWAFilterRule extends ServerFilterRule {
  protected readonly canCheckCategories = false;
  protected readonly canDeleteImmediately = false;
  /** The server sets them, or they describe the rule */
  static readonly kOutputOnly = ["Identity", "Enabled", "InError", "SupportedByTask", "Description",
    "DescriptionTimeFormat", "DescriptionTimeZone", "WarningMessages"];

  get id(): string | null {
    return sanitize.nonemptystring(this.json.Identity?.RawIdentity, null);
  }

  get priority(): number {
    return sanitize.integer(this.json.Priority, 0);
  }

  get isReadOnly(): boolean {
    return this.json.SupportedByTask === false;
  }

  get isEnabled(): boolean {
    return this.json.Enabled !== false;
  }

  get hasError(): boolean {
    return this.json.InError === true;
  }

  protected get sections(): Record<string, Record<string, any>> {
    let parameters: Record<string, any> = {};
    for (let [key, value] of Object.entries(this.json)) {
      if (!OWAFilterRule.kOutputOnly.includes(key) && key != "Name" && key != "Priority") {
        parameters[key] = value;
      }
    }
    return { "": parameters };
  }

  protected isUnderstood(section: string, key: string, value: any): boolean {
    switch (key) {
    case "SubjectOrBodyContainsWords":
      return this.strings(value).length == 1;
    case "From":
      return Array.isArray(value) && value.length == 1 && !!sanitize.emailAddress(value[0]?.SmtpAddress, null);
    case "HasAttachment":
    case "MarkAsRead":
    case "DeleteMessage":
      return value === true;
    case "FlaggedForAction":
      return value == "Any";
    case "WithinSizeRangeMinimum":
    case "WithinSizeRangeMaximum":
      return sanitize.integer(value, null) != null;
    case "ReceivedAfterDate":
    case "ReceivedBeforeDate":
      return !!sanitize.date(value, null);
    case "MoveToFolder":
      return !!this.folder(value);
    case "CopyToFolder":
      return !!this.folder(value) && this.isEmpty(this.json.MoveToFolder);
    case "ApplyCategory":
      return this.strings(value).length > 0;
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
    let has = (key: string) => this.understood("", key);
    let criteria = rule.criteria;
    criteria.bodyText = has("SubjectOrBodyContainsWords") ? this.strings(json.SubjectOrBodyContainsWords)[0] : null;
    criteria.includesPersonEMail = has("From") ? sanitize.emailAddress(json.From[0].SmtpAddress) : null;
    criteria.hasAttachment = has("HasAttachment") ? true : null;
    criteria.isStarred = has("FlaggedForAction") ? true : null;
    criteria.sizeMin = has("WithinSizeRangeMinimum") ? sanitize.integer(json.WithinSizeRangeMinimum) : null;
    criteria.sizeMax = has("WithinSizeRangeMaximum") ? sanitize.integer(json.WithinSizeRangeMaximum) : null;
    criteria.sentDateMin = has("ReceivedAfterDate") ? sanitize.date(json.ReceivedAfterDate) : null;
    criteria.sentDateMax = has("ReceivedBeforeDate") ? sanitize.date(json.ReceivedBeforeDate) : null;

    rule.markAsRead = has("MarkAsRead") ? true : null;
    rule.deleteTrash = has("DeleteMessage") ? true : null;
    let folder = has("MoveToFolder") ? json.MoveToFolder : has("CopyToFolder") ? json.CopyToFolder : null;
    rule.toFolderID = folder ? this.folder(folder).id : null;
    rule.copy = !has("MoveToFolder") && has("CopyToFolder") ? true : null;
    rule.addTags.replaceAll(has("ApplyCategory") ? this.strings(json.ApplyCategory).map(name => getTagByName(name)) : []);
  }

  protected writeChanges(json: any, rule: FilterRuleAction, original: FilterRuleAction) {
    this.merge("", json, this.parametersOf(rule), this.parametersOf(original), rule);
  }

  protected setPriority(priority: number) {
    this.json.Priority = priority;
  }

  /** All parameters that we understand. For a missing criterion, its empty value. */
  protected parametersOf(rule: FilterRuleAction): Record<string, any> {
    let criteria = rule.criteria;
    let folder = rule.toFolderID ? { RawIdentity: rule.toFolderID, DisplayName: rule.toFolder?.name ?? "" } : null;
    return {
      Name: rule.name,
      SubjectOrBodyContainsWords: criteria.bodyText ? [criteria.bodyText] : null,
      From: criteria.includesPersonEMail
        ? [{ SmtpAddress: criteria.includesPersonEMail, DisplayName: criteria.includesPersonEMail, RoutingType: "SMTP" }]
        : null,
      HasAttachment: !!criteria.hasAttachment,
      FlaggedForAction: criteria.isStarred ? "Any" : null,
      WithinSizeRangeMinimum: criteria.sizeMin || null,
      WithinSizeRangeMaximum: criteria.sizeMax || null,
      ReceivedAfterDate: criteria.sentDateMin?.toISOString() ?? null,
      ReceivedBeforeDate: criteria.sentDateMax?.toISOString() ?? null,
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
