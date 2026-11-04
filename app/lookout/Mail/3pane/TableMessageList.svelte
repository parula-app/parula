<vbox flex class="table-message-list" style:--message-columns={gridTemplate} bind:clientWidth={paneWidth}>
  {#if columns}
    <ColumnHeader {folder} settings={$settings} {columns} showsRecipients={showsRecipients}
      bind:liveWidths />
  {/if}
  {#if $messages.hasItems}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="message-list"
      role="listbox"
      aria-multiselectable="true"
      aria-label={$t`Messages`}
      tabindex="0"
      bind:this={listEl}
      bind:clientHeight={viewHeight}
      on:scroll={onScroll}
      on:keydown={onKeyDown}>
      <div class="canvas" style="height: {rows.totalHeight}px;">
        {#each visibleIndexes as index (keyOf(rows.rows[index]))}
          {@const row = rows.rows[index]}
          <div class="slot" style="top: {rows.topOf(index)}px; height: {rows.heightOf(index)}px;">
            {#if row.kind == "header"}
              <button class="group-header" tabindex="-1"
                on:click={() => toggleGroup(row.group.id)}
                aria-expanded={!row.isCollapsed}>
                <ChevronIcon size={14} class="chevron {row.isCollapsed ? 'collapsed' : ''}" />
                <span class="group-label">{row.group.label}</span>
                {#if row.isCollapsed}
                  <span class="group-count">{row.group.messages.length}</span>
                {/if}
              </button>
            {:else if columns}
              <TableMessageListItem message={row.message} {columns}
                isSelected={$selectedMessages.contains(row.message)}
                previewLines={viewType == ViewType.Preview ? Math.max(previewLines, 1) : 0}
                {previewIndent}
                threadSize={row.thread?.length ?? 0}
                isThreadExpanded={row.isThreadExpanded}
                isThreadChild={row.isThreadChild}
                indent={threadIndent(row)}
                {highlight}
                on:toggleThread={() => toggleThread(row.message)}
                on:click={event => onClickMessage(row.message, event)}
                on:dblclick={() => catchErrors(() => MessageActions.openDraft(row.message))}
                on:contextmenu={event => onContextMenu(row.message, event)} />
            {:else}
              <VerticalMessageListItem message={row.message}
                isSelected={$selectedMessages.contains(row.message)}
                {previewLines}
                {tighterSpacing}
                {sendersAboveSubject}
                threadSize={row.thread?.length ?? 0}
                isThreadExpanded={row.isThreadExpanded}
                isThreadChild={row.isThreadChild}
                indent={threadIndent(row)}
                {highlight}
                {showFolder}
                on:toggleThread={() => toggleThread(row.message)}
                on:click={event => onClickMessage(row.message, event)}
                on:dblclick={() => catchErrors(() => MessageActions.openDraft(row.message))}
                on:contextmenu={event => onContextMenu(row.message, event)} />
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <vbox flex class="empty">
      {#if isLoading}
        {$t`Loading…`}
      {:else}
        {$t`We didn't find anything to show here`}
      {/if}
    </vbox>
  {/if}
</vbox>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { Folder } from "../../../logic/Mail/Folder";
  import { SpecialFolder } from "../../../logic/Mail/Folder";
  import { EMailCollection } from "../../../logic/Mail/Store/EMailCollection";
  import { personDisplayName } from "../../../logic/Abstract/PersonUID";
  import { MessageRows, type MessageRow } from "./MessageRows";
  import { MessageActions } from "../MessageActions";
  import { Column, ColumnInfo, shownViewType, defaultColumns, viewSettingsStore, columnWidthOf, ViewType, type ViewSettings } from "../ViewSettings/ViewSettings";
  import { now } from "../../Calendar/selected";
  import { MessageGrouping } from "./MessageGrouping";
  import VerticalMessageListItem from "../Vertical/VerticalMessageListItem.svelte";
  import TableMessageListItem from "./TableMessageListItem.svelte";
  import ColumnHeader from "./ColumnHeader.svelte";
  import ChevronIcon from "lucide-svelte/icons/chevron-down";
  import type { ArrayColl, Collection } from "svelte-collections";
  import { derived } from "svelte/store";
  import { catchErrors, minorError } from "../../../frontend/Util/error";
  import { tick } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let messages: Collection<EMail>;
  export let folder: Folder | null;
  export let selectedMessages: ArrayColl<EMail>;
  export let selectedMessage: EMail | null;
  export let showFolder = false;
  export let highlight: string | null = null;
  export let isLoading = false;

  $: settings = viewSettingsStore(folder);
  $: showsRecipients = !!folder && [SpecialFolder.Sent, SpecialFolder.Drafts, SpecialFolder.Outbox].includes(folder.specialFolder);
  $: showGroupHeaders = !!$settings.showInGroups;
  $: previewLines = $settings.previewLines;
  $: tighterSpacing = $settings.tighterSpacing;
  $: sendersAboveSubject = $settings.showSendersAboveSubject || !$settings.showAsConversations;
  $: alwaysExpandSelected = $settings.showAsConversations && $settings.alwaysExpandSelected;
  $: classicIndented = $settings.classicIndented;

  let paneWidth = 0;
  $: viewType = shownTypeAt($settings, paneWidth);
  function shownTypeAt(view: ViewSettings, width: number): ViewType {
    const kCharWidth = 7;
    return shownViewType(view, width, kCharWidth);
  }
  $: columns = viewType == ViewType.Compact ? null : visibleColumns($settings, showFolder);
  function visibleColumns(view: ViewSettings, withFolder: boolean): Column[] {
    let result = (view.columns?.length ? view.columns : defaultColumns())
      .filter(column => ColumnInfo.of(column));
    if (withFolder && !result.includes(Column.Folder)) {
      let subjectPos = result.indexOf(Column.Subject);
      result.splice(subjectPos >= 0 ? subjectPos + 1 : result.length, 0, Column.Folder);
    }
    return result;
  }

  let liveWidths: Partial<Record<Column, number>> = {};
  $: gridTemplate = columns ? columns.map(column => columnWidth(column, $settings, liveWidths)).join(" ") : null;
  function columnWidth(column: Column, view: ViewSettings, live: Partial<Record<Column, number>>): string {
    if (ColumnInfo.of(column)?.isFlexible) {
      return "minmax(120px, 1fr)";
    }
    return (live[column] ?? columnWidthOf(view, column)) + "px";
  }
  $: previewIndent = columns ? previewIndentOf(columns, $settings, liveWidths) : 0;
  function previewIndentOf(shown: Column[], view: ViewSettings, live: Partial<Record<Column, number>>): number {
    let indent = 0;
    for (let column of shown) {
      if (!ColumnInfo.of(column)?.isIcon) {
        break;
      }
      indent += live[column] ?? columnWidthOf(view, column);
    }
    return indent + 4;
  }

  /* <copied from="TableMessageListItem.svelte"> */
  function listName(message: EMail): string {
    let showsRecipient = [SpecialFolder.Sent, SpecialFolder.Drafts, SpecialFolder.Outbox].includes(message.folder?.specialFolder);
    return personDisplayName(showsRecipient ? message.contact : message.from) || message.from?.emailAddress || "";
  }
  /* </copied> */

  let grouping: MessageGrouping<EMail>;
  $: todayStart = new Date($now).setHours(0, 0, 0, 0);
  $: todayStart, grouping = new MessageGrouping<EMail>($settings.arrangeBy, !!$settings.reverseSort, !!$settings.showInGroups,
    listName, new Date(), !!$settings.showAsConversations,
    $settings.groupBy ?? null, !!$settings.groupReverse);
  $: arrangedMessages = grouping.changesWithMessages
    ? derived($messages.contents, () => messages.contents)
    : derived(messages, all => all.contents);
  $: groups = grouping.arrange($arrangedMessages, messages instanceof EMailCollection);

  let listEl: HTMLDivElement = null;

  const kHeaderHeight = 30;
  let collapsedGroups = new Set<string>();
  let expandedThreads = new Set<EMail>();
  let viewHeight = 400;
  let scrollTop = 0;

  $: messageHeight = rowHeight(viewType, previewLines, tighterSpacing);
  function rowHeight(type: ViewType, lines: number, tighter: boolean): number {
    let lineHeight = tighter ? 24 : 28;
    if (type == ViewType.Single) {
      return lineHeight;
    } else if (type == ViewType.Preview) {
      return lineHeight + 17 * Math.max(lines, 1) + 4;
    }
    return (tighter ? 45 : 53) + 18 * lines;
  }

  function threadIndent(row: MessageRow<EMail>): number {
    if (row.kind != "message" || !row.isThreadChild) {
      return 0;
    }
    if (!classicIndented) {
      return 1;
    }
    let thread = [...row.group.threads?.values() ?? []].find(candidate => candidate.includes(row.message));
    return 1 + (thread ? MessageGrouping.replyDepth(row.message, thread) : 0);
  }
  $: rows = new MessageRows(groups, collapsedGroups, showGroupHeaders, kHeaderHeight, messageHeight, expandedThreads);
  $: visibleIndexes = visibleRange(rows, scrollTop, viewHeight);
  $: loadMetadata(visibleMessages(visibleIndexes));

  function visibleMessages(indexes: number[]): EMail[] {
    let visible: EMail[] = [];
    for (let index of indexes) {
      let row = rows.rows[index];
      if (row.kind == "message") {
        visible.push(row.message);
      }
    }
    return visible;
  }

  // Does what `EMailCollection.getIndexRange()` does for the frontend's list, which shows the collection in its own order
  function loadMetadata(messages: EMail[]) {
    let byCollection = new Map<EMailCollection<EMail>, EMail[]>();
    for (let message of messages) {
      let collection = message?.folder?.messages;
      if (!(collection instanceof EMailCollection)) {
        continue;
      }
      let list = byCollection.get(collection) ?? [];
      list.push(message);
      byCollection.set(collection, list);
    }
    for (let [collection, list] of byCollection) {
      collection.readMessagesFromDB_parallel(list)
        .catch(minorError);
    }
  }

  function visibleRange(rows: MessageRows<EMail>, top: number, height: number): number[] {
    const kOverscan = 6;
    if (!rows.length) {
      return [];
    }
    let start = Math.max(rows.indexAt(top) - kOverscan, 0);
    let end = Math.min(rows.indexAt(top + height) + kOverscan, rows.length - 1);
    let indexes: number[] = [];
    for (let i = start; i <= end; i++) {
      indexes.push(i);
    }
    return indexes;
  }

  function keyOf(row: MessageRow<EMail>): any {
    return row.kind == "header" ? "group:" + row.group.id : row.message;
  }

  function onScroll() {
    scrollTop = listEl.scrollTop;
  }

  export function scrollToTop() {
    if (listEl) {
      listEl.scrollTop = 0;
    }
    scrollTop = 0;
  }

  function scrollIntoView(message: EMail) {
    let index = rows.indexOfMessage(message);
    if (index < 0 || !listEl) {
      return;
    }
    let top = rows.topOf(index);
    let bottom = top + rows.heightOf(index);
    if (index > 0 && rows.rows[index - 1].kind == "header") {
      top -= kHeaderHeight;
    }
    if (top < listEl.scrollTop) {
      listEl.scrollTop = top;
    } else if (bottom > listEl.scrollTop + listEl.clientHeight) {
      listEl.scrollTop = bottom - listEl.clientHeight;
    }
    scrollTop = listEl.scrollTop;
  }

  function toggleGroup(id: string) {
    if (collapsedGroups.has(id)) {
      collapsedGroups.delete(id);
    } else {
      collapsedGroups.add(id);
    }
    collapsedGroups = collapsedGroups;
  }

  export function selectRelative(offset: number) {
    let shown = rows.messages;
    if (!shown.length) {
      return;
    }
    let pos = selectedMessage ? shown.indexOf(selectedMessage) : -1;
    let target = shown[Math.max(0, Math.min(pos + offset, shown.length - 1))];
    select([target], target);
    anchor = target;
    scrollIntoView(target);
  }

  function toggleThread(lead: EMail) {
    if (expandedThreads.has(lead)) {
      expandedThreads.delete(lead);
    } else {
      expandedThreads.add(lead);
    }
    expandedThreads = expandedThreads;
  }

  function threadLeadOf(message: EMail): EMail | null {
    let row = rows.rows[rows.indexOfMessage(message)];
    if (row?.kind != "message") {
      return null;
    }
    if (row.thread) {
      return message;
    }
    if (row.isThreadChild) {
      return [...row.group.threads?.entries() ?? []].find(([, thread]) => thread.includes(message))?.[0] ?? null;
    }
    return null;
  }

  function setThreadExpanded(message: EMail, expanded: boolean): boolean {
    let lead = threadLeadOf(message);
    if (!lead || expandedThreads.has(lead) == expanded) {
      return false;
    }
    toggleThread(lead);
    if (!expanded && message != lead) {
      select([lead], lead);
      anchor = lead;
    }
    return true;
  }

  export function setAllGroupsCollapsed(collapsed: boolean) {
    collapsedGroups = collapsed ? new Set(groups.map(group => group.id)) : new Set();
  }

  export function setGroupOfSelectionCollapsed(collapsed: boolean) {
    let group = groups.find(group => group.messages.includes(selectedMessage));
    if (!group || collapsedGroups.has(group.id) == collapsed) {
      return;
    }
    toggleGroup(group.id);
  }

  let anchor: EMail | null = null;

  function select(chosen: EMail[], primary: EMail) {
    selectedMessages.clear();
    selectedMessages.addAll(chosen);
    selectedMessage = primary;
  }

  function onClickMessage(message: EMail, event: MouseEvent) {
    listEl?.focus();
    if (event.shiftKey && anchor && rows.hasMessage(anchor)) {
      selectRange(anchor, message);
    } else if (event.ctrlKey || event.metaKey) {
      if (selectedMessages.contains(message)) {
        selectedMessages.remove(message);
        selectedMessage = selectedMessages.isEmpty ? null : selectedMessages.last;
      } else {
        selectedMessages.add(message);
        selectedMessage = message;
      }
      anchor = message;
    } else {
      select([message], message);
      anchor = message;
    }
  }

  function selectRange(from: EMail, to: EMail) {
    let fromPos = rows.messages.indexOf(from);
    let toPos = rows.messages.indexOf(to);
    let range = rows.messages.slice(Math.min(fromPos, toPos), Math.max(fromPos, toPos) + 1);
    select(range, to);
  }

  function onContextMenu(message: EMail, event: MouseEvent) {
    event.preventDefault();
    if (!selectedMessages.contains(message)) {
      select([message], message);
      anchor = message;
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    let shown = rows.messages;
    if (!shown.length) {
      return;
    }
    let current = selectedMessage && rows.hasMessage(selectedMessage) ? selectedMessage : null;
    let pos = current ? shown.indexOf(current) : -1;
    let pageSize = Math.max(Math.floor(viewHeight / messageHeight) - 1, 1);
    let newPos: number = null;
    if (event.altKey) {
      return;
    }
    if (event.key == "ArrowDown") {
      newPos = pos + 1;
    } else if (event.key == "ArrowUp") {
      newPos = pos < 0 ? 0 : pos - 1;
    } else if (event.key == "PageDown") {
      newPos = pos + pageSize;
    } else if (event.key == "PageUp") {
      newPos = pos - pageSize;
    } else if (event.key == "Home") {
      newPos = 0;
    } else if (event.key == "End") {
      newPos = shown.length - 1;
    } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() == "a") {
      event.preventDefault();
      event.stopPropagation();
      select(shown, current ?? shown[0]);
      return;
    } else if (event.key == "ArrowLeft" && !event.ctrlKey) {
      event.preventDefault();
      if (!(current && setThreadExpanded(current, false)) && showGroupHeaders) {
        setGroupOfSelectionCollapsed(true);
      }
      return;
    } else if (event.key == "ArrowRight" && !event.ctrlKey) {
      event.preventDefault();
      if (!(current && setThreadExpanded(current, true)) && showGroupHeaders) {
        setGroupOfSelectionCollapsed(false);
      }
      return;
    } else if (event.key == "Enter" && current) {
      event.preventDefault();
      catchErrors(() => MessageActions.openDraft(current));
      return;
    }
    if (newPos == null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    newPos = Math.max(0, Math.min(newPos, shown.length - 1));
    let target = shown[newPos];
    if (event.shiftKey) {
      if (!anchor || !rows.hasMessage(anchor)) {
        anchor = current ?? target;
      }
      selectRange(anchor, target);
    } else if (event.ctrlKey || event.metaKey) {
      selectedMessage = target;
    } else {
      select([target], target);
      anchor = target;
    }
    scrollIntoView(target);
  }

  let lastPosition = 0;
  $: if (selectedMessage && rows.hasMessage(selectedMessage)) {
    lastPosition = rows.messages.indexOf(selectedMessage);
  }
  $: rows, $selectedMessages, ensureSelection();
  function ensureSelection() {
    let gone = selectedMessages.contents.filter(message => !rows.hasMessage(message));
    if (gone.length) {
      selectedMessages.removeAll(gone);
    }
    if (selectedMessages.hasItems) {
      if (!selectedMessages.contains(selectedMessage)) {
        selectedMessage = selectedMessages.last;
      }
      return;
    }
    if (!gone.length) {
      return;
    }
    let replacement = gone.some(message => !message.folder?.messages.contains(message))
      ? rows.messages[Math.min(lastPosition, rows.messages.length - 1)] ?? null
      : null;
    if (replacement) {
      select([replacement], replacement);
    } else {
      selectedMessage = null;
    }
  }

  let isInitialScrollDone = false;
  $: if (!isInitialScrollDone && listEl && rows.length) {
    isInitialScrollDone = true;
    catchErrors(scrollToSelectionOnMount);
  }
  async function scrollToSelectionOnMount() {
    await tick();
    if (selectedMessage) {
      scrollIntoView(selectedMessage);
    }
  }

  let autoExpandedFor: EMail | null = null;
  $: if (alwaysExpandSelected && selectedMessage != autoExpandedFor) {
    autoExpandedFor = selectedMessage;
    expandSelectedThread();
  }
  function expandSelectedThread() {
    let row = rows.rows[rows.indexOfMessage(selectedMessage)];
    if (row?.kind == "message" && row.thread && !row.isThreadExpanded) {
      toggleThread(selectedMessage);
    }
  }

  $: selectedMessage, followOutsideSelection();
  async function followOutsideSelection() {
    if (!selectedMessage || selectedMessages.contains(selectedMessage)) {
      return;
    }
    if (!rows.hasMessage(selectedMessage)) {
      return;
    }
    select([selectedMessage], selectedMessage);
    anchor = selectedMessage;
    await tick();
    scrollIntoView(selectedMessage);
  }
</script>

<style>
  .table-message-list {
    min-width: 0;
    min-height: 0;
  }
  .empty {
    align-items: center;
    padding: 32px 16px;
    color: var(--lo-fg-secondary);
    text-align: center;
  }
  .message-list {
    flex: 1 0 0;
    position: relative;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    outline: none;
  }
  .canvas {
    position: relative;
    width: 100%;
  }
  .slot {
    position: absolute;
    left: 0;
    right: 0;
  }
  .group-header {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 100%;
    padding: 0 12px;
    border: none;
    border-bottom: 1px solid var(--lo-divider);
    background-color: var(--lo-pane-alt-bg);
    color: var(--lo-fg);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    text-align: start;
    cursor: pointer;
  }
  .group-header:hover {
    background-color: var(--lo-hover-bg);
  }
  .group-header :global(.chevron) {
    flex-shrink: 0;
    color: var(--lo-fg-secondary);
    transition: transform 0.1s;
  }
  .group-header :global(.chevron.collapsed) {
    transform: rotate(-90deg);
  }
  .group-count {
    color: var(--lo-fg-secondary);
    font-weight: normal;
  }
</style>
