<vbox class="permissions">
  {#if isLoading}
    <hbox class="lo-secondary">{$t`Loading…`}</hbox>
  {/if}
  <ListView items={permissions.entries} bind:selected
    columns={[{ label: $t`Name` }, { label: $t`Permission Level`, width: "200px" }]}
    label={$t`Permissions *=> Who can access this folder`} height="150px" let:item>
    <span title={item.person.emailAddress}>{item.name}</span>
    <span title={item.level ? null : $t`The server doesn't tell the permission level of existing permissions`}>
      {item.level ? FolderPermissions.levelLabel(item.level) : "–"}
    </span>
    <span slot="empty">{$t`You have not given anybody access yet`}</span>
  </ListView>
  <hbox class="list-buttons">
    <DialogButton label={$t`Add… *=> Give another person access to this folder`} onClick={() => { isAdding = true; }} />
    <DialogButton label={$t`Remove`} disabled={!selected && $t`Select a person first`} onClick={onRemove} />
  </hbox>
  <GroupBox label={$t`Permissions *=> Rights of the selected person for this folder`} disabled={!selected}>
    <hbox class="level-row">
      <span>{$t`Permission Level`}</span>
      <ComboBox label={$t`Permission Level`} options={levelOptions} value={selected?.level ?? null}
        placeholder={selected && !selected.level ? "–" : null}
        disabled={!selected && $t`Select a person first`}
        on:change={event => { permissions.setLevel(selected, event.detail); changed(); }} width="100%" />
    </hbox>
    <grid class="rights">
      <GroupBox label={$t`Read *=> in the sense of to read emails`} disabled={!canEditRights}>
        {#each [Right.Read] as right}
          <Checkbox label={FolderPermissions.rightLabel(right)} checked={has(selected, right, version)}
            disabled={!canEditRights} on:change={event => setRight(right, event.detail)} />
        {/each}
      </GroupBox>
      <GroupBox label={$t`Write *=> Permissions to create and change items`} disabled={!canEditRights}>
        {#each [Right.Create, Right.CreateSubfolders, Right.FlagChange] as right}
          <Checkbox label={FolderPermissions.rightLabel(right)} checked={has(selected, right, version)}
            disabled={!canEditRights} on:change={event => setRight(right, event.detail)} />
        {/each}
      </GroupBox>
      <GroupBox label={$t`Delete items`} disabled={!canEditRights}>
        {#each [Right.Delete] as right}
          <Checkbox label={FolderPermissions.rightLabel(right)} checked={has(selected, right, version)}
            disabled={!canEditRights} on:change={event => setRight(right, event.detail)} />
        {/each}
      </GroupBox>
      <GroupBox label={$t`Other`} disabled={!canEditRights}>
        {#each [Right.DeleteFolder] as right}
          <Checkbox label={FolderPermissions.rightLabel(right)} checked={has(selected, right, version)}
            disabled={!canEditRights} on:change={event => setRight(right, event.detail)} />
        {/each}
      </GroupBox>
    </grid>
  </GroupBox>
  <hbox class="scope">
    <Radio label={$t`This folder`} bind:group={permissions.allFolders} value={false} />
    <Checkbox label={$t`Include subfolders`} bind:checked={permissions.includeSubfolders}
      disabled={permissions.allFolders} />
    <Radio label={$t`All folders of ${permissions.account.name}`} bind:group={permissions.allFolders} value={true} />
  </hbox>
</vbox>
{#if isAdding}
  <SelectNamesDialog title={$t`Add Users`} persons={addedPersons} label={$t`Add`}
    on:ok={onAdded} on:close={() => { isAdding = false; }} />
{/if}

<script lang="ts">
  import { MailShareCombinedPermissions, MailShareIndividualPermissions as Right } from "../../../logic/Mail/Folder";
  import { FolderPermissions, type FolderPermission } from "./FolderPermissions";
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import { ArrayColl } from "svelte-collections";
  import SelectNamesDialog from "../Composer/SelectNamesDialog.svelte";
  import ListView from "../../Shared/Form/ListView.svelte";
  import GroupBox from "../../Shared/Form/GroupBox.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import Radio from "../../Shared/Form/Radio.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import { catchErrors, showError } from "../../../frontend/Util/error";
  import { createEventDispatcher, onMount } from "svelte";
  import { t } from "../../../l10n/l10n";
  const dispatch = createEventDispatcher<{ change: void }>();

  export let permissions: FolderPermissions;

  let selected: FolderPermission = null;
  let isLoading = true;
  let isAdding = false;
  let addedPersons = new ArrayColl<PersonUID>();
  let version = 0;

  $: levelOptions = permissions.account.sharePermissionLevels
    .map(level => ({ value: level, label: FolderPermissions.levelLabel(level) }));
  $: canEditRights = !!selected && permissions.account.sharePermissionLevels.includes(MailShareCombinedPermissions.Custom);

  onMount(() => catchErrors(load));
  async function load() {
    try {
      await permissions.load();
      permissions = permissions;
    } finally {
      isLoading = false;
    }
  }

  function has(entry: FolderPermission, right: Right, _version: number): boolean {
    return !!entry?.rights.includes(right);
  }

  function setRight(right: Right, granted: boolean) {
    permissions.setRight(selected, right, granted);
    changed();
  }

  function changed() {
    version++;
    permissions = permissions;
    selected = selected;
    dispatch("change");
  }

  function onAdded() {
    for (let person of addedPersons.contents) {
      try {
        selected = permissions.add(person);
      } catch (ex) {
        showError(ex);
      }
    }
    addedPersons = new ArrayColl<PersonUID>();
    changed();
  }

  function onRemove() {
    permissions.remove(selected);
    selected = null;
    changed();
  }
</script>

<style>
  .permissions {
    gap: 8px;
    padding-top: 16px;
  }
  .list-buttons {
    justify-content: center;
    gap: 8px;
  }
  .level-row {
    align-items: center;
    gap: 12px;
    white-space: nowrap;
  }
  .rights {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 6px;
  }
  .scope {
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
</style>
