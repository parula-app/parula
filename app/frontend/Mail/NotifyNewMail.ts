import type { EMail } from "../../logic/Mail/EMail";
import type { MailAccount } from "../../logic/Mail/MailAccount";
import { SpecialFolder, type Folder } from "../../logic/Mail/Folder";
import { selectedMessage, selectedFolder, selectedAccount } from "./Selected";
import { mailMustangApp } from "./MailMustangApp";
import { openApp, bringAppToFront } from "../AppsBar/selectedApp";
import { appGlobal } from "../../logic/app";
import { SystemNotification, NotificationKinds } from "../Shared/SystemNotification";
import { getLocalStorage } from "../Util/LocalStorage";
import MailIcon from '../asset/icon/appBar/mail.svg?raw';
import { logErrorToServer, showError } from "../Util/error";
import { CollectionObserver, type ArrayColl } from "svelte-collections";

export async function newMailListener() {
  appGlobal.emailAccounts.registerObserver(accountsObserver);
}

export async function showNewMail(messages: EMail[]) {
  console.log("Show new mail", messages.length);
  if (!messages?.length) {
    return;
  }

  // settings
  const kinds = new NotificationKinds(getLocalStorage("notifications.mail", ["popup"]).value);
  const onlyInAB = getLocalStorage("notifications.mail.only.addressbook", true).value;

  const filterConditions: ((msg: EMail) => boolean)[] = [];
  filterConditions.push(msg => msg.isNewArrived && !msg.isRead);
  if (onlyInAB) {
    filterConditions.push(msg => msg.from?.findPerson() && appGlobal.addressbooks.some(ab => ab.persons.some(person => person == msg.from.person)));
  }

  messages = messages.filter(msg => filterConditions.every(func => func(msg)));
  console.log("  after filters", messages.length);
  if (!messages?.length) {
    return;
  }
  let count = messages.length;
  messages = messages.slice(0, 5);
  let singleMsg = messages.length == 1 ? messages[0] : null;
  let firstMsg = singleMsg ?? messages[0];

  let title = singleMsg?.subject ??
    messages.map(msg => msg.subject?.substring(0, 20) ?? "").join(", ").substring(0, 60);
  let body = singleMsg?.text ??
    messages.map(msg => msg.text?.substring(0, 30)).join(", ").substring(0, 160);

  let notification = new SystemNotification(kinds, title, body, "New Mail");
  notification.count = count;
  notification.icon = MailIcon;
  notification.onClick = () => openMessage(firstMsg);
  notification.onReply = replyText => reply(firstMsg, replyText);
  notification.replyPlaceholder = "Reply…";
  await notification.show();
}

async function openMessage(msg: EMail) {
  try {
    selectedMessage.set(msg);
    selectedFolder.set(msg.folder);
    selectedAccount.set(msg.folder?.account);
    openApp(mailMustangApp, {
      message: msg,
      folder: msg.folder,
      account: msg.folder?.account,
    });
    bringAppToFront();
  } catch (ex) {
    console.error(ex);
  }
}

async function reply(msg: EMail, replyText: string) {
  try {
    console.log("Reply with:\n" + replyText + "\nto msg\n" + msg.subject);
    let replyMsg = msg.compose.replyToAuthor();
    replyMsg.html = null;
    replyMsg.text = replyText;
    await replyMsg.compose.send();
  } catch (ex) {
    showError(ex);
  }
}

class NewMessageObserver extends CollectionObserver<EMail> {
  added(messages: EMail[] | ArrayColl<EMail>) {
    // `addAll()` hands us whatever the caller passed, usually a `Collection`, which has no [0]
    showNewMail(Array.from(messages))
      .catch(logErrorToServer);
  }
  removed(messages: EMail[] | ArrayColl<EMail>) {
    // do nothing
  }
}
let newMessageObserver = new NewMessageObserver();

class AccountsObserver extends CollectionObserver<MailAccount> {
  added(accounts: MailAccount[]) {
    for (let account of accounts) {
      account.rootFolders.registerObserver(foldersObserver);
      observeInbox(account.rootFolders.contents);
    }
  }
  removed(accounts: MailAccount[]) {
    for (let account of accounts) {
      account.rootFolders.unregisterObserver(foldersObserver);
      account.inbox?.messages.unregisterObserver(newMessageObserver);
    }
  }
}
let accountsObserver = new AccountsObserver();

/** We know the account long before its folders: They arrive one by one,
 * first from the database, then from the server. */
class FoldersObserver extends CollectionObserver<Folder> {
  added(folders: Folder[]) {
    observeInbox(folders);
  }
  removed(folders: Folder[]) {
    // do nothing
  }
}
let foldersObserver = new FoldersObserver();

function observeInbox(folders: Folder[]) {
  for (let folder of folders) {
    if (folder.specialFolder == SpecialFolder.Inbox) {
      folder.messages.registerObserver(newMessageObserver);
    }
  }
}
