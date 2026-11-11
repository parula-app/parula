import { MustangApp } from "../AppsBar/MustangApp";
import contactsIcon from '../asset/icon/appBar/contacts.svg?raw';
import { gt } from "../../l10n/l10n";

export class ContactsMustangApp extends MustangApp {
  id = "contacts";
  get name() {
    return gt`People *=> or Persons - Short word, less than 10 characters`;
  }
  icon = contactsIcon;
  appURL = "/contacts";
}

export const contactsMustangApp = new ContactsMustangApp();
