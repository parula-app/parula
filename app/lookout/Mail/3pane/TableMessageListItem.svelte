<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="message-row"
  class:unread={!$message.isRead}
  class:selected={isSelected}
  class:flagged={$message.isStarred}
  class:deleted={$message.isDeleted}
  class:thread-child={isThreadChild}
  class:with-preview={previewLines > 0}
  style:--thread-indent={indent * 16 + "px"}
  role="option"
  tabindex="-1"
  aria-selected={isSelected}
  draggable="true"
  on:dragstart={event => catchErrors(() => onDragStartMail(event, message))}
  on:click
  on:dblclick
  on:contextmenu
  on:contextmenu={onContextMenu}
  >
  <div class="cells">
    {#each columns as column (column)}
      <div class="cell {column}" class:icon-cell={ColumnInfo.of(column)?.isIcon}>
        {#if column == Column.Importance}
          {#if $message.isImportant}
            <span title={$t`High importance`}><ImportantIcon size={14} class="important" /></span>
          {/if}
        {:else if column == Column.Icon}
          {#if threadSize > 1}
            <button class="thread-expander" tabindex="-1"
              title={isThreadExpanded ? $t`Collapse the conversation` : $t`Expand the conversation`}
              aria-expanded={isThreadExpanded}
              on:click|stopPropagation={() => dispatch("toggleThread")}>
              <ChevronIcon size={14} class="chevron {isThreadExpanded ? 'expanded' : ''}" />
            </button>
          {:else}
            <span title={stateLabel}><svelte:component this={stateIcon} size={14} /></span>
          {/if}
        {:else if column == Column.Attachment}
          {#if $message.hasVisibleAttachments}
            <span title={$t`Has attachments`}><AttachmentIcon size={14} /></span>
          {/if}
        {:else if column == Column.From}
          <span class="text sender" title={senderTooltip}>{senderName}</span>
          {#if threadSize > 1}
            <span class="thread-size" title={$t`${threadSize} messages in this conversation`}>{threadSize}</span>
          {/if}
        {:else if column == Column.To}
          <span class="text" title={recipients}>{recipients}</span>
        {:else if column == Column.Subject}
          {#if isDraft || hasInlineReply}
            <span class="draft">{$t`[Draft] *=> Marks an email that has not been sent yet`}</span>
          {/if}
          <span class="text subject" title={$message.subject}>
            {#if $message.subject}
              {#each highlightParts($message.subject, highlight) as part}{#if part.isMatch}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}
            {:else}
              {$t`(no subject)`}
            {/if}
          </span>
        {:else if column == Column.Received}
          <span class="text date" title={getFullDateString($message.received ?? $message.sent)}>{getListDateString($message.received ?? $message.sent)}</span>
        {:else if column == Column.Sent}
          <span class="text date" title={getFullDateString($message.sent)}>{getListDateString($message.sent)}</span>
        {:else if column == Column.Size}
          <span class="text size">{$message.size ? fileSize($message.size) : ""}</span>
        {:else if column == Column.Categories}
          <hbox class="categories">
            {#each $tags as tag (tag)}
              <span class="category-square" style="--category-color: {tag.color};" title={tag.name}></span>
            {/each}
            {#if $tags.length == 1}
              <span class="text category-name">{$tags[0].name}</span>
            {/if}
          </hbox>
        {:else if column == Column.Flag}
          <button class="flag-button" tabindex="-1" class:set={$message.isStarred}
            title={$message.isStarred ? $t`Clear Flag` : $t`Flag this message`}
            on:click|stopPropagation={() => catchErrors(() => message.markStarred(!message.isStarred))}>
            <FlagIcon size={14} />
          </button>
        {:else if column == Column.Folder}
          <span class="text" title={folderName}>{folderName ?? ""}</span>
        {/if}
      </div>
    {/each}
  </div>
  {#if previewLines > 0}
    <div class="preview" style="-webkit-line-clamp: {previewLines}; padding-inline-start: {previewIndent}px;">
      {#each highlightParts(preview, highlight) as part}{#if part.isMatch}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}
    </div>
  {/if}
</div>
<ContextMenu bind:this={contextMenu}>
  <MessageMenu messages={menuMessages} />
</ContextMenu>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { personDisplayName } from "../../../logic/Abstract/PersonUID";
  import { onDragStartMail } from "../../../frontend/Mail/Message/drag";
  import { fileSize } from "../../../frontend/Files/file";
  import { Column, ColumnInfo } from "../ViewSettings/ViewSettings";
  import { derived } from "svelte/store";
  import { inlineReplies } from "../Selected";
  import { getListDateString, getFullDateString } from "./MessageDates";
  import { highlightParts } from "./TextHighlight";
  import ReadIcon from "lucide-svelte/icons/mail-open";
  import UnreadIcon from "lucide-svelte/icons/mail";
  import FlagIcon from "lucide-svelte/icons/flag";
  import ImportantIcon from "lucide-svelte/icons/circle-alert";
  import MeetingIcon from "lucide-svelte/icons/calendar-days";
  import AttachmentIcon from "lucide-svelte/icons/paperclip";
  import RepliedIcon from "lucide-svelte/icons/reply";
  import ForwardedIcon from "lucide-svelte/icons/forward";
  import DraftIcon from "lucide-svelte/icons/square-pen";
  import ChevronIcon from "lucide-svelte/icons/chevron-right";
  import { catchErrors } from "../../../frontend/Util/error";
  import { selectedMessages } from "../../../frontend/Mail/Selected";
  import MessageMenu from "../Message/MessageMenu.svelte";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import { ArrayColl, type Collection } from "svelte-collections";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";
  import { SpecialFolder } from "../../../logic/Mail/Folder";
  import { FolderTreeActions } from "../LeftPane/FolderTreeActions";

  export let message: EMail;
  export let columns: Column[];
  export let isSelected = false;
  export let previewLines = 0;
  export let previewIndent = 0;
  export let threadSize = 0;
  export let isThreadExpanded = false;
  export let isThreadChild = false;
  export let indent = 0;
  export let highlight: string | null = null;

  const dispatch = createEventDispatcher<{ toggleThread: void }>();

  $: folderName = message.folder ? FolderTreeActions.displayName(message.folder) : null;
  $: messageTags = message.tags;
  $: tags = derived($messageTags.contents, () => messageTags.contents);
  $: to = message.to;
  /* <copied to="../Vertical/VerticalMessageListItem.svelte, TableMessageList.svelte"> */
  $: showsRecipient = [SpecialFolder.Sent, SpecialFolder.Drafts, SpecialFolder.Outbox].includes(message.folder?.specialFolder);
  $: senderName = $message && (personDisplayName(showsRecipient ? message.contact : message.from) || message.from?.emailAddress || "");
  /* </copied> */
  $: senderTooltip = showsRecipient
    ? $t`To: ${senderName}`
    : $message.from?.emailAddress ?? "";
  $: recipients = $to.contents.map(person => personDisplayName(person) || person.emailAddress).join("; ");
  $: isDraft = $message && (message.isDraft || message.folder?.specialFolder == SpecialFolder.Drafts);
  $: hasInlineReply = $inlineReplies.some(reply => reply.original == message);
  $: preview = previewLines > 0 ? ($message.text ?? "").replace(/\s+/g, " ").trim().substring(0, 400) : "";
  $: stateIcon = isDraft ? DraftIcon
    : $message.invitationMessage ? MeetingIcon
    : $message.isForwarded ? ForwardedIcon
    : $message.isReplied ? RepliedIcon
    : $message.isRead ? ReadIcon : UnreadIcon;
  $: stateLabel = isDraft ? $t`Draft *=> State of the email that has not been sent yet`
    : $message.invitationMessage ? $t`Meeting request`
    : $message.isForwarded ? $t`Forwarded *=> State of the email that has been forwarded`
    : $message.isReplied ? $t`Replied *=> State of the email that has been replied to`
    : $message.isRead ? $t`Read *=> State of the message that has been read` : $t`Unread *=> State of the message that has not been read`;

  // <copied to="../Vertical/VerticalMessageListItem.svelte">
  let contextMenu: ContextMenu;
  let menuMessages: Collection<EMail> = new ArrayColl<EMail>();
  function onContextMenu(event: MouseEvent) {
    menuMessages = new ArrayColl($selectedMessages?.contains(message) ? $selectedMessages.contents : [message]);
    contextMenu.onContextMenu(event);
  }
  // </copied>
</script>

<style>
  .message-row {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    height: 100%;
    box-sizing: border-box;
    padding-inline: 8px 4px;
    border-bottom: 1px solid var(--lo-divider);
    color: var(--lo-fg);
    font-size: 13px;
    cursor: default;
    user-select: none;
    overflow: hidden;
  }
  .message-row:hover {
    background-color: var(--lo-hover-bg);
  }
  .message-row.selected {
    background-color: var(--lo-selected-bg);
  }
  .message-row.selected:hover {
    background-color: var(--lo-selected-hover-bg);
  }
  .message-row.unread::before,
  .message-row.selected::before {
    content: "";
    position: absolute;
    inset-inline-start: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background-color: var(--lo-accent);
  }
  .message-row.deleted {
    opacity: 0.5;
  }
  .cells {
    display: grid;
    grid-template-columns: var(--message-columns);
    align-items: center;
    min-width: 0;
    height: var(--message-line-height, 26px);
  }
  .cell {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding-inline: 4px;
    overflow: hidden;
    white-space: nowrap;
  }
  .icon-cell {
    justify-content: center;
    padding-inline: 0;
    color: var(--lo-fg-secondary);
  }
  .icon-cell span {
    display: flex;
  }
  .text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .unread .sender,
  .unread .subject {
    font-weight: 600;
  }
  .unread .subject {
    color: var(--lo-accent-text);
  }
  .thread-child .cell.subject,
  .thread-child .cell.from {
    padding-inline-start: calc(4px + var(--thread-indent));
  }
  .date,
  .size {
    color: var(--lo-fg-secondary);
  }
  .unread .date {
    color: var(--lo-accent-text);
  }
  .size {
    margin-inline-start: auto;
  }
  .draft {
    flex-shrink: 0;
    color: var(--lo-danger);
  }
  .cell :global(.important) {
    color: var(--lo-danger);
  }
  .thread-size {
    flex-shrink: 0;
    padding: 0 5px;
    border-radius: 8px;
    background-color: var(--lo-pressed-bg);
    color: var(--lo-fg-secondary);
    font-size: 11px;
    line-height: 16px;
  }
  .thread-expander,
  .flag-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
    cursor: pointer;
  }
  .thread-expander:hover,
  .flag-button:hover {
    background-color: var(--lo-pressed-bg);
  }
  .thread-expander :global(.chevron) {
    transition: transform 0.1s;
  }
  .thread-expander :global(.chevron.expanded) {
    transform: rotate(90deg);
  }
  .flag-button {
    visibility: hidden;
  }
  .message-row:hover .flag-button,
  .flag-button.set {
    visibility: visible;
  }
  .flag-button.set {
    color: var(--lo-danger);
  }
  .flag-button.set :global(svg) {
    fill: var(--lo-danger);
  }
  .categories {
    align-items: center;
    gap: 3px;
    min-width: 0;
  }
  .category-square {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    border-radius: 2px;
    background-color: var(--category-color);
    border: 1px solid color-mix(in srgb, var(--category-color) 70%, var(--lo-fg));
    box-sizing: border-box;
  }
  .category-name {
    font-size: 12px;
  }
  .preview {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    overflow: hidden;
    padding-inline-end: 8px;
    color: var(--lo-fg-secondary);
    font-size: 12px;
    line-height: 17px;
    white-space: normal;
    word-break: break-word;
  }
  .unread .preview {
    color: var(--lo-accent-text);
  }
  mark {
    border-radius: 2px;
    background-color: color-mix(in srgb, var(--lo-warning) 28%, transparent);
    color: inherit;
  }
</style>
