import type { File as FileEntry } from "../../logic/Files/File";
import { filesMustangApp } from "./FilesMustangApp";
import { selectedFile } from "./selected";
import { goTo, openApp } from "../AppsBar/selectedApp";
import { AppWindow } from "../MainWindow/AppWindow";
import { openEMailMessage } from "../Mail/open";
import { allAccountsAccount } from "../../logic/Mail/AccountsList/ShowAccounts";
import { appGlobal } from "../../logic/app";
import { assert } from "../../logic/util/util";

export function openFileFromOtherApp(file: FileEntry) {
  AppWindow.current().mainWindow.uiState(selectedFile).set(file);
  if (appGlobal.isMobile) {
    goTo("files/file", { file });
  } else {
    openApp(filesMustangApp, { file });
  }
}

export function canOpenFileInternally(mimeType: string): boolean {
  return mimeType == "message/rfc822";
}

export async function openFileInternallyFromFile(file: File) {
  if (file && canOpenFileInternally(file.type)) {
    await openFileInternally(new Uint8Array(await file.arrayBuffer()), file.type);
  }
}

/**
 * File an appropriate internal viewer for the file of type `mimeType`.
 * @returns whether internal viewer was found
 */
export async function openFileInternally(fileContents: Uint8Array, mimeType: string) {
  if (mimeType == "message/rfc822") {
    await openEMail(fileContents);
    return true;
  }
  return false;
}

async function openEMail(mime: Uint8Array) {
  let folder = allAccountsAccount.inbox; // copy to folder must be a different account
  assert(folder, "Need folder");
  let email = folder.newEMail();
  email.mime = mime;
  await email.parseMIME();
  await openEMailMessage(email);
}
