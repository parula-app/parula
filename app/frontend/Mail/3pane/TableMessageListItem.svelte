<!-- If you change the columns here, also change the `FastList.columns` in TableMessageList.svelte -->
<hbox class="direction" style="--account-color: {$message.folder.account.color}" class:read={$message.isRead}
  on:contextmenu={contextMenu.onContextMenu}
  >
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
  {:else}
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
  {/if}
</hbox>
<hbox class="attachment" on:contextmenu={contextMenu.onContextMenu}>
  {#if $message.hasVisibleAttachments}
    <AttachmentIcon size="12px" />
  {/if}
</hbox>
<hbox class="correspondent"
  class:unread={!$message.isRead}
  draggable="true"
  on:dragstart={(event) => catchErrors(() => onDragStartMail(event, message))}
  on:contextmenu={contextMenu.onContextMenu}
  >{contactName}</hbox>
<hbox class="subject-tags" on:contextmenu={contextMenu.onContextMenu}>
  <hbox class="subject"
    class:unread={!$message.isRead}
    draggable="true"
    on:dragstart={(event) => catchErrors(() => onDragStartMail(event, message))}
    >{$message.subject}</hbox>
  <hbox flex />
  <hbox class="tags" class:tagged={$tags.hasItems}>
    {#if $tags.hasItems}
      <TagSelector tags={$tags} object={message} canAdd={false} />
    {/if}
  </hbox>
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
</hbox>
<hbox class="date"
  class:unread={!$message.isRead}
  draggable="true"
  on:dragstart={(event) => catchErrors(() => onDragStartMail(event, message))}
  on:contextmenu={contextMenu.onContextMenu}
  >{getDateTimeString($message.sent)}</hbox>
<hbox class="buttons hover" on:contextmenu={contextMenu.onContextMenu}>
  <hbox class="move button" bind:this={popupAnchor}>
    <Button
      icon={FolderActionsIcon}
      iconSize="16px"
      iconOnly
      label={$t`Move to folder, or add tag`}
      onClick={onPopupToggle}
      plain
      />
  </hbox>
  {#key message}
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
  {/key}
</hbox>

<ContextMenu bind:this={contextMenu}>
  <MessageMenu {message} />
</ContextMenu>
<Popup bind:popupOpen {popupAnchor} placement="bottom" boundaryElSel=".message-list-pane">
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
  import { selectedMessages } from "../Selected";
  import MessageMenu from "../Message/MessageMenu.svelte";
  import MessageMovePopup from "../Message/MessageMovePopup.svelte";
  import TagSelector from "../../Shared/Tag/TagSelector.svelte";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import Popup from "../../Shared/Popup.svelte";
  import Button from "../../Shared/Button.svelte";
  import OutgoingIcon from "lucide-svelte/icons/arrow-big-left";
  import SendingIcon from "lucide-svelte/icons/send";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ForwardIcon from "lucide-svelte/icons/forward";
  import ImportantIcon from "lucide-svelte/icons/circle-alert";
  import StarIcon from "lucide-svelte/icons/star";
  import CircleIcon from "lucide-svelte/icons/circle";
  import AttachmentIcon from "lucide-svelte/icons/paperclip";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import SpamIcon from "lucide-svelte/icons/shield-x";
  import NotSpamIcon from "lucide-svelte/icons/shield-off";
  import FolderActionsIcon from "lucide-svelte/icons/folder-dot";
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
  .direction:before {
    content: "";
    top: 10%;
    height: 80%;
    border-left: 3px solid var(--account-color);
    border-radius: 10px;
    margin-inline-end: 2px;
    opacity: 80%;
  }
  .correspondent,
  .subject,
  .date {
    align-self: center;
    white-space: nowrap;
    font-weight: 300;
    height: 100%;
  }
  .subject {
    overflow: hidden;
    /* Avoid cutting off within a word
    white-space: wrap;
    height: 1.3em; */
    margin-inline-start: 6px;
  }
  .date {
    justify-content: start;
    min-width: 8em;
    font-size: 12px !important;
    font-family: Helvetica, Arial, Constr-Klingon, sans-serif;
    height: 19px; /* make up for smaller font size, minus padding (below), when selected */
    max-height: 19px;
    padding-block-start: 2px; /* vertical center */
  }
  .date,
  .buttons.hover {
    padding-inline-end: 16px;
  }
  .tags:not(.tagged) {
    padding: 0px;
  }
  .correspondent.unread,
  .subject.unread,
  .date.unread {
    font-weight: bold;
  }
  .buttons.hover {
    justify-content: start;
  }
  :global(.row:not(:hover)) .buttons.hover {
    display: none;
  }
  :global(.row:hover) .date {
    display: none;
  }
  .button {
    width: 16px;
    padding: 0px 4px 0px 0px;
    align-items: center;
  }
  .attachment {
    width: 16px;
    padding: 4px 0px 0px 2px;
  }
  .direction {
    padding: 0px;
  }

  /* <copied to="VerticalMessageListItem.svelte"> */
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
  :global(.row.selected) .direction :global(svg.reply),
  :global(.row.selected) .direction :global(svg.forward),
  :global(.row.selected) .direction :global(svg.sending),
  :global(.row.selected) .direction :global(svg.important) {
    color: var(--selected-fg);
  }
  .star :global(svg) {
    stroke-width: 1px;
  }
  .direction {
    padding-inline-start: 8px;
  }
  .direction :global(.outgoing) {
    margin-inline-start: 0px;
    transform: translateX(3px);
  }
  .unread-dot {
    height: 100%;
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
</style>
