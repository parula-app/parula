import type { EMail } from "../EMail";
import { FilterMoment } from "./FilterMoments";
import { SearchEMail } from "../Store/SearchEMail";
import { DeleteStrategy, type MailAccount } from "../MailAccount";
import type { Folder } from "../Folder";
import { getTagByName, type Tag } from "../../Abstract/Tag";
import { notifyChangedProperty, Observable } from "../../util/Observable";
import { AbstractFunction, assert, booleanHasValue, NotSupported } from "../../util/util";
import { appName } from "../../build";
import { gt } from "../../../l10n/l10n";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { SetColl, type ArrayColl } from "svelte-collections";

/** Does automatic user-defined actions on emails,
 * on defined moments (e.g. new email arrived, email sent etc.),
 * for emails that match user-defined criteria. */
export class FilterRuleAction extends Observable {
  @notifyChangedProperty
  name: string = "";
  /** For which email and at which moment the filter should be run */
  @notifyChangedProperty
  when: FilterMoment = FilterMoment.IncomingBeforeSpam;
  /** For which subset of emails the filter should run */
  readonly criteria = new SearchEMail();
  /** The server runs this rule, not we. @see `MailAccount.canServerFilterRules` */
  get server(): boolean {
    throw new AbstractFunction();
  }
  /** The ID of the rule on the server. null, if it's not on the server yet. */
  serverID: string | null = null;

  /** Why the user cannot change this rule. null, if they can. */
  get readonly(): string | null {
    return null;
  }

  /** The parts of the rule that we can't show or change, as plain text */
  get unknownParts(): string[] {
    return [];
  }

  /** Why the mail server cannot run this rule. null, if it can. */
  get cannotRunOnServer(): string | null {
    return this.account.serverFilterRulesReadonly ?? this.account.newServerFilterRule(null).unsupported(this);
  }

  /** The following actions cannot be combined:
   * - Delete/spam actions with toFolder or markAsStarred
   */
  /** Move or copy (`copyToFolder`) the email to this folder. */
  _toFolder: Folder | null = null;
  @notifyChangedProperty
  toFolderID: string | undefined;
  get toFolder(): Folder | null {
    return (this.toFolderID && (this._toFolder ??= this.account.findFolder(folder => folder.id == this.toFolderID))) ?? null;
  }
  set toFolder(folder: Folder | null) {
    this._toFolder = folder;
    this.toFolderID = folder?.id;
  }
  /** If `toFolder` and `copyToFolder`, then copy the email. instead of moving. */
  @notifyChangedProperty
  copy: boolean | null = null;
  readonly account: MailAccount;
  readonly addTags = new SetColl<Tag>();

  @notifyChangedProperty
  markAsRead: boolean | null = null;
  @notifyChangedProperty
  markAsStarred: boolean | null = null;

  /** Marks the message as spam, and maybe moves it to the spam folder */
  @notifyChangedProperty
  markAsSpam: boolean | null = null;
  /** Move the message to the trash folder */
  @notifyChangedProperty
  deleteTrash: boolean | null = null;
  /** Make this message disappear immediately. Do not move to trash. Use with care. */
  @notifyChangedProperty
  deleteImmediately: boolean | null = null;

  constructor(account: MailAccount, criteria?: SearchEMail) {
    super();
    if (criteria) {
      this.criteria = criteria;
    }
    this.criteria.account = this.account = account;
  }

  /** Checks for a match, and runs the filter action, as needed. */
  async run(email: EMail): Promise<void> {
    if (!this.criteria.matches(email)) {
      return;
    }
    await this.doAction(email);
  }

  /** Executes the filter action.
   * Unconditionally, i.e. does not check for match. */
  async doAction(email: EMail): Promise<void> {
    if (booleanHasValue(this.markAsRead)) {
      await email.markRead(this.markAsRead);
    }
    if (booleanHasValue(this.markAsStarred)) {
      await email.markStarred(this.markAsStarred);
    }
    if (this.addTags.hasItems) {
      for (let tag of this.addTags) {
        await email.addTag(tag);
      }
    }
    if (booleanHasValue(this.markAsSpam)) {
      await email.treatSpam(this.markAsSpam);
      if (this.markAsSpam) {
        return;
      }
    }
    if (this.deleteImmediately) {
      await email.deleteMessage(DeleteStrategy.DeleteImmediately);
      return;
    }
    if (this.deleteTrash) {
      await email.deleteMessage(DeleteStrategy.MoveToTrash);
      return;
    }
    if (this.toFolderID) {
      assert(this.toFolder, gt`The target folder of filter rule ${this.name} does not exist anymore`);
      if (this.copy) {
        await this.toFolder.copyMessageHere(email);
      } else {
        await this.toFolder.moveMessageHere(email);
      }
    }
  }

  /** Lets the mail server run the rule, if `server`, otherwise us. Throws, if that side cannot run all parts of it.
   * @returns The rule of the other class, which replaces this rule in `rules` */
  runBy(server: boolean, rules: ArrayColl<FilterRuleAction>): FilterRuleAction {
    if (server == this.server) {
      return this;
    }
    if (!server && this.unknownParts.length) {
      throw new NotSupported(gt`${appName} cannot run all parts of the rule ${this.name}`);
    }
    if (server && this.cannotRunOnServer) {
      throw new NotSupported(this.cannotRunOnServer);
    }
    let rule = this.account.newFilterRule(server);
    rule.fromJSON(this.toJSON());
    rule.name = this.name;
    let index = rules.indexOf(this);
    if (index >= 0) {
      rules.splice(index, 1, rule);
    }
    return rule;
  }

  fromJSON(json: any) {
    this.name = sanitize.nonemptystring(json.name, "-");
    this.when = sanitize.enum<FilterMoment>(json.when, Object.values(FilterMoment));
    this.criteria.fromJSON(json.criteria);
    this.criteria.account = this.account;
    function boolean(value: boolean | undefined): boolean | undefined {
      return typeof (value) == "boolean" ? value : undefined;
    }
    this.markAsRead = boolean(json.markAsRead);
    this.markAsStarred = boolean(json.markAsStarred);
    this.markAsSpam = boolean(json.markAsSpam);
    this.deleteTrash = boolean(json.deleteTrash);
    this.deleteImmediately = boolean(json.deleteImmediately);
    this.copy = boolean(json.copy);
    // let folderAccount = appGlobal.emailAccounts.find(acc => acc.id == json.toFolderAccountID);
    this.toFolderID = sanitize.nonemptystring(json.toFolder, null);
    this._toFolder = null;
    this.addTags.replaceAll(sanitize.array(json.addTags, [])?.map(name => getTagByName(name)));
  }

  toJSON() {
    return {
      name: this.name,
      when: this.when,
      criteria: this.criteria.toJSON(),
      markAsRead: this.markAsRead,
      markAsStarred: this.markAsStarred,
      markAsSpam: this.markAsSpam,
      deleteTrash: this.deleteTrash,
      deleteImmediately: this.deleteImmediately,
      copy: this.copy,
      // toFolderAccountID: this.toFolder?.account?.id,
      toFolder: this.toFolderID,
      addTags: this.addTags.contents.map(tag => tag.name),
    };
  }

  clone(): FilterRuleAction {
    let clone = new (this as any).constructor(this.account);
    clone.fromJSON(this.toJSON());
    return clone;
  }
}

/** A filter rule that we run, on the emails that we download. @see `ServerFilterRule` */
// Not in its own file, because `MailAccount` creates it, and this file imports `MailAccount`: the import cycle would break `extends`.
export class LocalFilterRule extends FilterRuleAction {
  get server(): boolean {
    return false;
  }
}
