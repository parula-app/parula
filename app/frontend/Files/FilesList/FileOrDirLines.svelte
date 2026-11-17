{#each $dirs?.each as dir (dir)}
  <DirectoryLine {dir} {indent} />
{/each}
<hbox class="separator" />
<hbox class="separator" />
<hbox class="separator" />
<hbox class="separator" />
{#each $files?.each as file (file)}
  <FileLine {file} {indent} />
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
</script>

<style>
  .separator {
    min-height: 8px;
  }
</style>
