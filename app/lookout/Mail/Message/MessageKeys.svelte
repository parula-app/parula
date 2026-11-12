<AppWindowEvents on:keydown={event => catchErrors(() => onKey(event))} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { MessageActions } from "../MessageActions";
  import { printMessage } from "../Selected";
  import { isTextField } from "../../Util/util";
  import { catchErrors } from "../../../frontend/Util/error";
  import AppWindowEvents from "../../../frontend/MainWindow/AppWindowEvents.svelte";

  export let messages: EMail[];
  export let pageEl: HTMLElement;

  async function onKey(event: KeyboardEvent) {
    // <copied from="../MailApp.svelte">
    let target = event.target as HTMLElement;
    if (event.defaultPrevented || pageEl?.ownerDocument.querySelector("dialog:modal") || isTextField(target) ||
        !pageEl?.contains(target) && target != pageEl?.ownerDocument.body) {
      return;
    }
    let isCtrl = event.ctrlKey || event.metaKey;
    let key = event.key.length == 1 ? event.key.toLowerCase() : event.key;
    // With AltGr layouts, Ctrl+Alt+letter types another character
    let letter = event.code.startsWith("Key") ? event.code.slice(3).toLowerCase() : key;
    // </copied>
    let message = messages.length == 1 ? messages[0] : null;
    // Ctrl+Alt+
    if (isCtrl && event.altKey && !event.shiftKey) {
      if (letter == "f") {
        event.preventDefault();
        event.stopPropagation();
        if (message) {
          MessageActions.writeMail(await message.compose.forwardAsAttachment());
        }
        return;
      } else if (letter == "j") {
        event.preventDefault();
        event.stopPropagation();
        await Promise.all(messages.map(msg => msg.treatSpam(false)));
        return;
      } else if (letter == "u") {
        event.preventDefault();
        event.stopPropagation();
        await Promise.all(messages.map(msg => msg.markRead(true)));
        return;
      }
    }
    // Ctrl+Shift+
    if (isCtrl && event.shiftKey && !event.altKey) {
      if (key == "r") {
        event.preventDefault();
        event.stopPropagation();
        if (message) {
          await MessageActions.respond(message, message.compose.replyAll());
        }
        return;
      }
    }
    // Ctrl+ (or Cmd+)
    if (isCtrl && !event.altKey && !event.shiftKey) {
      if (key == "r") {
        event.preventDefault();
        event.stopPropagation();
        if (message) {
          await MessageActions.respond(message, message.compose.replyToAuthor());
        }
        return;
      } else if (key == "f") {
        event.preventDefault();
        event.stopPropagation();
        if (message) {
          await MessageActions.forward(message, event);
        }
        return;
      } else if (key == "d") {
        event.preventDefault();
        event.stopPropagation();
        await Promise.all(messages.map(msg => msg.deleteMessage()));
        return;
      } else if (key == "q" && event.ctrlKey) { // Cmd+Q is Quit on macOS
        event.preventDefault();
        event.stopPropagation();
        await Promise.all(messages.map(msg => msg.markRead(true)));
        return;
      } else if (key == "u") {
        event.preventDefault();
        event.stopPropagation();
        await Promise.all(messages.map(msg => msg.markRead(false)));
        return;
      } else if (key == "j") {
        event.preventDefault();
        event.stopPropagation();
        await Promise.all(messages.map(msg => msg.treatSpam(true)));
        return;
      } else if (key == "p") {
        event.preventDefault();
        event.stopPropagation();
        if (message) {
          $printMessage = message;
        }
        return;
      }
    }
    // Shift+
    if (event.shiftKey && !isCtrl && !event.altKey) {
      if (key == "Delete") {
        event.preventDefault();
        event.stopPropagation();
        if (messages.length) {
          await MessageActions.deletePermanently(messages);
        }
        return;
      }
    }
    // No modifier
    if (!isCtrl && !event.altKey && !event.shiftKey) {
      if (key == "Delete") {
        event.preventDefault();
        event.stopPropagation();
        await Promise.all(messages.map(msg => msg.deleteMessage()));
        return;
      } else if (key == "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        if (messages.length) {
          await MessageActions.archive(messages);
        }
        return;
      } else if (key == "Insert") {
        event.preventDefault();
        event.stopPropagation();
        let isFlagged = !messages.every(msg => msg.isStarred);
        await Promise.all(messages.map(msg => msg.markStarred(isFlagged)));
        return;
      }
    }
  }
</script>
