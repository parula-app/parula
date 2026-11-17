<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="message-item"
  class:unread={!$message.isRead}
  class:selected={isSelected}
  class:flagged={$message.isStarred}
  class:deleted={$message.isDeleted}
  class:thread-child={isThreadChild}
  class:tighter={tighterSpacing}
  class:subject-first={!sendersAboveSubject}
  style:padding-inline-start={indent ? 16 + 24 * indent + "px" : null}
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
  <hbox class="line first-line">
    {#if threadSize > 1}
      <button class="thread-expander" tabindex="-1"
        title={isThreadExpanded ? $t`Collapse the conversation` : $t`Expand the conversation`}
        aria-expanded={isThreadExpanded}
        on:click|stopPropagation={() => dispatch("toggleThread")}>
        <ChevronIcon size={14} class="chevron {isThreadExpanded ? 'expanded' : ''}" />
      </button>
    {/if}
    <span class="sender" title={senderTooltip}>{senderName}</span>
    {#if threadSize > 1}
      <span class="thread-size" title={$t`${threadSize} messages in this conversation`}>{threadSize}</span>
    {/if}
    <hbox flex />
    {#if $tags.length}
      <hbox class="categories">
        {#each $tags as tag (tag)}
          {#if $ribbonLayout.value == "simplified"}
            <span class="category" style="--category-color: {tag.color};" title={tag.name}>{tag.name}</span>
          {:else}
            <span class="category-square" style="--category-color: {tag.color};" title={tag.name}></span>
          {/if}
        {/each}
      </hbox>
    {/if}
    <hbox class="hover-actions">
      <button class="action" tabindex="-1"
        title={$message.isRead ? $t`Mark as Unread` : $t`Mark as Read`}
        on:click|stopPropagation={() => catchErrors(() => message.markRead(!message.isRead))}>
        {#if $message.isRead}
          <UnreadIcon size={16} />
        {:else}
          <ReadIcon size={16} />
        {/if}
      </button>
      <button class="action flag-action" tabindex="-1"
        title={$message.isStarred ? $t`Clear Flag` : $t`Flag this message`}
        on:click|stopPropagation={() => catchErrors(() => message.markStarred(!message.isStarred))}>
        <FlagIcon size={16} />
      </button>
      <button class="action" tabindex="-1"
        title={$t`Delete`}
        on:click|stopPropagation={() => catchErrors(() => message.deleteMessage())}>
        <DeleteIcon size={16} />
      </button>
    </hbox>
  </hbox>
  <hbox class="line second-line">
    {#if isDraft || hasInlineReply}
      <span class="draft">{$t`[Draft] *=> Marks an email that has not been sent yet`}</span>
    {/if}
    <span class="subject" title={$message.subject}>
      {#if $message.subject}
        {#each highlightParts($message.subject, highlight) as part}{#if part.isMatch}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}
      {:else}
        {$t`(no subject)`}
      {/if}
    </span>
    <hbox flex />
    <hbox class="status-icons">
      {#if $message.isSending}
        <span title={$t`Sending… *=> The email is being sent`}><SendingIcon size={14} class="sending" /></span>
      {/if}
      {#if $message.isImportant}
        <span title={$t`High importance`}><ImportantIcon size={14} class="important" /></span>
      {/if}
      {#if $message.invitationMessage}
        <span title={$t`Meeting request`}><MeetingIcon size={14} /></span>
      {/if}
      {#if $message.wasEncrypted || $message.signedByKeyID}
        <span title={$message.wasEncrypted ? $t`Encrypted *=> The email was sent encrypted` : $t`Signed`}><SecureIcon size={14} /></span>
      {/if}
      {#if $message.hasVisibleAttachments}
        <span title={$t`Has attachments`}><AttachmentIcon size={14} /></span>
      {/if}
      {#if $message.isForwarded}
        <span title={$t`You forwarded this message`}><ForwardedIcon size={14} class="forwarded" /></span>
      {:else if $message.isReplied}
        <span title={$t`You replied to this message`}><RepliedIcon size={14} class="replied" /></span>
      {/if}
      {#if $message.isStarred}
        <span title={$t`Flagged *=> State of the email that has been flagged for follow-up`}><FlagIcon size={14} class="flag" /></span>
      {/if}
    </hbox>
    {#if folderName && previewLines == 0}
      <span class="folder-name" title={folderTooltip}>{folderName}</span>
    {/if}
    <span class="date" title={getFullDateString($message.sent)}>{getListDateString($message.sent)}</span>
  </hbox>
  {#if previewLines > 0}
    <hbox class="preview-line">
      <div class="preview" style="-webkit-line-clamp: {previewLines};">
        {#each highlightParts(preview, highlight) as part}{#if part.isMatch}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}
      </div>
      {#if folderName}
        <span class="folder-name" title={folderTooltip}>{folderName}</span>
      {/if}
    </hbox>
  {/if}
</div>
<ContextMenu bind:this={contextMenu}>
  <MessageMenu messages={menuMessages} />
</ContextMenu>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { onDragStartMail } from "../../../frontend/Mail/Message/drag";
  import { inlineReplies } from "../Selected";
  import { getListDateString, getFullDateString } from "../3pane/MessageDates";
  import { personDisplayName } from "../../../logic/Abstract/PersonUID";
  import { highlightParts } from "../3pane/TextHighlight";
  import { derived } from "svelte/store";
  import ReadIcon from "lucide-svelte/icons/mail-open";
  import UnreadIcon from "lucide-svelte/icons/mail";
  import FlagIcon from "lucide-svelte/icons/flag";
  import type { RibbonLayout } from "../../Shared/Ribbon/RibbonGroup";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import SendingIcon from "lucide-svelte/icons/send";
  import ImportantIcon from "lucide-svelte/icons/circle-alert";
  import MeetingIcon from "lucide-svelte/icons/calendar-days";
  import SecureIcon from "lucide-svelte/icons/lock";
  import AttachmentIcon from "lucide-svelte/icons/paperclip";
  import RepliedIcon from "lucide-svelte/icons/reply";
  import ForwardedIcon from "lucide-svelte/icons/forward";
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
  export let isSelected = false;
  export let previewLines = 1;
  export let threadSize = 0;
  export let isThreadExpanded = false;
  export let isThreadChild = false;
  export let indent = 0;
  export let tighterSpacing = false;
  export let sendersAboveSubject = true;
  export let showFolder = false;
  export let highlight: string | null = null;

  const dispatch = createEventDispatcher<{ toggleThread: void }>();

  $: messageTags = message.tags;
  $: tags = derived($messageTags.contents, () => messageTags.contents);
  const ribbonLayout = getLocalStorage<RibbonLayout>("lookout.ribbon.layout", "classic");
  /* <copied from="../3pane/TableMessageListItem.svelte"> */
  $: showsRecipient = [SpecialFolder.Sent, SpecialFolder.Drafts, SpecialFolder.Outbox].includes(message.folder?.specialFolder);
  $: senderName = $message && (personDisplayName(showsRecipient ? message.contact : message.from) || message.from?.emailAddress || "");
  /* </copied> */
  $: senderTooltip = showsRecipient
    ? $t`To: ${senderName}`
    : $message.from?.emailAddress ?? "";
  $: folderName = showFolder && message.folder ? FolderTreeActions.displayName(message.folder) : null;
  $: folderTooltip = folderName ? $t`In folder ${folderName} of ${message.folder?.account?.name ?? ""}` : null;
  $: isDraft = $message && (message.isDraft || message.folder?.specialFolder == SpecialFolder.Drafts);
  $: hasInlineReply = $inlineReplies.some(reply => reply.original == message);
  $: preview = previewLines > 0 ? ($message.text ?? "").replace(/\s+/g, " ").trim().substring(0, 400) : "";

  // <copied from="../3pane/TableMessageListItem.svelte">
  let contextMenu: ContextMenu;
  let menuMessages: Collection<EMail> = new ArrayColl<EMail>();
  function onContextMenu(event: MouseEvent) {
    menuMessages = new ArrayColl($selectedMessages?.contains(message) ? $selectedMessages.contents : [message]);
    contextMenu.onContextMenu(event);
  }
  // </copied>
</script>

<style>
  .message-item {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    box-sizing: border-box;
    padding: 7px 12px 7px 16px;
    border-bottom: 1px solid var(--lo-divider);
    color: var(--lo-fg);
    cursor: default;
    user-select: none;
    overflow: hidden;
  }
  .message-item:hover {
    background-color: var(--lo-hover-bg);
  }
  .message-item.selected {
    background-color: var(--lo-selected-bg);
  }
  .message-item.selected:hover {
    background-color: var(--lo-selected-hover-bg);
  }
  .message-item.unread::before,
  .message-item.selected::before {
    content: "";
    position: absolute;
    inset-inline-start: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    background-color: var(--lo-accent);
  }
  .message-item.selected:not(.unread)::before {
    width: 3px;
  }
  .message-item.deleted {
    opacity: 0.5;
  }
  .message-item.tighter {
    padding-block: 3px;
  }
  .message-item.subject-first .second-line {
    order: -1;
    height: 20px;
    font-size: 15px;
  }
  .message-item.subject-first .first-line {
    height: 18px;
  }
  .message-item.subject-first .sender {
    font-size: 13px;
  }
  .thread-expander {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    margin-inline: -6px 4px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
    cursor: pointer;
  }
  .thread-expander:hover {
    background-color: var(--lo-pressed-bg);
  }
  .thread-expander :global(.chevron) {
    transition: transform 0.1s;
  }
  .thread-expander :global(.chevron.expanded) {
    transform: rotate(90deg);
  }
  .thread-size {
    flex-shrink: 0;
    margin-inline-start: 6px;
    padding: 0 5px;
    border-radius: 8px;
    background-color: var(--lo-pressed-bg);
    color: var(--lo-fg-secondary);
    font-size: 11px;
    line-height: 16px;
  }
  .line {
    align-items: center;
    min-width: 0;
    white-space: nowrap;
  }
  .first-line {
    height: 20px;
  }
  .second-line {
    height: 18px;
    font-size: 13px;
  }
  .sender {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 15px;
  }
  .unread .sender {
    font-weight: 600;
  }
  .draft {
    flex-shrink: 0;
    margin-inline-end: 4px;
    color: var(--lo-danger);
  }
  .subject {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .unread .subject {
    color: var(--lo-accent-text);
    font-weight: 600;
  }
  .date {
    flex-shrink: 0;
    margin-inline-start: 8px;
    color: var(--lo-fg-secondary);
    font-size: 12px;
  }
  .unread .date {
    color: var(--lo-accent-text);
    font-weight: 600;
  }
  .status-icons {
    flex-shrink: 0;
    align-items: center;
    gap: 4px;
    margin-inline-start: 6px;
    color: var(--lo-fg-secondary);
  }
  .status-icons span {
    display: flex;
  }
  .status-icons :global(.important),
  .status-icons :global(.flag) {
    color: var(--lo-danger);
  }
  .status-icons :global(.flag) {
    fill: var(--lo-danger);
  }
  .status-icons :global(.replied),
  .status-icons :global(.forwarded) {
    color: var(--lo-accent-text);
  }
  .status-icons :global(.sending) {
    animation: sending 1.5s linear infinite;
  }
  @keyframes sending {
    0% { opacity: 0; transform: translate(-3px, 2px); }
    20% { opacity: 1; }
    80% { opacity: 1; }
    100% { opacity: 0; transform: translate(3px, -2px); }
  }
  mark {
    border-radius: 2px;
    background-color: color-mix(in srgb, var(--lo-warning) 28%, transparent);
    color: inherit;
  }
  .preview-line {
    align-items: flex-start;
    min-width: 0;
  }
  .folder-name {
    flex-shrink: 0;
    max-width: 40%;
    margin-inline-start: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--lo-fg-secondary);
    font-size: 12px;
    line-height: 18px;
  }
  .preview {
    flex: 1 1 0;
    min-width: 0;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: var(--lo-fg-secondary);
    font-size: 13px;
    line-height: 18px;
    white-space: normal;
    word-break: break-word;
  }
  .categories {
    flex-shrink: 1;
    min-width: 0;
    gap: 4px;
    margin-inline-start: 8px;
    overflow: hidden;
  }
  .category {
    flex-shrink: 0;
    max-width: 96px;
    padding: 0 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    border: 1px solid color-mix(in srgb, var(--category-color) 70%, var(--lo-fg));
    border-radius: 3px;
    background-color: color-mix(in srgb, var(--category-color) 22%, var(--lo-pane-bg));
    font-size: 11px;
    line-height: 16px;
  }
  .category-square {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    border-radius: 2px;
    background-color: var(--category-color);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
  }
  .hover-actions {
    display: none;
    flex-shrink: 0;
    gap: 2px;
    margin-inline-start: 6px;
  }
  .message-item:hover .hover-actions {
    display: flex;
  }
  .action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
    cursor: pointer;
  }
  .action:hover {
    background-color: var(--lo-pressed-bg);
    color: var(--lo-fg);
  }
  .flagged .flag-action {
    color: var(--lo-danger);
  }
</style>
