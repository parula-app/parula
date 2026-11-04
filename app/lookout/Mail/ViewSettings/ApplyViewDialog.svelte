<Dialog title={$t`Apply View`} okLabel={$t`OK`} okDisabled={!checked.size && $t`Choose at least one folder`}
  onOK={save} width="420px" on:close>
  <vbox class="apply-view">
    <span>{$t`Apply view to these folders`}</span>
    <vbox class="folder-list">
      {#each $accounts.each as account (account.id)}
        <hbox class="account">{account.name}</hbox>
        {#each flatten(account.rootFolders.contents, 0) as entry (entry.folder)}
          <hbox class="folder" style:padding-inline-start={12 + entry.depth * 16 + "px"}>
            <Checkbox label={FolderTreeActions.displayName(entry.folder)}
              checked={checked.has(entry.folder)}
              disabled={entry.folder == folder}
              on:change={event => toggle(entry.folder, event.detail)} />
          </hbox>
        {/each}
      {/each}
    </vbox>
    <Checkbox label={$t`Apply view to subfolders`} bind:checked={withSubfolders} />
  </vbox>
</Dialog>

<script lang="ts" context="module">
  import type { Folder } from "../../../logic/Mail/Folder";
  import { writable } from "svelte/store";

  export const openApplyView = writable<{ folder: Folder | null } | null>(null);
</script>

<script lang="ts">
  import { appGlobal } from "../../../logic/app";
  import { applyViewSettingsToFolders } from "./ViewSettings";
  import { FolderTreeActions } from "../LeftPane/FolderTreeActions";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import { t } from "../../../l10n/l10n";

  export let folder: Folder | null;

  const accounts = appGlobal.emailAccounts;
  let checked = new Set<Folder>();
  let withSubfolders = false;

  function flatten(folders: Folder[], depth: number): { folder: Folder, depth: number }[] {
    let result: { folder: Folder, depth: number }[] = [];
    for (let child of folders) {
      result.push({ folder: child, depth });
      result.push(...flatten(child.subFolders.contents, depth + 1));
    }
    return result;
  }

  function toggle(target: Folder, isChecked: boolean) {
    if (isChecked) {
      checked.add(target);
    } else {
      checked.delete(target);
    }
    checked = checked;
  }

  function save() {
    let targets = [...checked];
    if (withSubfolders) {
      for (let target of [...checked]) {
        targets.push(...flatten(target.subFolders.contents, 0).map(entry => entry.folder));
      }
    }
    applyViewSettingsToFolders(folder, targets.filter(target => target != folder));
  }
</script>

<style>
  .apply-view {
    gap: 8px;
  }
  .folder-list {
    height: 280px;
    overflow-y: auto;
    padding: 4px 0;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
  }
  .account {
    padding: 6px 8px 2px 8px;
    font-weight: 600;
    font-size: 13px;
  }
  .folder {
    min-height: 26px;
    align-items: center;
  }
</style>
