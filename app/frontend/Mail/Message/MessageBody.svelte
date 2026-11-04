<vbox flex class="message-body">
  {#if !$message.loadedBody}
    {#await message.loadBody()}
      {#await sleep(1)}
        <hbox></hbox>
      {:then}
        {$t`Loading...`}
      {/await}
    {:catch ex}
      <ErrorMessage {ex} />
    {/await}
  {:else if mode == DisplayMode.HTML}
    <HTMLDisplay html={$message.html} allowExternalImages={false} />
  {:else if mode == DisplayMode.HTMLWithExternal}
    <HTMLDisplay html={$message.html} allowExternalImages={true} />
  {:else if mode == DisplayMode.Plaintext}
    <PlaintextDisplay plaintext={$message.text} />
    <!--<HTMLDisplay html={convertTextToHTML($message.text)} />-->
  {:else if mode == DisplayMode.Source}
    {#await message.loadMIME()}
      {$t`Loading...`}
    {:then}
      <PlaintextDisplay plaintext={getSource($message)} />
    {/await}
  {:else if mode == DisplayMode.Thread}
    <ChatDisplay {message} />
  {:else}
    {$t`Unknown display mode`}
  {/if}
</vbox>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { getLocalStorage } from "../../Util/LocalStorage";
  import HTMLDisplay from "./HTMLDisplay.svelte";
  import PlaintextDisplay from "./PlaintextDisplay.svelte";
  import ChatDisplay from "./ChatDisplay.svelte";
  import ErrorMessage from "../../Shared/ErrorMessageInline.svelte";
  import { sleep } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;

  let modeSetting = getLocalStorage("mail.contentRendering", "html");
  // <copied from="DisplayModeSwitcher.svelte">
  $: mode = $modeSetting.value == DisplayMode.HTML && $message.loadExternalImagesFromSender() ? DisplayMode.HTMLWithExternal : $modeSetting.value as DisplayMode;
  // </copied>
  $: message.loadExternalImages = mode == DisplayMode.HTMLWithExternal;

  function getSource(message: EMail): string {
    if (!message.mime) {
      return $t`Source not available`;
    }
    return new TextDecoder().decode($message.mime);
  }
</script>

<script lang="ts" context="module">
  export enum DisplayMode {
    HTML = "html",
    HTMLWithExternal = "with-external",
    Plaintext = "plaintext",
    Source = "source",
    Thread = "thread",
  }
</script>
