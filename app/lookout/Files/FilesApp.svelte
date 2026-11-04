<vbox flex class="files-page" bind:this={pageEl}>
  <FilesRibbon bind:this={ribbon} />
  <slot />
</vbox>

<svelte:window on:keydown={onKeyDown} />

<script lang="ts">
  import { viewFile } from "../../frontend/Files/selected";
  import FilesRibbon from "./FilesRibbon.svelte";
  import { catchErrors } from "../../frontend/Util/error";

  let ribbon: FilesRibbon;
  let pageEl: HTMLElement;

  function onKeyDown(event: KeyboardEvent) {
    let target = event.target as HTMLElement;
    if (event.defaultPrevented || !pageEl?.contains(target) && target != document.body) {
      return;
    }
    if (target?.closest?.("input, textarea, select, [contenteditable]") || event.ctrlKey || event.altKey) {
      return;
    }
    if (event.key == "Escape" && $viewFile) {
      event.preventDefault();
      ribbon.closeViewer();
    } else if (event.key == "Delete") {
      event.preventDefault();
      catchErrors(() => ribbon.deleteSelected());
    }
  }
</script>

<style>
  .files-page {
    min-height: 0;
    min-width: 0;
  }

  /* Folder header: the ribbon has its buttons */
  .files-page :global(.main-pane > .header) {
    flex-shrink: 0;
    min-height: 44px;
    margin: 0;
    padding: 0 16px 0 8px;
    border-block-end: 1px solid var(--lo-divider);
  }
  .files-page :global(.main-pane > .header > .buttons:last-child) {
    display: none;
  }
  .files-page :global(.main-pane > .header .name) {
    margin-inline-start: 8px;
    font-size: 16px;
    font-weight: 600;
  }
  .files-page :global(.main-pane > .header .count) {
    margin-inline-end: 0;
    opacity: 1;
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }

  /* File list, like the Contacts table */
  .files-page :global(.files-list .header) {
    height: 32px;
    padding-inline: 12px;
    opacity: 1;
    border-block-end: 1px solid var(--lo-divider);
    border-inline-end: 1px solid var(--lo-divider);
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
    font-weight: 600;
  }
  .files-page :global(.files-list .line > *) {
    align-items: center;
    min-height: 36px;
    border-block-end: 1px solid var(--lo-divider);
  }
  .files-page :global(.files-list .line :is(.type, .size, .time)) {
    color: var(--lo-fg-secondary);
    font-size: inherit;
    font-weight: inherit;
  }
  .files-page :global(.files-list .line.selected > *) {
    color: var(--lo-fg);
  }
  .files-page :global(.files-list .separator) {
    display: none;
  }

  /* Gallery */
  .files-page :global(.gallery) {
    gap: 2px;
    margin: 0;
    padding: 12px;
  }
  .files-page :global(.gallery .linebreak) {
    margin-top: 0;
  }
  .files-page :global(.gallery .box) {
    border-radius: var(--lo-radius);
  }
  .files-page :global(.gallery .box.selected) {
    background-color: var(--lo-selected-bg);
  }
  .files-page :global(.gallery .box .time) {
    opacity: 1;
    color: var(--lo-fg-secondary);
  }

  /* Details pane: the ribbon has its buttons */
  .files-page :global(.right-side-bar) {
    box-shadow: none;
  }
  .files-page :global(.right-side-bar :is(.open.buttons, .open-preview, .action.buttons)) {
    display: none;
  }
  .files-page :global(.right-side-bar .name-container .name) {
    font-size: 20px;
    font-weight: 600;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .files-page :global(.right-side-bar .file-properties) {
    opacity: 1;
    color: var(--lo-fg-secondary);
  }

  /* Left pane: island aligned with the ribbon and the main pane */
  .files-page :global(.left-pane) {
    padding-block-end: 0;
  }
  .files-page :global(.left-pane .top > .island) {
    margin: 0;
  }
</style>
