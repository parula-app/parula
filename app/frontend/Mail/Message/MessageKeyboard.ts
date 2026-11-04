import { DeleteStrategy } from "../../../logic/Mail/MailAccount";
import { selectedMessage, selectedMessages } from "../Selected";
import { openComposer } from "../open";
import { isTextField } from "../../Util/util";
import { get } from "svelte/store";

// <https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values>

export async function onKeyOnList(event: KeyboardEvent) {
  if (isTextField(event.target)) {
    return;
  }
  let selectedMessagesColl = get(selectedMessages);
  /** Important to use normal static array here. If were were to use `selectedMessages` Collection,
   * it would observe changes to selection even in the future and keep triggering
   * the action for all future selections. */
  let messages = selectedMessagesColl?.contents;
  if (!messages?.length) {
    return;
  }
  let message = get(selectedMessage) ?? messages[0];

  function goToNextMessage(previous = false) {
    let next = message.nextMessage(previous);
    if (!next) {
      return;
    }
    selectedMessagesColl.clear();
    selectedMessagesColl.add(next);
  }

  // No modifier
  if (!event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
    if (event.key == "m") { // Thunderbird
      event.preventDefault();
      event.stopPropagation();
      let isRead = majority(messages, msg => msg.isRead);
      await Promise.allSettled(messages.map(msg =>
        msg.markRead(!isRead)));
      return;
    } else if (event.key == "s" || event.key == "Insert") { // s: Thunderbird, Insert: Outlook
      event.preventDefault();
      event.stopPropagation();
      let isStarred = majority(messages, msg => msg.isStarred);
      await Promise.allSettled(messages.map(msg =>
        msg.markStarred(!isStarred)));
      return;
    } else if (event.key == "j") { // Thunderbird
      event.preventDefault();
      event.stopPropagation();
      goToNextMessage();
      await Promise.allSettled(messages.map(msg =>
        msg.treatSpam()));
      return;
    } else if (event.key == "Delete" || event.key == "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      goToNextMessage();
      await Promise.allSettled(messages.map(msg =>
        msg.deleteMessage()));
      return;
    } else if (event.key == "f") { // Thunderbird
      event.preventDefault();
      event.stopPropagation();
      goToNextMessage();
      return;
    } else if (event.key == "b") { // Thunderbird
      event.preventDefault();
      event.stopPropagation();
      goToNextMessage(true);
      return;
    } else if (event.key == "F5" || event.key == "F9") { // F5: Thunderbird, F9: Outlook
      event.preventDefault();
      event.stopPropagation();
      await message.folder.getNewMessages();
      return;
    }
  }
  // Ctrl+ (or Cmd+)
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
    if (event.key == "r") { // Thunderbird
      event.preventDefault();
      event.stopPropagation();
      openComposer(message.compose.replyToAuthor());
      return;
    } else if (event.key == "l" || event.key == "f") { // l: Thunderbird, f: Outlook
      event.preventDefault();
      event.stopPropagation();
      openComposer(await message.compose.forward());
      return;
    } else if (event.key == "u") { // Outlook
        event.preventDefault();
        event.stopPropagation();
        await Promise.allSettled(messages.map(msg =>
          msg.markRead(false)));
        return;
    } else if (event.key == "q" && event.ctrlKey) { // Outlook. Cmd+Q stays Quit on macOS.
      event.preventDefault();
      event.stopPropagation();
      await Promise.allSettled(messages.map(msg =>
        msg.markRead(true)));
      return;
    } else if (event.key == "m" && event.ctrlKey) { // Outlook. Cmd+M stays Minimize on macOS.
      event.preventDefault();
      event.stopPropagation();
      await message.folder.getNewMessages();
      return;
    } else if (event.key == "d") { // Outlook
      event.preventDefault();
      event.stopPropagation();
      goToNextMessage();
      await Promise.allSettled(messages.map(msg =>
        msg.deleteMessage()));
      return;
    } else if (event.key == "." || event.key == ",") { // Outlook
      event.preventDefault();
      event.stopPropagation();
      goToNextMessage(event.key == ",");
      return;
    } else if (event.key == "p") { // Outlook
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new Event("mail-print"));
      return;
    } else if (event.key == "n") { // Thunderbird
      event.preventDefault();
      event.stopPropagation();
      openComposer(message.folder.account.newEMailFrom());
      return;
    } else if (event.key == "e") { // Thunderbird
      event.preventDefault();
      event.stopPropagation();
      openComposer(await message.compose.editAsNew());
      return;
    }
  }
  // Ctrl+Shift+
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey) {
    if (event.key == "R") { // Thunderbird
      event.preventDefault();
      event.stopPropagation();
      openComposer(message.compose.replyAll());
      return;
    } else if (event.key == "L") { // Thunderbird
      event.preventDefault();
      event.stopPropagation();
      openComposer(await message.compose.forwardAsAttachment());
      return;
    } else if (event.key == "N") { // Mustang
      event.preventDefault();
      event.stopPropagation();
      openComposer(message.compose.newToAll());
      return;
    } else if (event.key == "V" || event.key == "Y") { // Outlook: Move, Copy
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new Event("mail-move-popup"));
      return;
    }
  }
  // Ctrl+Alt+
  if ((event.ctrlKey || event.metaKey) && event.altKey && !event.shiftKey) {
    if (event.code == "KeyF") { // Outlook
      event.preventDefault();
      event.stopPropagation();
      openComposer(await message.compose.forwardAsAttachment());
      return;
    } else if (event.code == "KeyJ") { // Outlook
      event.preventDefault();
      event.stopPropagation();
      await Promise.allSettled(messages.map(msg =>
        msg.treatSpam(false)));
      return;
    }
  }
  // Shift+
  if (event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
    if (event.key == "J") { // Thunderbird
      event.preventDefault();
      event.stopPropagation();
      await Promise.allSettled(messages.map(msg =>
        msg.treatSpam(false)));
      return;
    } else if (event.key == "Delete" || event.key == "Backspace") { // Thunderbird
      event.preventDefault();
      event.stopPropagation();
      goToNextMessage();
      await Promise.allSettled(messages.map(msg =>
        msg.deleteMessage(DeleteStrategy.DeleteImmediately)));
      return;
    }
  }
}

export async function onKeyOnMessage(event: KeyboardEvent) {
  await onKeyOnList(event);

  let message = get(selectedMessage);
  if (!message) {
    return;
  }
  let selectedMessagesColl = get(selectedMessages);
  if (!event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
    if (event.key == "ArrowDown" || event.key == "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      let next = message.nextMessage(event.key == "ArrowUp");
      if (!next) {
        return;
      }
      selectedMessagesColl.clear();
      selectedMessagesColl.add(next);
      return;
    }
    // Message shortcuts already work just with `onKeyOnList()`
  }
}

function majority<T>(array: Array<T>, condition: (item: T) => boolean): boolean {
  return array.filter(condition).length / array.length > 0.5;
}


/**
 * Electron InputEvent uses shift / control / alt / meta, but
 * KeyboardEvent init needs shiftKey / ctrlKey / altKey / metaKey.
 * Generic utility function
 * @see https://www.electronjs.org/docs/latest/api/web-contents#event-before-input-event
 * @see https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent
 */
export function newElectronKeyboardEvent(event: any) {
  return new KeyboardEvent("keydown", {
    key: event.key,
    code: event.code,
    repeat: event.isAutoRepeat,
    isComposing: event.isComposing,
    shiftKey: event.shift,
    ctrlKey: event.control,
    altKey: event.alt,
    metaKey: event.meta,
    location: event.location,
  });
}
