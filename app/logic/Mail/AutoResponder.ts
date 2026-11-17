import type { MailAccount } from "./MailAccount";
import { notifyChangedProperty, Observable } from "../util/Observable";
import { AbstractFunction, assert } from "../util/util";
import { gt } from "../../l10n/l10n";

/** Automatic replies to incoming mail, e.g. during vacation.
 *
 * The server sends the replies, so they work while the app is closed.
 * The server holds the state: `load()` it before showing it, and `save()` it.
 *
 * Protocols that support it override `supported` and the other capabilities. */
export class AutoResponder extends Observable {
  readonly account: MailAccount;

  /** The user switched the automatic replies on:
   * - `isOn` and not `scheduled`: The server replies to all incoming mail,
   *   from now on until the user switches it off. `startTime` and `endTime` don't matter.
   * - `isOn` and `scheduled`: The server replies only to mail that arrives
   *   between `startTime` and `endTime`. Before and after, it doesn't reply,
   *   without the user having to switch it off.
   * - Not `isOn`: The server doesn't reply. `scheduled` and the times don't matter.
   *
   * Whether the account can have an auto-responder at all is `supported`. */
  @notifyChangedProperty
  isOn = false;
  /** Reply only between `startTime` and `endTime`. Only if `isOn`. */
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
  /** Which senders outside the organization get `externalHTML` */
  @notifyChangedProperty
  externalAudience = AutoResponderAudience.None;

  constructor(account: MailAccount) {
    super();
    this.account = account;
    // Default start value. Like Outlook: From the next full hour, for 1 day
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

  protected validate() {
    if (this.isOn && this.scheduled) {
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

/** Which senders outside the organization get an automatic reply.
 * Senders inside the organization always get `internalHTML`.
 *
 * The user chooses it separately from the message, because a reply tells
 * the sender that the user is away and that the address is valid. That's fine
 * for colleagues and contacts, but the user may not want to tell spammers and strangers.
 * Exchange stores it as `ExternalAudience`, and the server enforces the admin's limit.
 *
 * It matters only if `supportsExternal`, i.e. for Exchange.
 * Protocols without this distinction (e.g. JMAP or Sieve) reply to all senders.
 *
 * The values are Graph's `externalAudience`. */
export enum AutoResponderAudience {
  /** No replies outside the organization */
  None = "none",
  /** Only senders in the user's addressbook */
  Contacts = "contactsOnly",
  /** Everybody */
  All = "all",
}
