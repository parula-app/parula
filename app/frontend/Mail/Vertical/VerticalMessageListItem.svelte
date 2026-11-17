<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<vbox class="message"
  class:unread={!$message.isRead}
  draggable="true" on:dragstart={(event) => catchErrors(() => onDragStartMail(event, message))}
  style="--account-color: {$message.folder.account.color};"
  on:contextmenu={contextMenu.onContextMenu}
  on:click
  on:swiperight={() => catchErrors(deleteMessage)}
  on:swipeleft={() => catchErrors(markAsSpam)}
  bind:this={popupAnchor}
  >
  <hbox class="top-row">
    <hbox class="direction">
      {#if $message.isSending}
        <SendingIcon size={16} class="sending" />
      {:else if $message.outgoing}
        <OutgoingIcon size={16} class="outgoing" />
      {:else if $message.isReplied}
        <ReplyIcon size={16} class="reply" />
      {:else if $message.isForwarded}
        <ForwardIcon size={16} class="forward" />
      {:else if $message.isImportant}
        <ImportantIcon size={16} class="important" />
      {/if}
    </hbox>
    <hbox class="contact font-small">{contactName}</hbox>
    <hbox flex />
    {#if $tags.hasItems}
      <hbox class="tags">
        <TagSelector tags={$tags} object={message} canAdd={false} />
      </hbox>
    {/if}
    <hbox class="date font-smallest">{getDateTimeString($message.sent)}</hbox>
    <hbox class="unread-dot button" class:unread={!$message.isRead}>
      {#key message} <!-- Rebuild per mail, otherwise the spinner from the previous mail stays. -->
      <Button
        icon={CircleIcon}
        iconSize="7px"
        iconOnly
        label={$message.isRead ? $t`Mark this message as unread` : $t`Mark this message as read`}
        onClick={toggleRead}
        plain
        />
      {/key}
    </hbox>
    <!--
    <hbox class="buttons hover">
      <hbox class="spam button">
        <Button
          icon={$message.isSpam ? NotSpamIcon : SpamIcon}
          iconSize="16px"
          iconOnly
          label={$message.isSpam ? $t`Mark as not spam` : $t`Mark as spam`}
          tooltip={$message.isSpam ? $t`This email is *not* spam` : $t`Treat this email as spam: Move it to the Spam folder, and train the spam filter`}
          onClick={toggleSpam}
          plain
          />
      </hbox>
      <hbox class="delete button">
        <Button
          icon={DeleteIcon}
          iconSize="16px"
          iconOnly
          label={$t`Delete this message`}
          onClick={deleteMessage}
          plain
          />
      </hbox>
    </hbox>
    -->
  </hbox>
  <hbox class="bottom-row">
    <hbox class="subject font-small">{$message.subject}</hbox>
    <hbox flex />
    {#if !isMobile}
      <hbox class="move button">
        <Button
          icon={FolderActionsIcon}
          iconSize="16px"
          iconOnly
          label={$t`Move, tag, or delete`}
          onClick={onPopupToggle}
          plain
          />
      </hbox>
    {/if}
    <hbox class="star button" class:starred={$message.isStarred}>
      {#key message}
      <Button
        icon={StarIcon}
        iconSize="16px"
        iconOnly
        label={$t`Remember this message`}
        onClick={toggleStar}
        plain
        />
      {/key}
    </hbox>
    <hbox class="attachments">
      {#if $message.hasVisibleAttachments}
        <AttachmentIcon size="14px" />
      {/if}
    </hbox>
  </hbox>
</vbox>
<ContextMenu bind:this={contextMenu}>
  <MessageMenu {message} />
</ContextMenu>
<Popup bind:popupOpen {popupAnchor} placement="bottom-end" boundaryElSel=".message-list-pane">
  {#if $selectedMessages.length > 1 && $selectedMessages.contains(message)}
    <MessageMovePopup messages={new ArrayColl($selectedMessages)} on:close={onPopupClose} />
  {:else}
    <MessageMovePopup messages={new ArrayColl([message])} on:close={onPopupClose} />
  {/if}
</Popup>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { personDisplayName } from "../../../logic/Abstract/PersonUID";
  import { onDragStartMail } from "../Message/drag";
  import { selectedMessage, selectedMessages } from "../Selected";
  import TagSelector from "../../Shared/Tag/TagSelector.svelte";
  import MessageMenu from "../Message/MessageMenu.svelte";
  import MessageMovePopup from "../Message/MessageMovePopup.svelte";
  import Popup from "../../Shared/Popup.svelte";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import Button from "../../Shared/Button.svelte";
  import OutgoingIcon from "lucide-svelte/icons/arrow-big-left";
  import SendingIcon from "lucide-svelte/icons/send";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ForwardIcon from "lucide-svelte/icons/forward";
  import ImportantIcon from "lucide-svelte/icons/circle-alert";
  import StarIcon from "lucide-svelte/icons/star";
  import CircleIcon from "lucide-svelte/icons/circle";
  import AttachmentIcon from "lucide-svelte/icons/paperclip";
  import FolderActionsIcon from "lucide-svelte/icons/folder-dot";
  import { isMobile } from "../../../logic/build";
  import { getDateTimeString } from "../../../logic/util/date";
  import { catchErrors } from "../../Util/error";
  import { ArrayColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;

  $: tags = message.tags;
  $: contactName = personDisplayName($message.contact);

  async function toggleRead() {
    await message.markRead(!message.isRead);
  }
  async function toggleStar() {
    await message.markStarred(!message.isStarred);
  }
  async function toggleSpam() {
    await message.treatSpam(!message.isSpam);
  }
  async function markAsSpam() {
    await message.treatSpam(true);
  }
  async function deleteMessage() {
    await message.deleteMessage();
  }

  let contextMenu: ContextMenu;

  // Popup
  let popupAnchor: HTMLElement;
  let popupOpen = false;
  function onPopupToggle(event) {
    popupOpen = !popupOpen;
  }
  function onPopupClose() {
    popupOpen = false;
  }
</script>

<style>
  .message {
    padding: 4px 12px 4px 8px !important;
    justify-content: baseline;
    align-items: baseline;
    position: relative;
  }
  :global(.mobile) .message {
    padding: 8px 12px 8px 12px !important;
  }

  /* account color bar */
  .message::before {
    position: absolute;
    top: 18%;
    content: "";
    height: 64%;
    border-left: 3px solid var(--account-color);
    border-radius: 10px;
  }

  .top-row,
  .bottom-row {
    width: 100%;
    overflow: hidden;
    padding-inline-start: 14px;
  }
  .top-row {
    height: 1.5em;
  }
  .bottom-row {
    height: 1.3em;
  }
  .contact {
    font-weight: 500;
  }
  .subject,
  .date {
    font-weight: 300;
  }
  .unread .contact,
  .unread .subject,
  .unread .date {
    font-weight: 700;
  }
  .date {
    min-width: 8em;
    justify-content: end;
    font-family: Helvetica, Arial, Constr-Klingon, sans-serif;
    padding-top: 2px; /** HACK Fix vertical alignment */
  }
  .subject {
    line-height: 1.3;
  }
  .attachments {
    align-self: center;
    justify-self: center;
    opacity: 60%;
  }
  .star {
    margin-inline-end: 1px; /* for alignment with unread button */
  }
  .attachments :global(> *) {
    margin-inline-end: 3px; /* for alignment with unread button */
  }
  /*
  :global(.row:not(:hover)) .buttons.hover {
    display: none;
  }
  :global(.row:hover) .date {
    display: none;
  }
  */
  .button {
    width: 20px;
    vertical-align: bottom;
  }
  .direction > :global(*) {
    margin-inline-end: 4px;
  }

  /* <copied from="TableMessageListItem.svelte"> */
  .button:hover {
    background-color: var(--selected-hover-bg);
    color: var(--selected-hover-fg);
  }
  :global(.row.selected:hover) .button:hover {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .button :global(button) {
    background-color: unset !important;
    color: unset !important;
  }
  .direction {
    align-items: center;
  }
  .direction :global(svg.outgoing) {
    stroke-width: 1px;
  }
  .direction :global(svg.important) {
    color: crimson;
  }
  @media (prefers-color-scheme: light) {
    .direction :global(svg.outgoing) {
      color: darkred;
    }
    .direction :global(svg.reply),
    .direction :global(svg.forward),
    .direction :global(svg.sending) {
      color: grey;
    }
  }
  .direction :global(svg.reply),
  .direction :global(svg.forward),
  .direction :global(svg.sending) {
    stroke-width: 1px;
  }
  .direction :global(svg.sending) {
    animation: sending 1.5s linear infinite;
  }
  /* Flies away to the top right. The middle points sit above the straight
   * line, so that it climbs steeply first and then flattens out. */
  @keyframes sending {
    0% { opacity: 0%; transform: translate(-4px, 3px); animation-timing-function: ease-out; }
    20% { opacity: 100%; transform: translate(-2px, -1px); }
    80% { opacity: 100%; transform: translate(2px, -2px); animation-timing-function: ease-in; }
    100% { opacity: 0%; transform: translate(4px, -3px); }
  }
  :global(.row.selected) .direction :global(svg.reply),
  :global(.row.selected) .direction :global(svg.forward),
  :global(.row.selected) .direction :global(svg.sending),
  :global(.row.selected) .direction :global(svg.important) {
    color: var(--selected-fg);
  }
  .star :global(svg) {
    stroke-width: 1px;
  }
  .buttons.hover :global(svg),
  .unread-dot :global(svg) {
    stroke-width: 1.5px;
  }
  :global(.row:not(:hover)) .unread-dot :global(svg),
  :global(.row:not(:hover)) .star :global(svg) {
    stroke: none;
  }
  :global(.row:not(:hover)) .star:not(.starred) {
    display: none;
  }
  :global(.row:not(:hover)) .unread-dot:not(.unread) :global(svg) {
    display: none;
  }
  .star.starred :global(svg) {
    fill: orange;
  }
  .unread-dot.unread :global(svg) {
    fill: green;
  }
  .tags :global(.tag) {
    margin: 0 2px;
    min-height: unset;
    border: none;
  }
  /* </copied> */
  .tags {
    margin-inline-end: 8px;
  }
  .move.button {
    margin-inline-end: 8px;
  }
  .move.button :global(svg) {
    stroke-width: 1px;
  }
  :global(.row:not(:hover)) .move.button {
    display: none;
  }
</style>
