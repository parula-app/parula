<vbox class="message-popup">
  <hbox class="top buttons">
    <Button plain
      label={$t`Delete`}
      onClick={onDelete}
      icon={DeleteIcon}
      />
    <Button plain
      label={$messages.first.isSpam ? $t`Not spam` : $t`Spam`}
      tooltip={$messages.first.isSpam ? $t`Treat this email as *not* spam` : $t`Treat this email as spam: Move it to the Spam folder, and train the spam filter`}
      onClick={toggleSpam}
      icon={$messages.first.isSpam ? NotSpamIcon : SpamIcon}
      />
    <Button plain
      label={$t`Archive`}
      tooltip={$t`Move this email to the archive folder`}
      onClick={onArchive}
      icon={ArchiveIcon}
      iconOnly
      />
    <slot name="buttons" {messages} />
    <Button plain
      label={$t`Close`}
      onClick={onClose}
      iconOnly
      icon={CloseIcon}
      />
  </hbox>
  {#if !showAccounts}
    <vbox class="tags">
      <hbox class="header font-smallest">{$t`Tags`}</hbox>
      <TagSelector
        tags={availableTags}
        selectedTags={commonTags}
        {partialTags}
        on:select={event => catchErrors(() => onAddTag(event.detail))}
        on:unselect={event => catchErrors(() => onRemoveTag(event.detail))}
        />
    </vbox>
  {/if}
  {#if showAccounts}
    <vbox class="accounts">
      <AccountList accounts={appGlobal.emailAccounts} bind:selectedAccount />
    </vbox>
  {/if}
  <vbox class="folders">
    <FolderList folders={selectedAccount.rootFolders} bind:selectedFolder bind:selectedFolders>
      <svelte:fragment slot="buttons" let:folder>
        {#if folder != sourceFolder}
          <Button plain
            label={$t`Copy`}
            tooltip={$t`Copy this email to folder ${folder.name}`}
            onClick={() => onCopyTo(folder)}
            icon={CopyIcon}
            iconOnly
            />
          <Button plain
            label={$t`Move`}
            tooltip={$t`Move this email to folder ${folder.name}`}
            onClick={() => onMoveTo(folder)}
            icon={MoveIcon}
            />
        {/if}
      </svelte:fragment>
      <svelte:fragment slot="header">
        <hbox class="folders-header" flex>
          {$t`Folder`}
          <hbox flex />
          <Button
            label={$t`Move to other mail account`}
            icon={AccountsIcon}
            iconOnly
            plain
            selected={showAccounts}
            onClick={() => showAccounts = !showAccounts}
           />
        </hbox>
      </svelte:fragment>
    </FolderList>
  </vbox>
</vbox>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { Folder } from "../../../logic/Mail/Folder";
  import { selectedMessage } from "../Selected";
  import { availableTags, type Tag } from "../../../logic/Abstract/Tag";
  import { appGlobal } from "../../../logic/app";
  import TagSelector from "../../Shared/Tag/TagSelector.svelte";
  import AccountList from "../LeftPane/AccountList.svelte";
  import FolderList from "../LeftPane/FolderList.svelte";
  import Button from "../../Shared/Button.svelte";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import SpamIcon from "lucide-svelte/icons/shield-x";
  import NotSpamIcon from "lucide-svelte/icons/shield-off";
  import ArchiveIcon from "lucide-svelte/icons/archive";
  import MoveIcon from "lucide-svelte/icons/folder-input";
  import CopyIcon from "lucide-svelte/icons/mails";
  import AccountsIcon from "lucide-svelte/icons/share";
  import CloseIcon from "lucide-svelte/icons/x";
  import { catchErrors } from "../../Util/error";
  import { ArrayColl, Collection, SetColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher<{ close: void }>();

  /** Attention
   * Always pass in a copy of the array, not the live `selectedMessages` array from the UI.
   * If the user deletes or moves messages, they will be removed from the UI
   * instantly, which changes the current selection, so the wrong emails get deleted. */
  export let messages: Collection<EMail>;

  let sourceFolder = messages.first.folder;
  let selectedFolder = sourceFolder;
  let selectedFolders = new ArrayColl<Folder>();
  let selectedAccount = sourceFolder.account;
  /** The tags that all selected messages have */
  let commonTags = new SetColl<Tag>();
  /** The tags that only some of the selected messages have */
  let partialTags = new SetColl<Tag>();
  let selectedMessageIndex = sourceFolder.messages.getKeyForValue(messages.first);
  let wasSelected = $selectedMessage == messages.first; // just safety measure
  let showAccounts = false;
  $: messages, updateTagStates();

  function onClose() {
    dispatch("close");
  }

  async function onDelete() {
    onClose();
    for (let message of messages) {
      await message.deleteMessage();
    }
    goToNextMessage();
  }
  async function toggleSpam() {
    let spam = !messages.first.isSpam;
    onClose();
    for (let message of messages) {
      await message.treatSpam(spam);
    }
    goToNextMessage();
  }

  async function onArchive() {
    onClose();
    for (let message of messages) {
      await message.moveToArchive();
    }
    goToNextMessage();
  }
  async function onAddTag(tag: Tag) {
    for (let message of messages) {
      await message.addTag(tag);
    }
    updateTagStates();
  }
  async function onRemoveTag(tag: Tag) {
    for (let message of messages) {
      await message.removeTag(tag);
    }
    updateTagStates();
  }
  function updateTagStates() {
    commonTags.clear();
    partialTags.clear();
    for (let tag of availableTags) {
      let messagesWithTag = messages.filterOnce(message => message.tags.contains(tag));
      if (messagesWithTag.length == messages.length) {
        commonTags.add(tag);
      } else if (messagesWithTag.hasItems) {
        partialTags.add(tag);
      }
    }
  }

  async function onMoveTo(folder: Folder) {
    onClose();
    await folder.moveMessagesHere(messages);
    goToNextMessage();
  }
  async function onCopyTo(folder: Folder) {
    onClose();
    await folder.copyMessagesHere(messages);
  }

  function goToNextMessage() {
    if (!wasSelected) {
      return;
    }
    $selectedMessage =
      sourceFolder.messages.getIndex(selectedMessageIndex) ??
      sourceFolder.messages.first ??
      sourceFolder.account.inbox.messages.first ??
      null; // no message left: show the start page
  }
</script>

<style>
  .message-popup {
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
  }
  .message-popup :global(.header) {
    display: flex !important;
    height: unset !important;
  }
  .header {
    color: grey;
  }
  .header,
  .message-popup :global(grid > .header) {
    margin-block-start: 0px;
    margin-block-end: 4px;
  }
  .tags {
    margin: 10px;
    max-width: 300px;
  }
  .accounts {
    height: 10em;
  }
  .accounts :global(.account-list) {
    flex: 1;
  }
  .folders {
    height: 22em;
  }
  .buttons {
    border-top: 1px solid var(--border);
  }
  .buttons > :global(button:not(:first-child)) {
    border-left: 1px solid var(--border);
  }
  .buttons > :global(button) {
    padding: 8px 16px;
    border-radius: 0px;
  }
  /* TODO fix colors on hover
  .buttons > :global(.selected button:hover:not(.disabled)) {
    background-color: unset;
    color: green;
  }*/
</style>
