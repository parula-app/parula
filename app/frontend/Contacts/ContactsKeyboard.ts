import type { Addressbook } from "../../logic/Contacts/Addressbook";
import { createNewPerson } from "./person";
import { focusSearch } from "../MainWindow/GlobalKeyboard";
import { isTextField } from "../Util/util";

// <https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values>

/** Keys of the contacts app
 * @param addressbook The address book that the contacts list shows */
export function onKeyOnContacts(event: KeyboardEvent, addressbook: Addressbook | null) {
  if (event.defaultPrevented || isTextField(event.target)) {
    return;
  }
  // Ctrl+ (or Cmd+)
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
    let key = event.key.toLowerCase();
    if (key == "n") { // Outlook
      event.preventDefault();
      event.stopPropagation();
      createNewPerson(addressbook);
      return;
    } else if (key == "e") { // Outlook
      event.preventDefault();
      event.stopPropagation();
      focusSearch();
      return;
    }
  }
}
