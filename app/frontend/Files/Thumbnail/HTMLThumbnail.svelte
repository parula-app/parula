<iframe
  src={$file.url}
  title={$file.name}
  sandbox=""
  class:preview
  scrolling={preview ? "no" : null}
  />

<script lang="ts">
  import { File } from "../../../logic/Files/File";

  export let file: File;
  export let preview: boolean;
</script>

<script lang="ts" context="module">
  export const kSupportedExt = ["html", "htm", "shtml", "md", "txt"];
</script>

<style>
  iframe {
    border: none;
    width: 100%;
    height: 100%;
  }
  iframe.preview {
    pointer-events: none;
  }
</style>
