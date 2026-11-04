import { Calendar } from "../../logic/Calendar/Calendar";
import { Addressbook } from "../../logic/Contacts/Addressbook";
import { CalDAVCalendar } from "../../logic/Calendar/CalDAV/CalDAVCalendar";
import { CardDAVAddressbook } from "../../logic/Contacts/CardDAV/CardDAVAddressbook";
import { newCalendarForProtocol } from "../../logic/Calendar/AccountsList/Calendars";
import { newAddressbookForProtocol } from "../../logic/Contacts/AccountsList/Addressbooks";
import { AuthMethod } from "../../logic/Abstract/Account";
import { appGlobal } from "../../logic/app";
import { minorError } from "../../frontend/Util/error";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { assert } from "../../logic/util/util";
import { gt } from "../../l10n/l10n";
import type { DAVCalendar, DAVAddressBook } from "tsdav";

export type FolderAccountKind = "calendar" | "addressbook";
export type ServerFolder = DAVCalendar | DAVAddressBook;

export async function saveLocalFolderAccount(config: Calendar | Addressbook) {
  config.name = config.name.trim();
  // <copied from="../../frontend/Setup/Calendar/LocalCalendarSetup.svelte"> and Contacts/LocalAddressbookSetup.svelte
  await config.save();
  if (config instanceof Calendar) {
    appGlobal.calendars.add(config);
  } else if (config instanceof Addressbook) {
    appGlobal.addressbooks.add(config);
  }
  // </copied>
}

export async function findServerFolders(config: Calendar | Addressbook, kind: FolderAccountKind): Promise<ServerFolder[]> {
  config.url = config.url.trim();
  config.username = config.username.trim();
  // <copied from="../../frontend/Setup/Calendar/CalDAVSetup.svelte"> and Contacts/CardDAVSetup.svelte
  config.authMethod = AuthMethod.Password;
  await config.verifyLogin();
  // </copied>
  let available = config instanceof CalDAVCalendar
    ? await config.listCalendars()
    : await (config as CardDAVAddressbook).listAddressbooks();
  assert(available?.hasItems, kind == "calendar"
    ? gt`No calendars found in this account`
    : gt`No address books found in this account`);
  return available.contents;
}

export async function saveServerFolders(config: Calendar | Addressbook, available: ServerFolder[], chosen: ServerFolder[]) {
  let primary = available.find(folder => chosen.includes(folder));
  assert(primary, gt`Please choose at least one *=> Choose at least one calendar or address book`);
  // <copied from="../../frontend/Setup/Calendar/CalDAVSelectCalendar.svelte" onContinue()> and Contacts/CardDAVSelectAddressbook.svelte
  if (config instanceof CalDAVCalendar) {
    config.calendarURL = sanitize.url(primary.url);
    await config.login(true);
    await config.listEvents();
    appGlobal.calendars.add(config);
  } else if (config instanceof CardDAVAddressbook) {
    config.addressbookURL = sanitize.url(primary.url);
    await config.login(true);
    await config.listContacts();
    appGlobal.addressbooks.add(config);
  }
  await config.save();
  let i = 0;
  for (let additional of chosen) {
    if (additional == primary) {
      continue;
    }
    let name = config.name + " " + sanitize.nonemptylabel(additional.displayName as string, "" + ++i);
    if (config instanceof CalDAVCalendar) {
      let sub = newCalendarForProtocol(config.protocol) as CalDAVCalendar;
      sub.initFromMainAccount(config);
      sub.name = name;
      sub.calendarURL = sanitize.url(additional.url);
      appGlobal.calendars.add(sub);
      await sub.save();
      sub.listEvents()
        .catch(minorError);
    } else if (config instanceof CardDAVAddressbook) {
      let sub = newAddressbookForProtocol(config.protocol) as CardDAVAddressbook;
      sub.initFromMainAccount(config);
      sub.name = name;
      sub.addressbookURL = sanitize.url(additional.url);
      appGlobal.addressbooks.add(sub);
      await sub.save();
      sub.listContacts()
        .catch(minorError);
    }
  }
  // </copied>
}
