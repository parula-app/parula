import { openApp } from "../AppsBar/selectedApp";
import { mailMustangApp } from "../Mail/MailMustangApp";
import { calendarMustangApp } from "../Calendar/CalendarMustangApp";
import { contactsMustangApp } from "../Contacts/ContactsMustangApp";
import { selectedAccount } from "../Mail/Selected";
import { selectedCalendar, selectedDate } from "../Calendar/selected";
import { createNewEvent } from "../Calendar/event";
import { createNewPerson } from "../Contacts/person";
import { getKeyDigit, getOSName, isTextField } from "../Util/util";
import { appGlobal } from "../../logic/app";
import { webMail } from "../../logic/build";
import { assert } from "../../logic/util/util";
import { gt } from "../../l10n/l10n";
import { get } from "svelte/store";

// <https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values>

/** Keys that work in all apps of the main window */
export async function onKeyOnWindow(event: KeyboardEvent) {
  if (event.defaultPrevented) {
    return;
  }
  let isCtrl = event.ctrlKey || event.metaKey;
  // Ctrl+1 etc. switch the tabs of a browser, so the web app uses Ctrl+Shift+1 etc., like Outlook on the web
  if (isCtrl && !event.altKey && event.shiftKey == !!webMail) {
    let digit = getKeyDigit(event);
    if (digit == 1) { // Outlook
      event.preventDefault();
      event.stopPropagation();
      openApp(mailMustangApp, mailMustangApp.windowParams);
      return;
    } else if (digit == 2) { // Outlook
      event.preventDefault();
      event.stopPropagation();
      openApp(calendarMustangApp, calendarMustangApp.windowParams);
      return;
    } else if (digit == 3 || digit == 4) { // Outlook: People, Tasks
      event.preventDefault();
      event.stopPropagation();
      openApp(contactsMustangApp, contactsMustangApp.windowParams);
      return;
    }
  }
  // Ctrl+Shift+
  if (isCtrl && event.shiftKey && !event.altKey) {
    let key = event.key.toLowerCase();
    if (key == "m") { // Outlook
      event.preventDefault();
      event.stopPropagation();
      let account = get(selectedAccount) ?? appGlobal.emailAccounts.first;
      assert(account, gt`Please set up a mail account first`);
      mailMustangApp.writeMail(account.newEMailFrom());
      return;
    } else if (key == "a" || key == "q") { // Outlook: Appointment, Meeting
      event.preventDefault();
      event.stopPropagation();
      createNewEvent(get(selectedCalendar), get(selectedDate), false);
      return;
    } else if (key == "c") { // Outlook
      event.preventDefault();
      event.stopPropagation();
      openApp(contactsMustangApp, contactsMustangApp.windowParams);
      createNewPerson(null);
      return;
    } else if (key == "b" && !isTextField(event.target)) { // Outlook: Address book
      event.preventDefault();
      event.stopPropagation();
      openApp(contactsMustangApp, contactsMustangApp.windowParams);
      return;
    }
  }
  // No Ctrl
  if (!isCtrl && !event.shiftKey) {
    if ((event.key == "F3" && !event.altKey) || // Outlook
        (event.code == "KeyQ" && event.altKey && getOSName() != "macintosh")) { // Outlook. Option+Q types a character on macOS.
      event.preventDefault();
      event.stopPropagation();
      focusSearch();
      return;
    }
  }
}

/** Puts the cursor into the search field in the window header */
export function focusSearch() {
  document.querySelector<HTMLInputElement>(".window-header .search-box input")?.focus();
}
