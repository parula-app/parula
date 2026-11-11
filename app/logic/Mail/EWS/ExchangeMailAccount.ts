import { MailAccount, DeleteStrategy } from "../MailAccount";
import { TLSSocketType } from "../../Abstract/TCPAccount";
import { Calendar } from "../../Calendar/Calendar";
import { ExchangeCalendar } from "../../Calendar/EWS/ExchangeCalendar";
import { PersonUID } from "../../Abstract/PersonUID";
import { appGlobal } from "../../app";
import { OutlookRulesCopy } from "./OutlookRulesCopy";
import type { FilterRuleAction } from "../FilterRules/FilterRuleAction";
import { AbstractFunction, UserError } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { gt } from "../../../l10n/l10n";
import { ArrayColl, Collection } from "svelte-collections";

export class ExchangeMailAccount extends MailAccount {
  readonly port: number = 443;
  readonly tls = TLSSocketType.TLS;
  readonly canSendOutgoingInvitations: boolean = false;
  deleteStrategy: DeleteStrategy = DeleteStrategy.MoveToTrash;
  /** Outlook can make its copy of the rules again from the server rules. @see `checkOutlookRulesCopy()` */
  protected mayDeleteOutlookRulesCopy = false;

  get calendarsAvailable(): Collection<Calendar> {
    let mailboxCalendars = this.calendarsOfMailbox(this.username);
    if (mailboxCalendars.hasItems) {
      return mailboxCalendars;
    }
    if (this.isDependentAccount) {
      let delegateCalendars = this.calendarsOfMailbox(this.mainAccount.username);
      if (delegateCalendars.hasItems) {
        return delegateCalendars;
      }
    }
    return appGlobal.calendars.filterObservable(cal => cal.canAcceptAnyInvitation);
  }

  /** A mailbox shared with us and its calendars are siblings, not our dependent accounts. */
  protected calendarsOfMailbox(username: string): ArrayColl<Calendar> {
    return (this.mainAccount ?? this).dependentAccounts().filterObservable(acc =>
      acc instanceof ExchangeCalendar &&
      acc.useForInvitations &&
      acc.username == username) as ArrayColl<Calendar>;
  }

  async availableSharedAccounts(): Promise<ArrayColl<PersonUID>> {
    let persons = new ArrayColl<PersonUID>();
    if (this.mainAccount) {
      return persons;
    }
    for (let person of await this.listSharedAccountsFromOutlook()) {
      if (persons.find(existing => existing.emailAddress == person.emailAddress) ||
          this.isMyEMailAddress(person.emailAddress) ||
          this.dependentAccounts().contents.some(account => account.protocol == this.protocol &&
            (account as MailAccount).isMyEMailAddress(person.emailAddress))) {
        continue;
      }
      persons.add(person);
    }
    return persons;
  }

  async listSharedAccountsFromOutlook(): Promise<PersonUID[]> {
    return [];
  }

  protected newSharedAccountPerson(emailAddress: string, name: string): PersonUID | null {
    let address = sanitize.emailAddress(emailAddress, null);
    if (!address) {
      return null;
    }
    return new PersonUID(address, sanitize.nonemptylabel(name, null) ?? undefined);
  }

  /** When another client changes the server rules, Exchange deletes the copy of the rules that Outlook keeps.
   * Outlook makes a new copy, but without its rules for sent mail and the rules that are turned off in Outlook, which exist only in that copy.
   * @param exist We know that the copy exists, but not which rules only the copy has */
  protected setOutlookRulesExist(exist: boolean) {
    this.mayDeleteOutlookRulesCopy = false;
    this.serverFilterRulesNotice = null;
    this.serverFilterRulesReadOnlyReason = exist
      ? gt`Classic Outlook keeps its own copy of the rules for this account. Exchange would delete it when the rules change here, and the rules in Outlook for sent mail and the rules that are turned off in Outlook would be lost. You can change the rules in Outlook.`
      : null;
  }

  /** Reads the copy of the rules that Outlook keeps, and allows changes to the server rules,
   * if the copy has no rules that the server does not have. Then, Outlook can make the same copy again.
   * @param serverRules All rules on the server
   * @param exists Whether the server said that the copy exists. null, if it did not say. */
  protected async checkOutlookRulesCopy(serverRules: FilterRuleAction[], exists: boolean | null) {
    if (exists === false) {
      this.setOutlookRulesExist(false);
      return;
    }
    let lostRules: string[];
    try {
      let streams = await this.fetchOutlookRulesStreams();
      if (!streams.length) {
        this.setOutlookRulesExist(!!exists);
        return;
      }
      lostRules = [...new Set(streams.flatMap(stream =>
        new OutlookRulesCopy(stream).lostRules(serverRules).contents.map(rule => rule.name)))];
    } catch (ex) {
      this.dataError(ex);
      this.setOutlookRulesExist(exists ?? false);
      return;
    }
    this.setOutlookRulesExist(true);
    if (lostRules.length) {
      this.serverFilterRulesReadOnlyReason = gt`Classic Outlook keeps its own copy of the rules for this account. Exchange would delete it when the rules change here, and these rules would be lost, because only Outlook has them: ${lostRules.join(", ")}. You can change the rules in Outlook.`;
      return;
    }
    this.serverFilterRulesReadOnlyReason = null;
    this.serverFilterRulesNotice = gt`Classic Outlook keeps its own copy of the rules for this account. When the rules change here, Exchange deletes it, and Outlook makes a new one.`;
    this.mayDeleteOutlookRulesCopy = true;
  }

  /** Before we let Exchange delete the copy of the rules that Outlook keeps:
   * Outlook may have changed its copy since we read it. */
  protected async checkOutlookRulesCopyAgain() {
    if (!this.mayDeleteOutlookRulesCopy) {
      return;
    }
    await this.fetchServerFilterRules();
    if (this.serverFilterRulesReadOnlyReason) {
      throw new UserError(this.serverFilterRulesReadOnlyReason);
    }
  }

  /** @returns The property `PR_RW_RULES_STREAM` of each hidden message in the Inbox with the copy of the rules that Outlook keeps.
   * Empty, if there is no copy. */
  protected async fetchOutlookRulesStreams(): Promise<Uint8Array[]> {
    throw new AbstractFunction();
  }

  async deleteIt(): Promise<void> {
    if (this.isDependentAccount) {
      let dependentOfDelegate = this.mainAccount.dependentAccounts()
        .filterOnce(acc => acc != this && acc.username == this.username);
      for (let sibling of dependentOfDelegate) {
        await sibling.deleteIt();
      }
    }
    await super.deleteIt();
  }
}
