<hbox class="buttons">
  {#key message} <!-- Rebuild per mail, otherwise the spinner from the previous mail stays. -->
  {#if message.isDraft || message.folder?.specialFolder == SpecialFolder.Drafts }
    <hbox class="draft">
      <Button
        icon={WriteIcon}
        iconSize={$appGlobal.isSmall ? "32px" : "24px" }
        iconOnly={$appGlobal.isSmall}
        label={$t`Edit draft`}
        onClick={editDraft}
        classes="primary"
        />
    </hbox>
  {/if}
  <hbox class="reply">
    <Button
      icon={ReplyIcon}
      iconSize="22px"
      iconOnly
      label={$t`Reply to author`}
      onClick={reply}
      plain
      />
  </hbox>
  {#if recipients.length > 1 && (message.bcc.isEmpty || message.outgoing)}
    <hbox class="reply-all">
      <Button
        icon={ReplyAllIcon}
        iconSize="22px"
        iconOnly
        label={$t`Reply to all`}
        onClick={replyAll}
        plain
        />
    </hbox>
  {/if}
  <hbox class="trash">
    <Button
      icon={TrashIcon}
      iconSize="16px"
      iconOnly
      label={$t`Delete this message`}
      onClick={deleteMessage}
      disabled={!message}
      plain
      />
  </hbox>
  <hbox class="spam" class:notspam={$message.isSpam}>
    <Button
      icon={$message.isSpam ? NotSpamIcon : SpamIcon}
      iconSize="16px"
      iconOnly
      label={$message.isSpam ? $t`This email is *not* spam` : $t`Treat this email as spam: Move it to the Spam folder, and train the spam filter`}
      onClick={toggleSpam}
      disabled={!message}
      plain
      />
  </hbox>
  <hbox class="unread" class:read={$message.isRead}>
    <Button
      icon={CircleIcon}
      iconSize={$appGlobal.isSmall ? "20px" : "16px" }
      iconOnly
      label={$message.isRead ? $t`Mark this message as unread` : $t`Mark this message as read`}
      onClick={toggleRead}
      plain
      />
  </hbox>
  <hbox class="star" class:starred={$message.isStarred}>
    <Button
      icon={StarIcon}
      iconSize={$appGlobal.isSmall ? "28px" : "18px" }
      iconOnly
      label={$t`Remember this message`}
      onClick={toggleStar}
      plain
      />
  </hbox>
  {/key}
  <hbox class="move button" bind:this={popupAnchorE}>
    <Button
      icon={FolderActionsIcon}
      iconSize="16px"
      iconOnly
      label={$t`Move to folder, or add tag`}
      onClick={onPopupToggle}
      plain
      />
  </hbox>
  <hbox class="menu button">
    <ButtonMenu bind:isMenuOpen>
      <MessageMenu {message} {printE} />
    </ButtonMenu>
  </hbox>
</hbox>
<Popup bind:popupOpen popupAnchor={popupAnchorE} placement="bottom" boundaryElSel=".message-list-pane">
  <MessageMovePopup messages={new ArrayColl([message])} on:close={onPopupClose} />
</Popup>

<Print {message} bind:this={printE} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { mailMustangApp } from "../MailMustangApp";
  import { SpecialFolder } from "../../../logic/Mail/Folder";
  import MessageMenu from "./MessageMenu.svelte";
  import MessageMovePopup from "../Message/MessageMovePopup.svelte";
  import Print from "./MessagePrint.svelte";
  import ButtonMenu from "../../Shared/Menu/ButtonMenu.svelte";
  import Popup from "../../Shared/Popup.svelte";
  import Button from "../../Shared/Button.svelte";
  import StarIcon from "lucide-svelte/icons/star";
  import CircleIcon from "lucide-svelte/icons/circle";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ReplyAllIcon from "lucide-svelte/icons/reply-all";
  import TrashIcon from "lucide-svelte/icons/trash-2";
  import SpamIcon from "lucide-svelte/icons/shield-x";
  import NotSpamIcon from "lucide-svelte/icons/shield-off";
  import WriteIcon from "lucide-svelte/icons/pencil";
  import FolderActionsIcon from "lucide-svelte/icons/folder-dot";
  import { ArrayColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";
  import { appGlobal } from "../../../logic/app";

  export let message: EMail;

  /* <copied to="MailChatToolbar.svelte" /> */
  $: recipients = message.allRecipients();

  async function toggleRead() {
    await message.markRead(!message.isRead);
  }
  async function toggleStar() {
    await message.markStarred(!message.isStarred);
  }
  function reply() {
    let reply = message.compose.replyToAuthor();
    mailMustangApp.writeMail(reply);
  }
  function replyAll() {
    let reply = message.compose.replyAll();
    mailMustangApp.writeMail(reply);
  }
  async function deleteMessage() {
    await message.deleteMessage();
  }
  async function toggleSpam() {
    await message.treatSpam(!message.isSpam);
  }
  async function editDraft() {
    await message.compose.editDraft();
    mailMustangApp.writeMail(message);
  }

  let isMenuOpen = false;
  let printE: Print;

  // Folder Popup
  let popupAnchorE: HTMLElement;
  let popupOpen = false;
  function onPopupToggle(event) {
    popupOpen = !popupOpen;
  }
  function onPopupClose() {
    popupOpen = false;
  }
</script>

<style>
  .buttons {
    justify-content: end;
    margin-block-end: 8px;
  }
  .buttons > * {
    margin-inline-start: 2px;
  }
  .buttons :global(svg) {
    stroke-width: 1.3px;
  }
  .star.starred :global(svg) {
    fill: orange;
  }
  .unread:not(.read) :global(svg) {
    fill: green;
  }
  hbox.draft {
    margin-right: 32px;
  }
  @media (max-width: 600px)  {
    .reply, .reply-all, .spam, .trash, .move, .menu {
      display: none;
    }
  }
</style>
