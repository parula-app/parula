<Dialog title={$t`About ${appName}`} width="440px" cancelLabel={$t`OK`} on:close>
  <hbox class="about">
    <span class="logo">{@html logo}</span>
    <vbox class="text">
      <span class="name">{appName}</span>
      <span>{$t`Version ${appVersion}`}</span>
      <span class="lo-secondary">{$t`Copyright 2024 Ben Bucksch, ${company}, and other contributors`}</span>
      <a href={siteRoot} target="_blank">{siteRoot}</a>
    </vbox>
  </hbox>
</Dialog>

<script lang="ts">
  import { appName, appVersion, siteRoot } from "../../../logic/build";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import logo from "../../../frontend/asset/icon/general/logo.svg?raw";
  import { t } from "../../../l10n/l10n";

  // <copied from="../../../frontend/Settings/About/About.svelte">
  const company = appName == "Parula" || appName == "Lookout" ? "Beonex GmbH" : "Mustang GmbH";
  // </copied>
</script>

<style>
  .about {
    align-items: start;
    gap: 16px;
  }
  .logo {
    display: flex;
    flex: none;
    width: 56px;
    height: 56px;
  }
  .logo :global(svg) {
    width: 100%;
    height: 100%;
  }
  .logo :global(.horse),
  .logo :global(.circle-bars) {
    fill: var(--lo-accent);
    stroke: var(--lo-accent);
  }
  .text {
    gap: 4px;
  }
  .name {
    font-size: 20px;
    font-weight: 600;
  }
  a {
    color: var(--lo-accent-text);
  }
</style>
