{#if withURLbar}
  <hbox class="toolbar">
    <slot name="urlbar-left" />
    <hbox class="urlbar" flex>
      {getDomain(currentURL)}
    </hbox>
    <hbox class="buttons right">
      <hbox class="loading">
        {#if isLoading}
          <Loader />
        {/if}
      </hbox>
      <RoundButton
        label={$t`Close`}
        icon={CloseIcon}
        onClick={onClose}
        classes="small"
        />
    </hbox>
  </hbox>
{/if}

// #if [!WEBMAIL && !MOBILE]
<webview bind:this={webviewE} src={url} {title} {partition} />
// #else
<iframe bind:this={webviewE} src={url} {title} sandbox="allow-scripts allow-forms" />
// #endif

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import RoundButton from './RoundButton.svelte';
  import Loader from './Loader.svelte';
  import CloseIcon from "lucide-svelte/icons/x";
  import { getBaseDomainFromHost } from '../../logic/util/netUtil';
  import { logErrorToServer } from '../Util/error';
  import type { URLString } from '../../logic/util/util';
  import { t } from '../../l10n/l10n';
  const dispatch = createEventDispatcher();

  /**
   * Displays untrusted HTML in a sandboxed iframe which does not allow any JavaScript.
   * Desktop: Which permissions the page gets, e.g. for the camera or the location,
   * decides `restrictPermissions()` in `desktop/src/main/index.ts`.
   */

  /** The start webpage to show. */
  export let url: URLString = "";
  /** Tooltip when hovering */
  export let title: string;
  /** The cookie storage. For `<webview partition="persist:...">` */
  export let sessionID: string;
  export let withURLbar = true;
  export let autofill: string;

  $: partition = sessionID ? "persist:" + sessionID : undefined;

  function getDomain(url: URLString) {
    if (!url) {
      return "";
    }
    return getBaseDomainFromHost(new URL(url).hostname);
  }

  let isLoading = true;
  let currentURL: URLString = url;

  let webviewE: HTMLIFrameElement = null;
  $: webviewE && haveWebView();
  function haveWebView () {
    webviewE.addEventListener("dom-ready", () => {
      currentURL = webviewE.src;
      dispatch("page-change", webviewE.src);
    });
    webviewE.addEventListener("did-start-loading", () => {
      isLoading = true;
    });
    webviewE.addEventListener("did-stop-loading", () => {
      isLoading = false;
      if (autofill) {
        webviewE.executeJavaScript(autofill)
          .catch(logErrorToServer); // Some login pages refuse our script. TODO log getDomain()?
      }
    });
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  webview {
    flex: 1 0 0;
  }
  .toolbar {
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
    border-bottom: 1px solid var(--border);
    align-items: center;
    padding: 2px 12px;
  }
  .urlbar {
    justify-content: center;
    overflow: hidden;
    overflow-wrap: anywhere;
    text-overflow: ellipsis;
    height: 24px;
    padding: 2px 12px;
  }
  .buttons {
    align-items: center;
    justify-content: center;
    margin: 2px;
  }
  .buttons :global(> *) {
    margin-inline-start: 6px;
  }
  .loading {
    width: 24px;
  }
</style>
