import type { Account } from "../../../logic/Abstract/Account";
import { gt } from "../../../l10n/l10n";

export function getAccountTypeLabel(account: Account): string {
  let protocol = account.protocol?.replace(/^(calendar|addressbook|gal)-/, "");
  switch (protocol) {
    case "imap":
      return "IMAP";
    case "pop3":
      return "POP3";
    case "ews":
    case "owa":
      return "Microsoft Exchange";
    case "graph":
      return "Microsoft 365";
    case "activesync":
      return "Exchange ActiveSync";
    case "jmap":
      return "JMAP";
    case "caldav":
      return "CalDAV";
    case "carddav":
      return "CardDAV";
    case "local":
      return gt`On this computer`;
    case "mail":
      return gt`Email *=> Account type: email account`;
    default:
      return account.protocol ?? "";
  }
}

export function getAccountFullTypeLabel(account: Account): string {
  let type = getAccountTypeLabel(account);
  if (account.isDependentAccount && account.mainAccount) {
    return gt`${type} (part of ${account.mainAccount.name})`;
  }
  return type;
}
