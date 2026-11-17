<iframe
  src={pdfURL}
  title={$file.name}
  class:preview
  scrolling={preview ? "no" : null}
  />

<script lang="ts">
  import { File } from "../../../logic/Files/File";
  import type { URLString } from "../../../logic/util/util";
  import { onDestroy } from "svelte";

  export let file: File;
  export let preview: boolean;

  /** With `sandbox`, PDFs render blank, so no sandbox.
   * Chromium does not run its PDF viewer in a sandboxed frame, and the viewer
   * is the browser's own, so the PDF never gets our origin. */

  /** `file.url` carries the MIME type that the sender declared. Give the frame
   * a `blob:` that is `application/pdf` no matter what, so that a `.pdf` attachment
   * declared as `text/html` cannot render as HTML with our origin. */
  let pdfURL: URLString | null = null;
  $: file, makePDFURL();
  function makePDFURL() {
    if (pdfURL) {
      URL.revokeObjectURL(pdfURL);
    }
    let contents = file.contents;
    pdfURL = contents ? URL.createObjectURL(contents.slice(0, contents.size, "application/pdf")) : null;
  }

  onDestroy(() => {
    if (pdfURL) {
      URL.revokeObjectURL(pdfURL);
    }
  });
</script>

<script lang="ts" context="module">
  export const kSupportedExt = ["pdf"];
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
