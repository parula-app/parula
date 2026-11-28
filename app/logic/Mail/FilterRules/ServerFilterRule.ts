import { FilterRuleAction } from "./FilterRuleAction";
import { FilterMoment } from "./FilterMoments";
import type { MailAccount } from "../MailAccount";
import { AbstractFunction, booleanHasValue, NotSupported } from "../../util/util";
import { appName } from "../../build";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { gt } from "../../../l10n/l10n";

/** A filter rule that the server runs, in the format of the protocol.
 * We show and change only the parts that we understand. The other parts
 * stay as they are, and the user sees them as plain text. */
export class ServerFilterRule extends FilterRuleAction {
  /** As the server sent it */
  json: any;
  protected readonly canCheckDates: boolean = true;
  protected readonly canCheckCategories: boolean = true;
  protected readonly canDeleteImmediately: boolean = true;
  /** The server allows to change the order of the rules that it doesn't allow to change otherwise */
  protected readonly canReorderReadOnly: boolean = false;

  /** @param json As the server sent the rule. Fills the parts that we understand. null for a new rule. */
  constructor(account: MailAccount, json: any) {
    super(account);
    this.json = json ?? {};
    if (json) {
      this.serverID = this.id;
      this.fillFilterRule(this);
    }
  }

  get server(): boolean {
    return true;
  }

  get id(): string | null {
    throw new AbstractFunction();
  }

  /** The server runs the rules in the order of this number, lowest first */
  get priority(): number {
    throw new AbstractFunction();
  }

  /** The server doesn't allow to change the rule */
  get isReadOnly(): boolean {
    return false;
  }

  get readOnlyReason(): string | null {
    return this.account.serverFilterRulesReadOnlyReason ??
      (this.isReadOnly ? gt`The mail server does not allow changes to this rule` : null);
  }

  get isEnabled(): boolean {
    return true;
  }

  get hasError(): boolean {
    return false;
  }

  /** The conditions, exceptions, actions etc. of the rule, as `{ section: { key: value } }`,
   * without the name, ID, order and state of the rule. */
  protected get sections(): Record<string, Record<string, any>> {
    throw new AbstractFunction();
  }

  /** We can show and change this part of the rule */
  protected isUnderstood(section: string, key: string, value: any): boolean {
    throw new AbstractFunction();
  }

  /** The parts of the rule that we can't show or change, as plain text, in the terms of the server */
  get unknownParts(): string[] {
    let parts: string[] = [];
    if (!this.isEnabled) {
      parts.push(gt`The rule is turned off`);
    }
    if (this.hasError) {
      parts.push(gt`The mail server reports an error in this rule`);
    }
    for (let [section, values] of Object.entries(this.sections)) {
      for (let key of this.unknownKeys(section)) {
        let name = (section ? this.words(section) + ": " : "") + this.words(key);
        let text = sanitize.boolean(values[key], false) ? "" : this.plainText(values[key]);
        parts.push(text ? `${name}: ${text}` : name);
      }
    }
    if (this.isReadOnly) { // The server leaves out the parts that make the rule read-only, e.g. a desktop alert of classic Outlook
      parts.push(gt`The mail server does not report all parts of this rule`);
    }
    return parts;
  }

  /** Sets only the parts that `isUnderstood()` */
  protected fillFilterRule(rule: FilterRuleAction) {
    throw new AbstractFunction();
  }

  /** The server rule, changed as the user changed `rule`. `this` is as the server sent it.
   * Leaves the parts of the server rule as they are that the user did not change. */
  withChangesFrom(rule: FilterRuleAction, priority: number): ServerFilterRule {
    let unsupported = this.unsupportedReason(rule);
    if (unsupported) {
      throw new NotSupported(unsupported);
    }
    let json = structuredClone(this.json);
    this.writeChanges(json, rule, this);
    let changed = new (this.constructor as any)(this.account, json) as ServerFilterRule;
    if (this.isReadOnly && changed.isChangedFrom(this)) {
      throw new NotSupported(gt`The mail server does not allow changes to the rule ${rule.name}`);
    }
    if (!this.isReadOnly || this.canReorderReadOnly) {
      changed.setPriority(priority);
    }
    return changed;
  }

  /** Writes the changes of the user into the server rule
   * @param json The server rule. Will be changed.
   * @param rule As the user changed it
   * @param original As we understood the server rule */
  protected writeChanges(json: any, rule: FilterRuleAction, original: FilterRuleAction) {
    throw new AbstractFunction();
  }

  protected setPriority(priority: number) {
    throw new AbstractFunction();
  }

  /** The server rule as the user wants it, compared to what we got from the server */
  isChangedFrom(original: ServerFilterRule): boolean {
    return JSON.stringify(this.json) != JSON.stringify(original.json);
  }

  /** The top-level properties that differ from the server rule `original`. `null` for removed properties. */
  changedProperties(original: ServerFilterRule): Record<string, any> {
    let changes: Record<string, any> = {};
    for (let key of new Set([...Object.keys(this.json), ...Object.keys(original.json)])) {
      if (JSON.stringify(this.json[key]) != JSON.stringify(original.json[key])) {
        changes[key] = this.json[key] ?? null;
      }
    }
    return changes;
  }

  /** Why the server cannot run `rule` as the user defined it. null, if it can. */
  unsupportedReason(rule: FilterRuleAction): string | null {
    let criteria = rule.criteria;
    if (rule.when == FilterMoment.Outgoing ||
        booleanHasValue(criteria.isOutgoing) || booleanHasValue(criteria.isRead) || booleanHasValue(criteria.isReplied) ||
        criteria.isStarred === false || criteria.hasAttachment === false ||
        criteria.messageID || criteria.threadID || criteria.folderID || criteria.hasAttachmentMIMETypes.hasItems ||
        !this.canCheckDates && (criteria.sentDateMin || criteria.sentDateMax) ||
        !this.canCheckCategories && criteria.tags.hasItems) {
      return gt`The mail server cannot check all criteria of the rule ${rule.name}`;
    }
    if (rule.markAsRead === false || booleanHasValue(rule.markAsStarred) || rule.markAsSpam ||
        !this.canDeleteImmediately && rule.deleteImmediately) {
      return gt`The mail server cannot do all actions of the rule ${rule.name}`;
    }
    return null;
  }

  /** Writes the properties that the user changed into a section of the server rule.
   * Refuses to change the properties that we don't understand.
   * @param section @see `sections`
   * @param server The properties of the server rule. Will be changed.
   * @param ours Our rule, in the format of the server
   * @param original The server rule as we understood it, in the format of the server
   * @returns The user changed something */
  protected merge(section: string, server: Record<string, any>, ours: Record<string, any>, original: Record<string, any>, rule: FilterRuleAction): boolean {
    let unknownKeys = this.unknownKeys(section);
    let isChanged = false;
    for (let key of new Set([...Object.keys(ours), ...Object.keys(original)])) {
      if (JSON.stringify(ours[key]) == JSON.stringify(original[key])) {
        continue;
      }
      if (unknownKeys.includes(key)) {
        throw new NotSupported(gt`${appName} cannot change the part ${this.words(key)} of the rule ${rule.name}, because it cannot show all of it`);
      }
      isChanged = true;
      if (ours[key] === undefined) {
        delete server[key];
      } else {
        server[key] = ours[key];
      }
    }
    return isChanged;
  }

  protected unknownKeys(section: string): string[] {
    let values = this.sections[section] ?? {};
    return Object.keys(values).filter(key => !this.isEmpty(values[key]) && !this.isUnderstood(section, key, values[key]));
  }

  /** For `fillFilterRule()` */
  protected understood(section: string, key: string): boolean {
    let value = this.sections[section]?.[key];
    return !this.isEmpty(value) && this.isUnderstood(section, key, value);
  }

  /** An unset property. The formats set it to null, false, an empty list or an empty element. */
  protected isEmpty(value: any): boolean {
    if (value == null || value === false || value === "false" || value === "") {
      return true;
    }
    if (Array.isArray(value)) {
      return value.every(item => this.isEmpty(item));
    }
    if (typeof value == "object") {
      return Object.values(value).every(item => this.isEmpty(item));
    }
    return false;
  }

  /** "ContainsSubjectStrings" -> "Contains subject strings" */
  protected words(name: string): string {
    let words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  /** The subclasses show the objects of their protocol in short, e.g. a person as email address */
  protected plainText(value: any): string {
    if (Array.isArray(value)) {
      return value.map(item => this.plainText(item)).filter(text => text).join(", ");
    }
    if (value && typeof value == "object") {
      return Object.values(value).map(item => this.plainText(item)).filter(text => text).join(", ");
    }
    return sanitize.label(String(value ?? ""), "");
  }

  protected strings(json: any): string[] {
    return sanitize.array(json, []).map(value => sanitize.nonemptystring(value, null)).filter(value => value);
  }

  fromJSON(json: any) {
    super.fromJSON(json);
    this.serverID = sanitize.nonemptystring(json.serverID, null);
    this.json = json.serverJSON ?? {};
  }

  toJSON() {
    return {
      ...super.toJSON(),
      server: this.server,
      serverID: this.serverID,
      serverJSON: this.json,
    };
  }
}
