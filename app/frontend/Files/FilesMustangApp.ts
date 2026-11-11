import { MustangApp } from "../AppsBar/MustangApp";
import fileShareIcon from '../asset/icon/appBar/fileShare.svg?raw';
import { gt } from "../../l10n/l10n";

export class FilesMustangApp extends MustangApp {
  id = "files";
  get name() {
    return gt`Files`;
  }
  icon = fileShareIcon;
  appURL = "/files";
}

export const filesMustangApp = new FilesMustangApp();
