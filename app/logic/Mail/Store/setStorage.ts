// #if [!WEBMAIL]
import { RawFilesAttachment } from "./RawFilesAttachment";
import { MailDir } from "./MailDir";
import { SQLMailStorage } from "../SQL/SQLMailStorage";
import { SQLSearchEMail } from "../SQL/SQLSearchEMail";
import { SQLSourceEMail } from "../SQL/Source/SQLSourceEMail";
// #else
import { DummyMailStorage } from "../Store/DummyMailStorage";
// #endif
import type { MailAccount } from "../MailAccount";
import type { EMail } from "../EMail";
import { SearchEMail } from "./SearchEMail";
import { CombinedSearchEMail } from "./CombinedSearchEMail";

export function setStorage(acc: MailAccount) {
  if (!acc.storage) {
    // #if [!WEBMAIL]
    acc.storage = new SQLMailStorage();
    // #else
    acc.storage = new DummyMailStorage();
    // #endif
  }
  setContentStorage(acc);
}

export function setContentStorage(acc: MailAccount) {
  // #if [!WEBMAIL]
  if (acc.contentStorage.isEmpty) {
    // First entry will be used for reading
    acc.contentStorage.add(new SQLSourceEMail());
    //acc.contentStorage.add(new MailZIP());
    if (acc.protocol == "pop3") { // The server does not keep the mails, so back them up as files
      acc.contentStorage.add(new MailDir());
    }
    acc.contentStorage.add(new RawFilesAttachment());
  }
  // #endif
}

export function newSearchEMail(): SearchEMail {
  // Too many places use this and assume that they get all results after `startSearch()` returns
  return newLocalSearchEMail();
}

export function newLocalSearchEMail(): SearchEMail {
  // #if [!WEBMAIL]
  return new SQLSearchEMail();
  // #else
  return new SearchEMail(); // dummy
  // #endif
}

export function newServerSearchEMail(): SearchEMail {
  return new CombinedSearchEMail();
}

export async function findMessageByID(msgid: string): Promise<EMail | undefined> {
  let search = newSearchEMail();
  search.messageID = msgid;
  let results = await search.startSearch();
  if (results.isEmpty) {
    return undefined;
  }
  return results.first;
}
