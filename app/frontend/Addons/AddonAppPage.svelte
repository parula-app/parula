{#if app instanceof AddonMustangApp}
  {#key app}
    <vbox flex class="addon-app-page">
      <AddonFrame addon={app.addon} entry={app.addonApp.entry} maxHeight={0} />
    </vbox>
  {/key}
{/if}

<script lang="ts">
  import type { MustangApp } from "../AppsBar/MustangApp";
  import { AddonMustangApp } from "./AddonMustangApp";
  import AddonFrame from "./AddonFrame.svelte";

  /** The app that the user opened. Shows it, if it's an app of an addon. */
  export let app: MustangApp;
</script>

<style>
  .addon-app-page {
    min-width: 0;
    min-height: 0;
  }
</style>
