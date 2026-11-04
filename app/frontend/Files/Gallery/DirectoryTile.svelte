<Clickable onClick={toggleOpen}>
  <vbox class="directory box"
    class:selected={dir == $selectedFile}
    on:drop={event => catchErrors(() => onDropFile(event, dir))}
    on:dragover={event => catchErrors(() => onDragOverFile(event, dir))}>
    <vbox class="tile">
      <button class="icon">
        {#if open}
          📁
          <!--📂-->
        {:else}
          📁
        {/if}
      </button>
    </vbox>
    <vbox class="info">
      <hbox class="name">
        {$dir?.name}
      </hbox>
      <hbox class="second">
        <hbox flex />
        <hbox class="time font-smallest">
          {$dir?.lastMod ? getDateTimeString($dir.lastMod) : ""}
        </hbox>
      </hbox>
    </vbox>
  </vbox>

</Clickable>

<script lang="ts">
  import { Directory } from "../../../logic/Files/Directory";
  import { selectedFolder, selectedFile } from "../selected";
  import { onDropFile, onDragOverFile } from "../drag";
  import Clickable from "../../Shared/Clickable.svelte";
  import FolderClosedIcon from "lucide-svelte/icons/folder";
  import FolderOpenIcon from "lucide-svelte/icons/folder-open";
  import { getDateTimeString } from "../../../logic/util/date";
  import { catchErrors } from "../../Util/error";

  export let dir: Directory;

  function toggleOpen() {
    $selectedFolder = dir;
    dir.listContents()
      .catch(console.error);
  }
</script>

<style>
  .box:hover {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .tile {
    align-items: center;
    justify-content: center;
    width: 192px;
    height: 144px;
  }
  .icon {
    align-self: center;
    opacity: 60%;
    border: none;
    font-size: 5vw;
    background-color: transparent;
    padding-inline-start: 16px;
    padding-inline-end: 0px;
    margin-block-start: 2px;
  }
  .icon :global(svg) {
    stroke-width: 1.5px;
  }
  .info {
    max-width: 176px;
    padding-block: 4px;
    padding-inline: 8px;
  }
  .name, .second {
    max-height: 20px;
    overflow: hidden;
  }
  .time {
    padding-inline-end: 16px;
    justify-content: end;
    min-width: 5em;
    opacity: 50%;
    font-weight: 300;
  }
</style>
