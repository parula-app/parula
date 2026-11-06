<hbox class="name-container">
  {#if isRenaming}
    <input type="text" bind:value={name}
      autofocus
      on:keydown={event => catchErrors(() => onKeyEnter(event, onRenameSave))}
      />
  {:else}
    <Clickable onDoubleClick={onRenameStart}>
      <hbox class="name">
        {$file.name}
      </hbox>
    </Clickable>
  {/if}
  <hbox flex />
  <hbox class="buttons">
    <RoundButton
      onClick={isRenaming ? onRenameSave : onRenameStart}
      icon={isRenaming ? OKIcon : PencilIcon}
      iconSize="16px"
      padding="6px"
      classes="rename plain"
      border={false}
      />
  </hbox>
</hbox>

<script lang="ts">
  import type { FileOrDirectory } from "../../../logic/Files/FileOrDirectory";
  import { File } from "../../../logic/Files/File";
  import { onKeyEnter } from "../../Util/util";
  import Clickable from "../../Shared/Clickable.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import PencilIcon from "lucide-svelte/icons/pencil";
  import OKIcon from "lucide-svelte/icons/check";
  import { catchErrors } from "../../Util/error";

  export let file: FileOrDirectory;

  let name = file.name;
  let isRenaming = false;
  function onRenameStart() {
    if (file instanceof File) {
      name = file.nameWithoutExt;
    } else {
      name = file.name;
    }
    isRenaming = true;
  }
  async function onRenameSave() {
    isRenaming = false;
    await file.rename(file instanceof File && file.ext ? name + "." + file.ext : name);
  }
</script>

<style>
  .name {
    font-size: 120%;
    font-weight: bold;
  }
  input {
    font-size: 120%;
    font-weight: bold;
  }
  .buttons {
    align-items: start;
  }
</style>
