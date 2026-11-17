{#each $dirs?.each as dir (dir)}
  <DirectoryTile {dir} />
{/each}
<hbox class="linebreak" />
{#each $files?.each as file (file)}
  <FileTile {file} />
{/each}

<script lang="ts">
  import { File } from "../../../logic/Files/File";
  import { Directory } from "../../../logic/Files/Directory";
  import DirectoryTile from "./DirectoryTile.svelte";
  import FileTile from "./FileTile.svelte";
  import type { Collection } from "svelte-collections";

  export let files: Collection<File>;
  export let dirs: Collection<Directory>;
</script>

<style>
  .linebreak {
    width: 100%;
    height: 0;
    margin-top: 48px;
  }
</style>
