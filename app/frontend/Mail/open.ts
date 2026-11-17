import { selectedAccount, selectedFolder, selectedMessage, selectedSearchTab } from "./Selected";
import type { SearchView } from "./LeftPane/SearchSwitcher.svelte";
import { mailMustangApp } from "./MailMustangApp";
import { goTo, openApp } from "../AppsBar/selectedApp";
import { AppWindow } from "../MainWindow/AppWindow";
import { appGlobal } from "../../logic/app";
import type { EMail } from "../../logic/Mail/EMail";
import { URLPart } from "../../logic/util/blob";
import { assert } from "../../logic/util/util";
import { tick } from "svelte";

export async function openEMailMessage(message: EMail, tab?: SearchView) {
  assert(message.folder?.account, "no account for email");
  let appWindow = AppWindow.current().mainWindow;
  appWindow.uiState(selectedAccount).set(message.folder?.account);
  appWindow.uiState(selectedFolder).set(message.folder);
  appWindow.uiState(selectedMessage).set(message);
  if (tab) {
    appWindow.uiState(selectedSearchTab).set(tab);
  }

  if (appGlobal.isMobile) { // TODO unify
    goTo(URLPart`/mail/message/${message.folder.account.id}/${message.folder.id}/${message.id}/display`, {
      message: message,
      folder: message.folder,
      account: message.folder?.account,
      tab: tab,
    });
  } else {
    openApp(mailMustangApp, {
      message: message,
      folder: message.folder,
      account: message.folder?.account,
      tab: tab,
    });
  }

  await tick();
  appWindow.uiState(selectedAccount).set(message.folder?.account);
  appWindow.uiState(selectedFolder).set(message.folder);
  appWindow.uiState(selectedMessage).set(message);
  if (tab) {
    appWindow.uiState(selectedSearchTab).set(tab);
  }
}

export function openComposer(mail: EMail) {
  mailMustangApp.writeMail(mail);
}
