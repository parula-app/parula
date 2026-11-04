<!-- svelte-ignore a11y_no_static_element_interactions -->
<hbox class="attachment-card" title={executable ?? $attachment.filename}
  draggable={!isComposing}
  on:dblclick={() => catchErrors(onOpen)}
  on:contextmenu|preventDefault={openMenu}
  on:dragstart={event => catchErrors(() => onDragStart(event))}>
  <hbox class="icon" bind:this={iconEl}>
    <FileIcon ext={$attachment.ext} localFilePath={$attachment.filepathLocal} size={24} />
  </hbox>
  <vbox flex class="info">
    <span class="filename">{$attachment.filename}</span>
    <span class="size">{$attachment.size ? fileSize($attachment.size) : $t`Not downloaded`}</span>
  </vbox>
  <button type="button" class="menu-button" title={$t`Attachment options`} aria-label={$t`Attachment options`}
    aria-haspopup="menu" bind:this={menuButton}
    on:click|stopPropagation={openMenu}>
    <ChevronIcon size={14} />
  </button>
</hbox>
<Menu bind:isMenuOpen anchor={menuButton} placement="bottom-end">
  <MenuItem label={$t`Open`} icon={OpenIcon} disabled={executable ?? false} onClick={onOpen} />
  {#if !isComposing}
    <MenuItem label={$t`Show in Folder`} icon={FolderIcon}
      disabled={!$attachment.filepathLocal && $t`The attachment is not saved on this computer yet`}
      onClick={() => attachment.openOSFolder()} />
  {/if}
  <MenuItem label={$t`Save As`} icon={SaveIcon} onClick={saveFile} />
  {#if canSaveAll}
    <MenuItem label={$t`Save All Attachments…`} icon={SaveAllIcon} onClick={() => { dispatch("saveAll"); }} />
  {/if}
  {#if isComposing}
    <MenuDivider />
    <MenuItem label={$t`Remove Attachment`} icon={RemoveIcon} onClick={() => { dispatch("remove"); }} />
  {/if}
</Menu>

<script lang="ts">
  import type { Attachment } from "../../../logic/Abstract/Attachment";
  import { executableMessage } from "../../../logic/Files/FileType/ExecutableFile";
  import { openFileInternallyFromFile, canOpenFileInternally } from "../../../frontend/Files/open";
  import { saveBlobAsFile } from "../../../frontend/Util/util";
  import { fileSize } from "../../../frontend/Files/file";
  import FileIcon from "../../../frontend/Files/Thumbnail/FileIcon.svelte";
  import Menu from "../../Shared/Menu/Menu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import ChevronIcon from "lucide-svelte/icons/chevron-down";
  import OpenIcon from "lucide-svelte/icons/external-link";
  import FolderIcon from "lucide-svelte/icons/folder-open";
  import SaveIcon from "lucide-svelte/icons/save";
  import SaveAllIcon from "lucide-svelte/icons/save-all";
  import RemoveIcon from "lucide-svelte/icons/x";
  import { catchErrors } from "../../../frontend/Util/error";
  import { appGlobal } from "../../../logic/app";
  import { assert } from "../../../logic/util/util";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let attachment: Attachment;
  export let isComposing = false;
  export let canSaveAll = false;
  const dispatch = createEventDispatcher<{ remove: void, saveAll: void }>();

  let isMenuOpen = false;
  let menuButton: HTMLButtonElement;
  let iconEl: HTMLElement;
  $: executable = $attachment.executable ? executableMessage($attachment.executable) : null;

  function openMenu() {
    isMenuOpen = !isMenuOpen;
  }

  // <copied from="../../../frontend/Mail/Message/AttachmentUI.svelte">
  async function onOpen() {
    if (canOpenFileInternally(attachment.mimeType)) {
      await attachment.load();
      await openFileInternallyFromFile(attachment.content);
    } else {
      if (!attachment.filepathLocal) {
        await attachment.load();
      }
      await attachment.openOSApp();
    }
  }

  async function onDragStart(event: DragEvent) {
    // #if [!WEBMAIL && !MOBILE]
    if (attachment.filepathLocal) {
      event.preventDefault();
      await appGlobal.remoteApp.startDrag(attachment.filepathLocal);
      return;
    }
    // #endif
    assert(attachment.content instanceof File, $t`Attachment file is missing`);
    event.dataTransfer.items.clear();
    event.dataTransfer.items.add(attachment.content);
    event.dataTransfer.setDragImage(iconEl as HTMLElement, 0, 0);
    event.dataTransfer.effectAllowed = "copy";
  }
  // </copied>

  // <copied from="../../../frontend/Mail/Message/AttachmentMenu.svelte">
  async function saveFile() {
    await saveBlobAsFile(await attachment.getContent());
  }
  // </copied>
</script>

<style>
  .attachment-card {
    align-items: center;
    gap: 8px;
    width: 220px;
    height: 44px;
    box-sizing: border-box;
    padding: 0 4px 0 8px;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-bg);
    color: var(--lo-fg);
    cursor: default;
  }
  .attachment-card:hover {
    background-color: var(--lo-hover-bg);
  }
  .icon {
    flex-shrink: 0;
    color: var(--lo-accent-text);
  }
  .info {
    min-width: 0;
  }
  .filename,
  .size {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .size {
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .menu-button {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 24px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
  }
  .menu-button:hover {
    background-color: var(--lo-pressed-bg);
    color: var(--lo-fg);
  }
</style>
