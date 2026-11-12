<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="folder-row"
  class:selected={selectedFolder == folder}
  class:unread={count > 0 && !showsTotal}
  class:drop-target={isDropTarget}
  style="--depth: {depth};"
  role="treeitem"
  tabindex="-1"
  aria-selected={selectedFolder == folder}
  aria-expanded={hasChildren ? isExpanded : undefined}
  title={tooltip}
  draggable={!isVirtual && !isRenaming}
  on:click={onSelect}
  on:contextmenu={onContextMenu}
  on:dragstart={event => FolderTreeActions.startDrag(event, folder)}
  on:dragend={() => FolderTreeActions.endDrag()}
  on:dragover={onDragOver}
  on:dragleave={() => isDropTarget = false}
  on:drop={onDrop}
  >
  <button class="expander" class:hidden={!hasChildren} tabindex="-1"
    on:click|stopPropagation={onToggle}
    aria-label={isExpanded ? $t`Collapse` : $t`Expand`}>
    <ChevronIcon size={12} class="chevron {isExpanded ? 'expanded' : ''}" />
  </button>
  <hbox class="icon">
    <FolderIcon {folder} size="16px" />
  </hbox>
  {#if isRenaming}
    <input class="rename" type="text" bind:value={newName}
      on:keydown={onRenameKey}
      on:blur={finishRename}
      on:click|stopPropagation
      use:focusAndSelect />
  {:else}
    <span class="name">{name}</span>
  {/if}
  <hbox flex />
  {#if count > 0}
    <span class="count" class:total={showsTotal}>{showsTotal ? `[${count}]` : count}</span>
  {/if}
  {#if isInbox && account && !$account.isLoggedIn}
    <ConnectButton {account} />
  {/if}
</div>
<ContextMenu bind:this={contextMenu}>
  <FolderMenu {folder} />
</ContextMenu>

<script lang="ts">
  import { SpecialFolder, type Folder } from "../../../logic/Mail/Folder";
  import { AllFolders } from "../../../logic/Mail/Virtual/AllFolders";
  import { SavedSearchFolder } from "../../../logic/Mail/Virtual/SavedSearchFolder";
  import { appGlobal } from "../../../logic/app";
  import { onDragOverMail } from "../../../frontend/Mail/Message/drag";
  import { MessageActions } from "../MessageActions";
  import { renamingFolder } from "../Selected";
  import { FolderCountMode, FolderTreeActions } from "./FolderTreeActions";
  import FolderMenu from "./FolderMenu.svelte";
  import ConnectButton from "./ConnectButton.svelte";
  import FolderIcon from "../../../frontend/Mail/LeftPane/FolderIcon.svelte";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import ChevronIcon from "lucide-svelte/icons/chevron-right";
  import { catchErrors } from "../../../frontend/Util/error";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import { t } from "../../../l10n/l10n";

  export let folder: Folder;
  export let depth = 0;
  export let isFavorite = false;
  export let selectedFolder: Folder;

  $: subFolders = folder.subFolders;
  $: hasChildren = $subFolders.hasItems;
  /* <copied to="FolderNode.svelte"> */
  const expandedIDs = getLocalStorage<string[]>("lookout.mail.expandedFolders", []);
  $: nodeID = folder.account?.id + "/" + folder.id;
  $: isExpanded = !isFavorite && ($expandedIDs.value ?? []).includes(nodeID);
  /* </copied> */

  /* <copied to="SearchFoldersNode.svelte"> */
  function onToggle() {
    let ids = ($expandedIDs.value ?? []).filter(existing => existing != nodeID);
    if (!isExpanded) {
      ids.push(nodeID);
    }
    $expandedIDs.value = ids;
  }
  /* </copied> */
  const accounts = appGlobal.emailAccounts;

  $: name = $folder && FolderTreeActions.displayName(folder);
  $: account = folder.account;
  $: isInbox = !isFavorite && folder.specialFolder == SpecialFolder.Inbox;
  $: isVirtual = folder instanceof AllFolders || folder instanceof SavedSearchFolder;
  const countModes = getLocalStorage<Record<string, FolderCountMode>>("lookout.mail.folderCountModes", {});
  $: showsTotal = FolderTreeActions.showsTotalCount(folder, $countModes.value);
  $: accountsCount = $accounts.length;
  $: countStore = FolderTreeActions.countStore(folder, showsTotal);
  $: count = $countStore;
  $: tooltip = $folder && (isFavorite && accountsCount > 1
    ? $t`${name} (all accounts)\n${folder.countUnread} unread, ${folder.countTotal} total`
    : $t`${name}\n${folder.countUnread} unread, ${folder.countTotal} total`);

  function onSelect() {
    if (isRenaming) {
      return;
    }
    selectedFolder = folder;
  }

  let contextMenu: ContextMenu;
  function onContextMenu(event: MouseEvent) {
    event.preventDefault();
    contextMenu.onContextMenu(event);
  }

  let isDropTarget = false;
  function onDragOver(event: DragEvent) {
    if (FolderTreeActions.isFolderDrag(event)) {
      if (FolderTreeActions.canDropFolder(folder)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        isDropTarget = true;
      }
      return;
    }
    if (isVirtual || !event.dataTransfer?.types.includes("message/drag-ids")) {
      return;
    }
    isDropTarget = true;
    catchErrors(() => onDragOverMail(event, folder));
  }
  function onDrop(event: DragEvent) {
    isDropTarget = false;
    if (FolderTreeActions.isFolderDrag(event)) {
      event.preventDefault();
      catchErrors(() => FolderTreeActions.dropFolder(folder));
      return;
    }
    catchErrors(() => MessageActions.dropMessages(event, folder));
  }

  $: isRenaming = $renamingFolder == folder;
  let newName = "";
  $: if (isRenaming) {
    newName = folder.name;
  }
  function onRenameKey(event: KeyboardEvent) {
    if (event.key == "Enter") {
      event.preventDefault();
      finishRename();
    } else if (event.key == "Escape") {
      event.preventDefault();
      $renamingFolder = null;
    }
    event.stopPropagation();
  }
  function finishRename() {
    if (!isRenaming) {
      return;
    }
    $renamingFolder = null;
    catchErrors(() => FolderTreeActions.rename(folder, newName));
  }
  function focusAndSelect(input: HTMLInputElement) {
    input.focus();
    input.select();
  }
</script>

<style>
  .folder-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-shrink: 0;
    position: relative;
    height: 30px;
    padding-inline-start: calc(var(--depth) * 16px);
    padding-inline-end: 8px;
    border-radius: var(--lo-radius-small);
    color: var(--lo-fg);
    cursor: pointer;
    user-select: none;
  }
  .folder-row:hover {
    background-color: var(--lo-hover-bg);
  }
  .folder-row.selected {
    background-color: var(--lo-selected-bg);
    font-weight: 600;
  }
  .folder-row.selected::before {
    content: "";
    position: absolute;
    inset-inline-start: 0;
    top: 7px;
    bottom: 7px;
    width: 3px;
    border-radius: 2px;
    background-color: var(--lo-accent);
  }
  .folder-row.selected:hover {
    background-color: var(--lo-selected-hover-bg);
  }
  .folder-row.drop-target {
    outline: 2px solid var(--lo-accent);
    outline-offset: -2px;
    background-color: var(--lo-accent-tint);
  }
  /* <copied to="SearchFoldersNode.svelte"> */
  .expander {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    margin-inline-start: 2px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
    cursor: pointer;
  }
  .expander:hover {
    background-color: var(--lo-pressed-bg);
  }
  .expander :global(.chevron) {
    transition: transform 0.1s;
  }
  .expander :global(.chevron.expanded) {
    transform: rotate(90deg);
  }
  .icon {
    flex-shrink: 0;
    margin-inline: 2px 8px;
    color: var(--lo-fg-secondary);
  }
  /* </copied> */
  .expander.hidden {
    visibility: hidden;
  }
  .selected .icon {
    color: var(--lo-accent-text);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .unread .name {
    font-weight: 600;
  }
  .count {
    flex-shrink: 0;
    margin-inline-start: 8px;
    color: var(--lo-accent-text);
    font-size: 13px;
    font-weight: 600;
  }
  .count.total {
    color: var(--lo-fg-secondary);
    font-weight: normal;
  }
  .rename {
    flex: 1;
    min-width: 0;
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--lo-accent);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
    color: var(--lo-fg);
    font: inherit;
    outline: none;
  }
</style>
