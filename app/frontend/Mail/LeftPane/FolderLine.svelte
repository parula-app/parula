<hbox class="folder" flex
  on:drop={(event) => catchErrors(() => onDropMail(event, folder))}
  on:dragover={(event) => catchErrors(() => onDragOverMail(event, folder))}
  on:contextmenu={contextMenu.onContextMenu}
  on:click
  title={tooltip}
  >
  <hbox class="icon">
    <FolderIcon {folder} size={$appGlobal.isMobile ? "20px" : "14px"} />
  </hbox>
  <hbox class="label font-small">
    {#if !folder.specialFolder || folder.specialFolder == SpecialFolder.Normal || folder.specialFolder == SpecialFolder.Search}
      {$folder.name}
    {:else}
      {specialFolderNames[folder.specialFolder]}
    {/if}
  </hbox>
  <hbox flex />
  {#if $folder.countNewArrived && isNormalFolderOrInbox}
    <hbox class="count">
      {$folder.countNewArrived}
    </hbox>
  {/if}
  <hbox class="buttons">
    <slot name="buttons" {folder} />
  </hbox>
</hbox>

<ContextMenu bind:this={contextMenu}>
  <FolderMenu {folder} />
</ContextMenu>

<script lang="ts">
  import { type Folder, SpecialFolder, specialFolderNames } from '../../../logic/Mail/Folder';
  import { onDropMail, onDragOverMail } from '../Message/drag';
  import FolderIcon from './FolderIcon.svelte';
  import FolderMenu from './FolderMenu.svelte';
  import ContextMenu from '../../Shared/Menu/ContextMenu.svelte';
  import { catchErrors } from '../../Util/error';
  import { gt } from '../../../l10n/l10n';
  import { appGlobal } from '../../../logic/app';

  export let folder: Folder;

  $: tooltip = gt`${folder.name}\n\n${$folder.countNewArrived} new, ${folder.countUnread} unread, ${folder.countTotal} total`;
  $: isNormalFolderOrInbox = !folder.specialFolder || folder.specialFolder == SpecialFolder.Normal || folder.specialFolder == SpecialFolder.Inbox;

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
    height: 20px; /* avoid line break */
    min-width: 0; /* avoid pushing out the buttons */
    overflow: hidden;
  }
  :global(.mobile) .label {
    height: 40px;
    align-items: center;
  }
  .count {
    justify-content: center;
    align-items: center;
    border-radius: 20px;
    /*border: 1px solid var(--border); -- too high */
    max-height: 20px;
    min-width: 12px;
    padding-inline: 4px;
    margin-inline-end: 8px;
    background-color: #ff000099;
    color: white;
    font-weight: bold;
  }
  .folder:hover .count {
    display: none;
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
