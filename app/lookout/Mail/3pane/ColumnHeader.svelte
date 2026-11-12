<div class="column-header" role="row">
  {#each columns as column (column)}
    {@const info = ColumnInfo.of(column)}
    <div class="header-cell" class:icon-cell={info?.isIcon} role="columnheader"
      aria-sort={isSortColumn(column) ? (isAscending ? "ascending" : "descending") : null}
      on:contextmenu={event => onContextMenu(column, event)}>
      <button class="header-button" class:sortable={!!info?.sortField} tabindex="-1"
        title={headerTooltip(column)}
        disabled={!info?.sortField}
        on:click={() => info?.sortField && sortFolderByColumn(folder, info.sortField)}>
        {#if column == Column.Importance}
          <ImportantIcon size={14} />
        {:else if column == Column.Icon}
          <IconIcon size={14} />
        {:else if column == Column.Attachment}
          <AttachmentIcon size={14} />
        {:else if column == Column.Flag}
          <FlagIcon size={14} />
        {:else}
          <span class="label">{headerLabel(column)}</span>
        {/if}
        {#if isSortColumn(column) && !info?.isIcon}
          <hbox flex />
          {#if isAscending}
            <AscendingIcon size={12} class="sort-arrow" />
          {:else}
            <DescendingIcon size={12} class="sort-arrow" />
          {/if}
        {/if}
      </button>
      {#if info && !info.isIcon && !info.isFlexible}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="resize-handle" on:mousedown={event => onResizeStart(column, event)}></div>
      {/if}
    </div>
  {/each}
</div>
<ContextMenu bind:this={contextMenu}>
  {#if contextInfo?.sortField}
    <MenuItem label={$t`Sort Ascending`} icon={AscendingIcon}
      onClick={() => sortColumn(contextInfo.sortField, true)} />
    <MenuItem label={$t`Sort Descending`} icon={DescendingIcon}
      onClick={() => sortColumn(contextInfo.sortField, false)} />
    <MenuItem label={$t`Group By This Field`} icon={GroupIcon}
      onClick={() => changeViewSettings(folder, { groupBy: contextInfo.sortField, groupReverse: false, showInGroups: true })} />
    <MenuDivider />
  {/if}
  <MenuItem label={$t`Remove This Column`} icon={RemoveIcon}
    disabled={contextColumn == Column.Subject && $t`The list needs the Subject column`}
    onClick={() => changeViewSettings(folder, { columns: viewSettingsOf(folder).columns.filter(column => column != contextColumn) })} />
  <MenuItem label={$t`Add Columns…`} icon={AddColumnsIcon} onClick={onAddColumns} />
  <MenuDivider />
  <MenuItem label={$t`View Settings…`} icon={SettingsIcon} onClick={() => { $openViewSettings = { folder }; }} />
</ContextMenu>
<AppWindowEvents on:mousemove={onResizeMove} on:mouseup={onResizeEnd} />

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import { Column, ColumnInfo, viewSettingsOf, changeViewSettings, ViewType, type ViewSettings } from "../ViewSettings/ViewSettings";
  import { openViewSettings, openShowColumns } from "../Selected";
  import { arrangeFolderBy, sortFolderByColumn } from "../ViewSettings/ViewCommands";
  import { ArrangeBy, MessageGrouping } from "./MessageGrouping";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import AppWindowEvents from "../../../frontend/MainWindow/AppWindowEvents.svelte";
  import ImportantIcon from "lucide-svelte/icons/circle-alert";
  import IconIcon from "lucide-svelte/icons/mail";
  import AttachmentIcon from "lucide-svelte/icons/paperclip";
  import FlagIcon from "lucide-svelte/icons/flag";
  import AscendingIcon from "lucide-svelte/icons/arrow-up";
  import DescendingIcon from "lucide-svelte/icons/arrow-down";
  import GroupIcon from "lucide-svelte/icons/list-tree";
  import RemoveIcon from "lucide-svelte/icons/x";
  import AddColumnsIcon from "lucide-svelte/icons/columns-3";
  import SettingsIcon from "lucide-svelte/icons/settings-2";
  import { t } from "../../../l10n/l10n";

  export let folder: Folder | null;
  export let settings: ViewSettings;
  export let columns: Column[];
  export let showsRecipients = false;
  export let liveWidths: Partial<Record<Column, number>> = {};

  $: isAscending = MessageGrouping.isDescendingByDefault(settings.arrangeBy) == !!settings.reverseSort;

  function isSortColumn(column: Column): boolean {
    let field = ColumnInfo.of(column)?.sortField;
    if (!field || field != settings.arrangeBy) {
      return false;
    }
    if (field == ArrangeBy.Date) {
      let dateColumn = columns.find(candidate => ColumnInfo.of(candidate)?.sortField == ArrangeBy.Date);
      return column == dateColumn;
    }
    return true;
  }

  function headerLabel(column: Column): string {
    if (column == Column.From && showsRecipients) {
      return $t`To`;
    }
    return ColumnInfo.labelOf(column);
  }

  function headerTooltip(column: Column): string {
    let info = ColumnInfo.of(column);
    return info?.sortField ? $t`Sort by: ${headerLabel(column)}` : headerLabel(column);
  }

  function sortColumn(field: ArrangeBy, ascending: boolean) {
    arrangeFolderBy(folder, field);
    changeViewSettings(folder, { reverseSort: MessageGrouping.isDescendingByDefault(field) == ascending });
  }

  let contextMenu: ContextMenu;
  let contextColumn: Column = null;
  $: contextInfo = contextColumn ? ColumnInfo.of(contextColumn) : null;
  /* <copied from="../Ribbon/ViewTab.svelte"> */
  function onAddColumns() {
    if (viewSettingsOf(folder).type == ViewType.Compact) {
      changeViewSettings(folder, { type: ViewType.Single });
    }
    $openShowColumns = { folder };
  }
  /* </copied> */

  function onContextMenu(column: Column, event: MouseEvent) {
    event.preventDefault();
    contextColumn = column;
    contextMenu.onContextMenu(event);
  }

  let resizingColumn: Column | null = null;
  let resizeStartX: number;
  let resizeStartWidth: number;
  let isResizeRTL = false;
  let resizedWidth: number;

  function onResizeStart(column: Column, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    let cell = (event.target as HTMLElement).closest(".header-cell") as HTMLElement;
    resizingColumn = column;
    resizeStartX = event.clientX;
    resizeStartWidth = cell.getBoundingClientRect().width;
    resizedWidth = resizeStartWidth;
    isResizeRTL = getComputedStyle(cell).direction == "rtl";
  }

  function onResizeMove(event: MouseEvent) {
    const kMinWidth = 40;
    if (!resizingColumn) {
      return;
    }
    let delta = (event.clientX - resizeStartX) * (isResizeRTL ? -1 : 1);
    resizedWidth = Math.max(kMinWidth, resizeStartWidth + delta);
    liveWidths[resizingColumn] = resizedWidth;
    liveWidths = liveWidths;
  }

  function onResizeEnd() {
    if (!resizingColumn) {
      return;
    }
    let column = resizingColumn;
    resizingColumn = null;
    delete liveWidths[column];
    liveWidths = liveWidths;
    changeViewSettings(folder, { columnWidths: { ...viewSettingsOf(folder).columnWidths, [column]: Math.round(resizedWidth) } });
  }
</script>

<style>
  .column-header {
    display: grid;
    grid-template-columns: var(--message-columns);
    flex-shrink: 0;
    height: 28px;
    padding-inline: 8px 4px;
    border-bottom: 1px solid var(--lo-divider);
    color: var(--lo-fg-secondary);
    font-size: 12px;
    user-select: none;
  }
  .header-cell {
    position: relative;
    display: flex;
    min-width: 0;
  }
  .header-cell + .header-cell {
    border-inline-start: 1px solid var(--lo-divider);
  }
  .header-button {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1 1 auto;
    min-width: 0;
    padding: 0 6px;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
  }
  .icon-cell .header-button {
    justify-content: center;
    padding: 0;
  }
  .header-button:disabled {
    color: inherit;
    cursor: default;
  }
  .header-button.sortable {
    cursor: pointer;
  }
  .header-button.sortable:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .header-button :global(.sort-arrow) {
    flex-shrink: 0;
    color: var(--lo-fg);
  }
  .resize-handle {
    position: absolute;
    inset-inline-end: -4px;
    top: 0;
    bottom: 0;
    width: 7px;
    z-index: 1;
    cursor: col-resize;
  }
</style>
