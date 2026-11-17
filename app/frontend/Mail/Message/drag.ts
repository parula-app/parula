import type { EMail } from "../../../logic/Mail/EMail";
import type { Folder } from "../../../logic/Mail/Folder";
import { selectedMessage, selectedMessages } from "../Selected";
import { ArrayColl } from "svelte-collections";
import { get } from "svelte/store";
import { assert } from "../../../logic/util/util";
import { gt } from "../../../l10n/l10n";

/** The messages that the user drags right now. They may be dropped into another window. */
let draggedMessages: EMail[] = [];

export function onDragStartMail(event: DragEvent, message: EMail) {
  selectedMessage.set(message);
  let messages = get(selectedMessages);
  draggedMessages = messages.contains(message) ? messages.contents : [ message ];
  event.dataTransfer.setData("message/drag-ids", draggedMessages.map(msg => msg.id).join(","));
  event.dataTransfer.effectAllowed = "copyMove";
  let icon = new Image();
  icon.src = "icon/mails.png"; // TODO Loads too late
  event.dataTransfer.setDragImage(icon, 8, 8);
}

export async function onDropMail(event: DragEvent, folder: Folder) {
  event.preventDefault();
  let messages = draggedMessages;
  let msgIDsStr = event.dataTransfer.getData("message/drag-ids");
  if (!messages.length || !msgIDsStr) {
    return;
  }
  let msgIDs = msgIDsStr.split(",");
  assert(msgIDs.length == messages.length && messages.every(msg => msgIDs.includes(msg.id)), gt`Drag&drop failed: Selected message IDs don't match the drag data`);
  if (event.ctrlKey || event.metaKey) {
    await folder.copyMessagesHere(new ArrayColl(messages));
  } else {
    await folder.moveMessagesHere(new ArrayColl(messages));
  }
}

export async function onDragOverMail(event: DragEvent, folder: Folder) {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    event.dataTransfer.dropEffect = "copy";
  }
}
