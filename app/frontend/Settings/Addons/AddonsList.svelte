<vbox flex class="addons-page">
  <PageHeader title={$t`Addons`} subtitle={$t`Addons add functions to ${appName}. Each addon can do only what you allowed when you installed it.`}>
    <hbox slot="buttons-top-right">
      {#if !isMobile && !isInstalling}
        <Button
          label={$t`Install addon`}
          icon={InstallIcon}
          classes="install-addon"
          onClick={() => isInstalling = true}
          />
      {/if}
    </hbox>
  </PageHeader>

  {#if isMobile}
    <hbox class="not-available">{$t`Addons are not available on mobile yet`}</hbox>
  {:else}
    {#if isInstalling}
      <InstallAddon bind:isOpen={isInstalling} bind:selectedAddon />
    {/if}
    <vbox class="addons">
      {#each $installed.each as addon (addon)}
        <AddonsListItem {addon} bind:selectedAddon />
      {:else}
        <hbox class="empty">{$t`No addons installed`}</hbox>
      {/each}
    </vbox>
  {/if}
</vbox>

<script lang="ts">
  import type { Addon } from "../../../logic/Addons/Addon";
  import { appGlobal } from "../../../logic/app";
  import { appName, isMobile } from "../../../logic/build";
  import AddonsListItem from "./AddonsListItem.svelte";
  import InstallAddon from "./InstallAddon.svelte";
  import PageHeader from "../Shared/PageHeader.svelte";
  import Button from "../../Shared/Button.svelte";
  import InstallIcon from "lucide-svelte/icons/package-plus";
  import { t } from "../../../l10n/l10n";

  const installed = appGlobal.addons.installed;
  let isInstalling = false;
  let selectedAddon: Addon | null = null;
</script>

<style>
  .addons-page {
    min-width: 0;
  }
  .not-available,
  .empty {
    margin-block-start: 24px;
    opacity: 70%;
  }
  .addons {
    margin-block-start: 24px;
    min-width: 0;
  }
</style>
