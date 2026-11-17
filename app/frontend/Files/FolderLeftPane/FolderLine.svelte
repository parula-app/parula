<hbox class="folder" flex
  on:drop={(event) => catchErrors(() => onDropFile(event, folder))}
  on:dragover={(event) => catchErrors(() => onDragOverFile(event, folder))}
  on:contextmenu={contextMenu.onContextMenu}
  title={$folder.name}
  >
  <hbox class="icon">
    <FolderIcon size="14px" />
  </hbox>
  <hbox class="label">
    {$folder.name}
  </hbox>
  <hbox flex />
  <hbox class="buttons">
    <slot name="buttons" {folder} />
  </hbox>
</hbox>

<ContextMenu bind:this={contextMenu}>
  <FolderMenu {folder} />
</ContextMenu>

<script lang="ts">
  import type { Directory } from '../../../logic/Files/Directory';
  import { onDropFile, onDragOverFile } from '../drag';
  import FolderMenu from './FolderMenu.svelte';
  import ContextMenu from '../../Shared/Menu/ContextMenu.svelte';
  import FolderIcon from "lucide-svelte/icons/folder";
  import { catchErrors } from '../../Util/error';

  export let folder: Directory;

  let contextMenu: ContextMenu;
</script>

<style>
  .folder {
    align-items: center;
    padding-block-start: 2px;
    padding-block-end: 2px;
    min-width: 0;
    background-color: inherit;
  }
  .icon :global(.cls-2) {
    stroke: black;
  }
  .label {
    padding-inline-start: 8px;
    font-weight: 300;
    min-width: 0; /* avoid pushing out the buttons */
    overflow: hidden;
  }
  .buttons {
    justify-content: end;
    background-color: inherit;
  }
  .folder:not(:hover) .buttons {
    display: none;
  }
  .buttons :global(button:hover) {
    background: inherit !important;
  }
  .buttons :global(button) {
    color: unset;
    background-color: unset;
  }
  .buttons :global(.get-mail button) {
    padding: 3px;
    border: 1px solid transparent;
  }
</style>
