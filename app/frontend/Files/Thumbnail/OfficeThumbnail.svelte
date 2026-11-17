{#await convert(file)}
{:then dataURL}
  <iframe
    src={dataURL}
    title={$file.name}
    sandbox=""
    class:preview
    scrolling={preview ? "no" : null}
    />
{/await}

<script lang="ts">
  import type { File } from "../../../logic/Files/File";
  import { odtToHTML } from "../../../logic/Files/FileType/ODT";
  import { docxToHTML } from "../../../logic/Files/FileType/MSWord";
  import { stringToDataURL } from "../../Util/util";

  /** @returns data: URL with file content as HTML */
  async function convert(file: File): Promise<string> {
    let html: string;
    if (file.ext == "odt") {
      html = await odtToHTML(file.contents);
    } else if (file.ext == "docx") {
      html = await docxToHTML(file.contents);
    }
    return await stringToDataURL("text/html", html)
  }

  export let file: File;
  export let preview: boolean;
</script>

<script lang="ts" context="module">
  export const kSupportedExt = ["docx", "odt"];
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
