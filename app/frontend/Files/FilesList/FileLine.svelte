<Clickable onClick={onSelect} onDoubleClick={() => openFileInDefaultApp(file)}>
  <hbox class="file line"
    class:selected={file == $selectedFile}
    on:dragstart={event => catchErrors(() => onDragStartFile(event, file))}>
    <hbox class="firstColumn" draggable="true">
      {#each {length: indent} as _}
        <hbox class="indention" />
      {/each}
      <button class="icon">
        <FileIcon ext={$file.ext} localFilePath={$file.path} />
      </button>
      <hbox class="name">
        {$file.nameWithoutExt}
      </hbox>
    </hbox>
    <hbox class="type" draggable="true">
      {$file.ext}
    </hbox>
    <hbox class="size" draggable="true">
      {fileSize($file.size)}
    </hbox>
    <hbox class="time" draggable="true">
      {getDateTimeString($file.lastMod)}
    </hbox>
  </hbox>
</Clickable>

<script lang="ts">
  import { File } from "../../../logic/Files/File";
  import { openFileInDefaultApp, fileSize } from "../file";
  import { selectedFile } from "../selected";
  import { onDragStartFile } from "../drag";
  import { getDateTimeString } from "../../../logic/util/date";
  import Clickable from "../../Shared/Clickable.svelte";
  import FileIcon from "../Thumbnail/FileIcon.svelte";
  import { catchErrors } from "../../Util/error";

  export let file: File;
  export let indent = 0;

  function onSelect() {
    $selectedFile = file;
  }
</script>

<style>
  .line {
    display: contents;
  }
  .line:hover:not(.selected) > * {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .line.selected > * {
    background-color: var(--selected-bg);
    color: var(--selected-fg);
  }
  .name, .type, .size, .time {
    padding-inline-start: 8px;
    padding-inline-end: 8px;
  }
  .icon {
    padding-inline-start: 16px;
    padding-inline-end: 0px;
    margin-block-start: 2px;
  }
  .icon :global(svg) {
    stroke-width: 1.5px;
  }
  .time {
    padding-inline-end: 16px;
  }
  .icon {
    align-self: center;
    border: none;
    background-color: transparent;
  }
  .indention {
    margin-inline-start: 16px;
  }
  .type {
    min-width: 3.5em;
  }
  .size {
    justify-content: end;
    min-width: 8em;
  }
  .time {
    justify-content: end;
    min-width: 5em;
  }
  .type, .size, .time {
    color: #91939D;
    font-size: 90%;
    font-weight: 300;
  }
</style>
