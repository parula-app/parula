<WebView url={app.startWithLogin} title={app.nameTranslated} {hidden} sessionID={app.webSessionID} on:hide />

<script lang="ts">
  import type { WebAppListed } from "../../../logic/WebApps/WebAppListed";
  import WebView from "../../Shared/WebView.svelte";

  export let app: WebAppListed;
  export let hidden = false;
</script>
