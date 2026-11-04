<Clickable onClick={onSelect} onDoubleClick={() => openFileInDefaultApp(file)}>
  <vbox class="file box"
    class:selected={file == $selectedFile}
    draggable="true"
    on:dragstart={event => catchErrors(() => onDragStartFile(event, file))}>
    <vbox class="tile">
      <button class="icon">
        <Thumbnail {file} size={48} preview />
      </button>
    </vbox>
    <vbox class="info">
      <hbox class="name">
        {$file?.name}
      </hbox>
      <hbox class="second">
        <hbox flex />
        <hbox class="time font-smallest">
          {$file?.lastMod ? getDateTimeString($file.lastMod) : ""}
        </hbox>
      </hbox>
    </vbox>
  </vbox>
</Clickable>

<script lang="ts">
  import { File } from "../../../logic/Files/File";
  import { canShowPreview, openFileInDefaultApp } from "../file";
  import { selectedFile } from "../selected";
  import { onDragStartFile } from "../drag";
  import Clickable from "../../Shared/Clickable.svelte";
  import Thumbnail from "../Thumbnail/Thumbnail.svelte";
  import { getDateTimeString } from "../../../logic/util/date";
  import { catchErrors } from "../../Util/error";

  export let file: File;

  $: catchErrors(async () => canShowPreview(file) && file.getURL(), console.error);

  function onSelect() {
    $selectedFile = file;
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
    border: none;
    background-color: transparent;
    padding-inline: 0px;
    margin-block-start: 2px;
    overflow: hidden;
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
    overflow-wrap: anywhere;
  }
  .time {
    padding-inline-end: 16px;
    justify-content: end;
    min-width: 5em;
    opacity: 50%;
    font-weight: 300;
  }
</style>
