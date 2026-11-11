import type { MailAccount } from "./MailAccount";
import { notifyChangedProperty, Observable } from "../util/Observable";
import { AbstractFunction, NotReached, assert } from "../util/util";
import { gt } from "../../l10n/l10n";

/** Automatic replies to incoming mail, e.g. during vacation.
 *
 * The server sends the replies, so they work while the app is closed.
 * The server holds the state: `load()` it before showing it, and `save()` it.
 *
 * Protocols that support it override `supported` and the other capabilities. */
export class AutoResponder extends Observable {
  readonly account: MailAccount;

  @notifyChangedProperty
  enabled = false;
  /** Reply only between `startTime` and `endTime` */
  @notifyChangedProperty
  scheduled = false;
  @notifyChangedProperty
  startTime: Date;
  @notifyChangedProperty
  endTime: Date;
  /** For senders inside the organization.
   * For all senders, if `!supportsExternal`. */
  @notifyChangedProperty
  internalHTML = "";
  /** For senders outside the organization */
  @notifyChangedProperty
  externalHTML = "";
  @notifyChangedProperty
  externalAudience = AutoResponderAudience.None;
  /** Limit of `externalAudience`, set by the admin */
  @notifyChangedProperty
  maxAudience = AutoResponderAudience.All;
  /** The login lacks the permission. @see `grantPermission()` */
  @notifyChangedProperty
  needsPermission = false;

  constructor(account: MailAccount) {
    super();
    this.account = account;
    // Like Outlook: From the next full hour, for 1 day
    this.startTime = new Date();
    this.startTime.setHours(this.startTime.getHours() + 1, 0, 0, 0);
    this.endTime = new Date(this.startTime);
    this.endTime.setDate(this.endTime.getDate() + 1);
  }

  get supported(): boolean {
    return false;
  }

  /** A separate message and audience for senders outside the organization */
  get supportsExternal(): boolean {
    return false;
  }

  /** `AutoResponderAudience.Contacts` */
  get supportsContacts(): boolean {
    return false;
  }

  /** Reads the current settings from the server */
  async load(): Promise<void> {
    throw new AbstractFunction();
  }

  /** Writes these settings to the server */
  async save(): Promise<void> {
    throw new AbstractFunction();
  }

  /** Asks the user to log in again and allow the missing permission */
  async grantPermission(): Promise<void> {
    throw new NotReached();
  }

  protected validate() {
    if (this.enabled && this.scheduled) {
      assert(this.endTime > this.startTime, gt`The end time must be after the start time`);
    }
  }

  protected setTimes(startTime: Date | null, endTime: Date | null) {
    // Old dates of a past vacation are useless as defaults
    if (startTime && endTime && (this.scheduled || endTime > new Date())) {
      this.startTime = startTime;
      this.endTime = endTime;
    }
  }

  /** @returns HTML for the server, or "" for none */
  protected stripEmptyParagraph(html: string): string {
    // What the editor leaves when emptied
    return !html || html == "<p></p>" ? "" : html;
  }
}

/** The values are Graph's `externalAudience` */
export enum AutoResponderAudience {
  None = "none",
  /** Only senders in the user's addressbook */
  Contacts = "contactsOnly",
  All = "all",
}
