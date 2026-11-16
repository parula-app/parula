<WebView url={app.start} title={app.nameTranslated} {hidden} sessionID={app.webSessionID} />

<script lang="ts">
  import type { WebAppListed } from "../../../logic/WebApps/WebAppListed";
  import WebView from "../../Shared/WebView.svelte";

  export let app: WebAppListed;
  export let hidden = false;
</script>
