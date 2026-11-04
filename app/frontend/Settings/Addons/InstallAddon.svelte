<HeaderGroupBox classes="install-addon">
  <hbox slot="header">{existing ? $t`Update addon` : $t`Install addon`}</hbox>
  {#if !pkg}
    <grid class="source">
      <hbox class="source-label">{$t`From a file`}</hbox>
      <hbox class="source-input">
        <Button
          label={$t`Choose file`}
          icon={FileIcon}
          classes="choose-file"
          onClick={onChooseFile}
          errorCallback={showInstallError}
          />
      </hbox>
      <hbox class="source-label">{$t`From the internet`}</hbox>
      <hbox class="source-input">
        <input type="url" class="url" bind:value={url} placeholder="https://"
          on:keydown={event => event.key == "Enter" && catchErrors(onDownload, showInstallError)} />
        <Button
          label={$t`Download`}
          icon={DownloadIcon}
          classes="download"
          disabled={!url}
          onClick={onDownload}
          errorCallback={showInstallError}
          />
      </hbox>
    </grid>
  {:else}
    <vbox class="prompt">
      <div class="name">{pkg.manifest.name}</div>
      <grid class="facts">
        {#if pkg.manifest.author}
          <hbox class="fact-label">{$t`Author *=> of an addon`}</hbox>
          <div class="fact-value author">{pkg.manifest.author}</div>
        {/if}
        <hbox class="fact-label">{$t`Version`}</hbox>
        <div class="fact-value version">{pkg.manifest.version}</div>
        {#if existing}
          <hbox class="fact-label">{$t`Installed version`}</hbox>
          <div class="fact-value installed-version">{existing.manifest.version}</div>
        {/if}
        <hbox class="fact-label">{$t`Source *=> Where an addon comes from: its file name or URL`}</hbox>
        <div class="fact-value source">{pkg.source}</div>
      </grid>
      <hbox class="not-reviewed">
        <hbox class="not-reviewed-icon"><WarningIcon size="16px" /></hbox>
        <div>{$t`This addon has not been reviewed. Install it only if you trust its author.`}</div>
      </hbox>
      <vbox class="requested">
        <hbox class="requested-header">
          {#if existing && lines.hasItems}
            {$t`The new version can also *=> Followed by a list of what an addon is allowed to do`}
          {:else if existing}
            {$t`The new version needs no new permissions *=> An addon`}
          {:else if lines.hasItems}
            {$t`It can *=> Followed by a list of what an addon is allowed to do`}
          {:else}
            {$t`It needs no permissions *=> An addon`}
          {/if}
        </hbox>
        <AddonPermissions permissions={lines} />
      </vbox>
    </vbox>
  {/if}
  <div class="install-error">
    <ErrorMessageInline ex={installError} />
  </div>
  <hbox class="buttons">
    {#if pkg}
      <Button
        label={existing ? $t`Update *=> Install the new version of the addon` : $t`Install *=> an addon`}
        classes="install"
        onClick={onInstall}
        errorCallback={showInstallError}
        />
    {/if}
    <Button
      label={$t`Cancel`}
      classes="cancel"
      onClick={() => isOpen = false}
      />
  </hbox>
</HeaderGroupBox>

<FileSelector bind:this={fileSelector} acceptFileTypes={[".tgz", "application/gzip", "application/x-gzip"]} />

<script lang="ts">
  import type { Addon } from "../../../logic/Addons/Addon";
  import type { AddonPackage } from "../../../logic/Addons/AddonManifest";
  import { appGlobal } from "../../../logic/app";
  import AddonPermissions from "./AddonPermissions.svelte";
  import FileSelector from "../../Mail/Composer/Attachments/FileSelector.svelte";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import Button from "../../Shared/Button.svelte";
  import FileIcon from "lucide-svelte/icons/file-archive";
  import DownloadIcon from "lucide-svelte/icons/download";
  import WarningIcon from "lucide-svelte/icons/triangle-alert";
  import { catchErrors } from "../../Util/error";
  import { UserError } from "../../../logic/util/util";
  import type { ArrayColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let isOpen: boolean;
  export let selectedAddon: Addon | null;

  const installed = appGlobal.addons.installed;
  let fileSelector: FileSelector;
  let url = "";
  let pkg: AddonPackage | null = null;
  let installError: Error | null = null;

  $: existing = pkg ? $installed.find(addon => addon.id == pkg.manifest.id) : null;
  $: lines = pkg ? requestedPermissions(pkg, existing) : null;

  function requestedPermissions(pkg: AddonPackage, existing: Addon | null): ArrayColl<string> {
    if (existing) {
      return pkg.manifest.permissionsAddedTo(existing.grantedPermissions);
    }
    return pkg.manifest.requestedPermissions;
  }

  async function onChooseFile() {
    installError = null;
    let file = await fileSelector.selectFile();
    if (!file) {
      return;
    }
    let bytes = new Uint8Array(await file.arrayBuffer());
    showPrompt(await appGlobal.addons.readPackage(bytes, file.name));
  }

  async function onDownload() {
    installError = null;
    showPrompt(await appGlobal.addons.downloadPackage(url.trim()));
  }

  function showPrompt(newPackage: AddonPackage) {
    let manifest = newPackage.manifest;
    let installedAddon = appGlobal.addons.get(manifest.id);
    if (installedAddon && !manifest.isNewerThan(installedAddon.manifest)) {
      throw new UserError($t`Version ${manifest.version} is not newer than the installed version ${installedAddon.manifest.version}`);
    }
    pkg = newPackage;
  }

  async function onInstall() {
    installError = null;
    let manifest = pkg.manifest;
    try {
      if (existing) {
        await existing.update(pkg, lines);
      } else {
        await appGlobal.addons.install(pkg, lines);
      }
    } catch (ex) {
      // Installed, but it could not start. Its entry in the list shows why.
      if (appGlobal.addons.get(manifest.id)?.manifest != manifest) {
        throw ex;
      }
    }
    selectedAddon = appGlobal.addons.get(manifest.id) ?? null;
    isOpen = false;
  }

  function showInstallError(ex: Error) {
    installError = ex;
  }
</script>

<style>
  .source {
    grid-template-columns: max-content minmax(0, 1fr);
    column-gap: 16px;
    row-gap: 8px;
    align-items: center;
  }
  .source-input {
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .url {
    flex: 1 1 0;
    min-width: 0;
  }
  .prompt {
    gap: 12px;
    min-width: 0;
  }
  .name {
    font-size: 20px;
    font-weight: bold;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .facts {
    grid-template-columns: max-content minmax(0, 1fr);
    column-gap: 16px;
    row-gap: 4px;
  }
  .fact-label {
    opacity: 70%;
  }
  .fact-value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .not-reviewed {
    align-items: center;
    gap: 8px;
  }
  .not-reviewed-icon {
    flex: none;
  }
  .requested {
    gap: 4px;
  }
  .requested-header {
    font-weight: bold;
  }
  .install-error {
    max-height: 10em;
    overflow: auto;
    overflow-wrap: anywhere;
  }
  .buttons {
    justify-content: end;
    gap: 8px;
    margin-block-start: 12px;
  }
</style>
