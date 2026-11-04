import type { EMail } from "../../logic/Mail/EMail";
import { type Folder, SpecialFolder } from "../../logic/Mail/Folder";
import type { MailAccount } from "../../logic/Mail/MailAccount";
import { SavedSearchFolder } from "../../logic/Mail/Virtual/SavedSearchFolder";
import { DeleteStrategy } from "../../logic/Mail/MailAccount";
import type { Tag } from "../../logic/Abstract/Tag";
import { Person } from "../../logic/Abstract/Person";
import type { PersonUID } from "../../logic/Abstract/PersonUID";
import type { Calendar } from "../../logic/Calendar/Calendar";
import { appGlobal } from "../../logic/app";
import { showMessageBox } from "../Shared/Dialog/MessageBox";
import type { ReadingPanePosition } from "./3pane/3Pane.svelte";
import { startInlineReply, removeInlineReply } from "./Composer/InlineReplies";
import { updatingFolders } from "./Selected";
import { recentFolders } from "./RecentFolders";
import { mailMustangApp } from "../../frontend/Mail/MailMustangApp";
import { contactsMustangApp } from "../../frontend/Contacts/ContactsMustangApp";
import { selectedCalendar } from "../../frontend/Calendar/selected";
import { createNewEvent } from "../../frontend/Calendar/event";
import { CalendarActions } from "../Calendar/CalendarActions";
import { newPerson } from "../../frontend/Contacts/Person/Selected";
import { selectedFolder, selectedMessage, selectedMessages } from "../../frontend/Mail/Selected";
import { openPersonFromOtherApp } from "../../frontend/Contacts/open";
import { goTo, openApp, selectedApp } from "../../frontend/AppsBar/selectedApp";
import { getLocalStorage } from "../../frontend/Util/LocalStorage";
import { saveBlobAsFile } from "../../frontend/Util/util";
import { URLPart } from "../../logic/util/blob";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { assert } from "../../logic/util/util";
import { ArrayColl } from "svelte-collections";
import { gt } from "../../l10n/l10n";
import { get } from "svelte/store";

export class MessageActions {
  static accountForNewMail(folder: Folder | null): MailAccount {
    let account = folder?.account && appGlobal.emailAccounts.contains(folder.account)
      ? folder.account
      : appGlobal.emailAccounts.first;
    assert(account, gt`Please set up a mail account first`);
    return account;
  }

  static writeMailTo(recipient: PersonUID) {
    let mail = MessageActions.accountForNewMail(get(selectedFolder)).newEMailFrom();
    mail.to.add(recipient);
    mailMustangApp.writeMail(mail);
  }

  static newMeeting(calendar: Calendar | null = null) {
    let start = new Date();
    start.setHours(start.getHours() + 1, 0, 0, 0);
    CalendarActions.newEvent(calendar, start, null, "meeting");
  }

  static newContact() {
    let addressbook = appGlobal.addressbooks.first;
    assert(addressbook, gt`Please add an addressbook first`);
    let person = addressbook.newPerson();
    person.name = "";
    person.addressbook = addressbook;
    newPerson.set(person);
    // <copied from="../../frontend/AppsBar/AppMenuM/Apps/ContactsAppMenu.svelte">
    goTo(URLPart`/contacts/person/${person.id}/edit`, { person });
    // </copied>
  }

  static async respond(original: EMail, draft: EMail) {
    if (MessageActions.respondsInline(original)) {
      await startInlineReply(original, draft);
    } else {
      mailMustangApp.writeMail(draft);
    }
  }

  static respondsInline(original: EMail): boolean {
    return !getLocalStorage<boolean>("lookout.mail.compose.repliesInNewWindow", false).value &&
      getLocalStorage<ReadingPanePosition>("lookout.mail.readingPane", "right").value != "off" &&
      get(selectedApp) == mailMustangApp &&
      get(selectedMessage) == original &&
      (get(selectedMessages)?.length ?? 0) <= 1;
  }

  static popOut(draft: EMail) {
    removeInlineReply(draft);
    mailMustangApp.writeMail(draft);
  }

  static async forward(message: EMail, event?: MouseEvent | KeyboardEvent) {
    // <copied from="../../frontend/Mail/Message/MessageMenu.svelte">
    let setting = getLocalStorage("mail.send.forward", "inline").value;
    let shift = !!event?.shiftKey;
    let forward: EMail;
    if (setting == "attachment" && !shift || setting == "inline" && shift) {
      forward = await message.compose.forwardAsAttachment();
    } else {
      forward = await message.compose.forwardInline();
    }
    // </copied>
    await MessageActions.respond(message, forward);
  }

  static async openDraft(message: EMail) {
    if (!(message.isDraft || message.folder?.specialFolder == SpecialFolder.Drafts)) {
      return;
    }
    // <copied from="../../frontend/Mail/Message/MessageToolbar.svelte" editDraft()>
    await message.loadMIME();
    mailMustangApp.writeMail(message);
    // </copied>
  }

  static async deletePermanently(messages: EMail[]) {
    if (!messages.length) {
      return;
    }
    let question = messages.length == 1
      ? gt`Do you want to permanently delete the selected message?`
      : gt`Do you want to permanently delete the ${messages.length} selected messages?`;
    if (!await showMessageBox(gt`Delete`, question)) {
      return;
    }
    await Promise.all(messages.map(message => message.deleteMessage(DeleteStrategy.DeleteImmediately)));
  }

  static async archive(messages: EMail[]) {
    for (let message of messages) {
      await message.moveToArchive(); // one by one: the first one may create the Archive folder
    }
  }

  static isJunk(messages: EMail[]): boolean {
    return messages.length > 0 && messages.every(message =>
      message.isSpam || message.folder?.specialFolder == SpecialFolder.Spam);
  }

  static async toggleTag(messages: EMail[], tag: Tag) {
    let haveAll = messages.every(message => message.tags.contains(tag));
    await Promise.all(messages.map(message => haveAll
      ? message.removeTag(tag)
      : message.addTag(tag)));
  }

  static async clearTags(messages: EMail[]) {
    for (let message of messages) {
      for (let tag of message.tags.contents) {
        await message.removeTag(tag);
      }
    }
  }

  static async moveTo(messages: EMail[], folder: Folder) {
    if (!messages.length) {
      return;
    }
    recentFolders.add(folder);
    for (let fromSameFolder of MessageActions.bySourceFolder(messages)) {
      await folder.moveMessagesHere(new ArrayColl(fromSameFolder));
    }
  }

  static async copyTo(messages: EMail[], folder: Folder) {
    if (!messages.length) {
      return;
    }
    recentFolders.add(folder);
    for (let fromSameFolder of MessageActions.bySourceFolder(messages)) {
      await folder.copyMessagesHere(new ArrayColl(fromSameFolder));
    }
  }

  static bySourceFolder(messages: EMail[]): EMail[][] {
    let byFolder = new Map<Folder, EMail[]>();
    for (let message of messages) {
      let list = byFolder.get(message.folder) ?? [];
      list.push(message);
      byFolder.set(message.folder, list);
    }
    return [...byFolder.values()];
  }

  // <copied from="../../frontend/Mail/Message/drag.ts">
  static async dropMessages(event: DragEvent, folder: Folder) {
    event.preventDefault();
    let message = get(selectedMessage);
    let msgIDsStr = event.dataTransfer.getData("message/drag-ids");
    if (!message || !msgIDsStr) {
      return;
    }
    let msgIDs = msgIDsStr.split(",");
    let messages = get(selectedMessages).contents;
    if (msgIDs.length == 0) {
      return;
    } else if (msgIDs.length == 1) {
      assert(msgIDs[0] == message.id, gt`Drag&drop failed: Selected message ID doesn't match the drag data`);
      messages = [ message ];
    } else {
      assert(messages.every(msg => msgIDs.includes(msg.id)), gt`Drag&drop failed: Selected message IDs don't match the drag data`);
    }
    if (event.ctrlKey || event.metaKey) {
      await MessageActions.copyTo(messages, folder);
    } else {
      await MessageActions.moveTo(messages, folder);
    }
  }
  // </copied>

  static async saveAs(message: EMail) {
    // <copied from="../../frontend/Mail/Message/MessageMenu.svelte">
    await message.loadMIME();
    let content = message.mime as Uint8Array<ArrayBuffer>;
    let filename = sanitize.filename(message.subject, "email") + ".eml";
    let file = new File([content], filename, { type: "message/rfc822" });
    await saveBlobAsFile(file);
    // </copied>
  }

  static senderPerson(message: EMail): Person | null {
    let contact = message?.outgoing ? null : message?.from?.findPerson();
    return contact instanceof Person ? contact : null;
  }

  static async sendReceiveAll() {
    await Promise.all(appGlobal.emailAccounts.contents.map(account =>
      MessageActions.getNewMail(account.inbox)));
  }

  static disableGetNewMail(folder: Folder | null): string | false {
    if (!folder) {
      return gt`Select a folder first`;
    }
    if (folder instanceof SavedSearchFolder) {
      return gt`A search folder shows messages of other folders. Update those folders instead.`;
    }
    return false;
  }

  static async getNewMail(folder: Folder | null) {
    if (!folder) {
      return;
    }
    let disabled = MessageActions.disableGetNewMail(folder);
    assert(!disabled, disabled as string);
    updatingFolders.add(folder);
    try {
      // <copied from="../../frontend/Mail/LeftPane/FolderMenu.svelte">
      let account = folder.account;
      if (!account.isLoggedIn) {
        await account.loginAndStartup(true);
      }
      await folder.getNewMessages();
      // </copied>
    } finally {
      updatingFolders.remove(folder);
    }
  }

  static async downloadAll(folder: Folder) {
    // <copied from="../../frontend/Mail/LeftPane/FolderMenu.svelte">
    await folder.listMessages();
    await folder.downloadAllMessages();
    // </copied>
  }

}
