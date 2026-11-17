{#if !$file.isDownloaded}
  <FileIcon {ext} localFilePath={$file.path} {size} />
{:else if $file.url && kHTMLExt.includes(ext)}
  <HTMLThumbnail {file} {preview} />
{:else if $file.url && kPDFExt.includes(ext)}
  <PDFThumbnail {file} {preview} />
{:else if $file.url && kOfficeExt.includes(ext)}
  <OfficeThumbnail {file} {preview} />
{:else if $file.url && kAudioExt.includes(ext)}
  <AudioThumbnail {file} {preview} />
{:else if $file.url && kVideoExt.includes(ext)}
  <VideoThumbnail {file} {preview} />
{:else if $file.url && kImageExt.includes(ext)}
  <ImageThumbnail {file} {preview} />
{:else}
  <FileIcon {ext} localFilePath={$file.path} {size} />
{/if}

<script lang="ts">
  import { File } from "../../../logic/Files/File";
  import ImageThumbnail, { kSupportedExt as kImageExt} from "./ImageThumbnail.svelte";
  import VideoThumbnail, { kSupportedExt as kVideoExt} from "./VideoThumbnail.svelte";
  import AudioThumbnail, { kSupportedExt as kAudioExt} from "./AudioThumbnail.svelte";
  import HTMLThumbnail, { kSupportedExt as kHTMLExt} from "./HTMLThumbnail.svelte";
  import PDFThumbnail, { kSupportedExt as kPDFExt } from "./PDFThumbnail.svelte";
  import OfficeThumbnail, { kSupportedExt as kOfficeExt } from "./OfficeThumbnail.svelte";
  import FileIcon from "./FileIcon.svelte";

  /** TODO use mimetype */
  export let file: File;
  export let size = 16;
  export let preview: boolean;

  $: ext = file.ext;
</script>
