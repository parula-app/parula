{#each $dirs?.each as dir (dir)}
  <DirectoryLine {dir} {indent} {showFolder} />
{/each}
<hbox class="separator" />
<hbox class="separator" />
<hbox class="separator" />
<hbox class="separator" />
{#if showFolder}
  <hbox class="separator" />
{/if}
{#each $files?.each as file (file)}
  <FileLine {file} {indent} {showFolder} />
{/each}

<script lang="ts">
  import { File } from "../../../logic/Files/File";
  import { Directory } from "../../../logic/Files/Directory";
  import DirectoryLine from "./DirectoryLine.svelte";
  import FileLine from "./FileLine.svelte";
  import type { Collection } from "svelte-collections";

  export let files: Collection<File>;
  export let dirs: Collection<Directory>;
  export let indent = 0;
  export let showFolder = false;
</script>

<style>
  .separator {
    min-height: 8px;
  }
</style>
