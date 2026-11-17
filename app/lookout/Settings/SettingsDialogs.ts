import type { Account } from "../../logic/Abstract/Account";
import type { Addressbook } from "../../logic/Contacts/Addressbook";
import type { Calendar } from "../../logic/Calendar/Calendar";
import type { MailIdentity } from "../../logic/Mail/MailIdentity";
import type { FolderAccountKind } from "../Setup/NewFolderAccountFlow";
import { selectedIdentity } from "./TrustCenter/selected";
import { SetupMustangApp } from "../../frontend/Setup/SetupMustangApp";
import { openApp, selectedApp } from "../../frontend/AppsBar/selectedApp";
import { mailMustangApp } from "../../frontend/Mail/MailMustangApp";
import { AppWindow } from "../../frontend/MainWindow/AppWindow";
import { get, writable } from "svelte/store";

export type ImportExportAction = "import" | "import-vcard" | "import-ical" | "import-program" | "export";

export type SettingsDialog =
  { kind: "options", categoryID?: string, account?: Account } |
  { kind: "account", account: Account, categoryID?: string } |
  { kind: "import-export", preselected?: Calendar | Addressbook, action?: ImportExportAction } |
  { kind: "new-folder-account", folderKind: FolderAccountKind, localOnly?: boolean };

export const settingsDialog = AppWindow.perWindow(() => writable<SettingsDialog | null>(null));

export function openSettingsDialog(dialog: SettingsDialog) {
  settingsDialog.set(dialog);
}

export function openOptions(categoryID = "global") {
  openSettingsDialog({ kind: "options", categoryID });
}

export function openAccountSettings(account: Account, categoryID = "acc-general") {
  openSettingsDialog({ kind: "account", account, categoryID });
}

export function openTrustCenter(identity: MailIdentity = null) {
  selectedIdentity.set(identity);
  openOptions("trust-center");
}

export function openSetup(setupURL: string, returnTo: SettingsDialog | null = null) {
  let appWindow = AppWindow.current();
  let previousApp = get(selectedApp) ?? mailMustangApp;
  closeSettingsDialog();
  let setupApp = new SetupMustangApp();
  setupApp.appURL = setupURL;
  if (returnTo) {
    setupApp.onBack = () => {
      openApp(previousApp, {});
      appWindow.uiState(settingsDialog).set(returnTo);
      appWindow.focus();
    };
  }
  openApp(setupApp, {});
}

export function closeSettingsDialog() {
  settingsDialog.set(null);
}
