<vbox class="general">
  <hbox class="name-row">
    <span class="folder-icon"><FolderIcon size={32} strokeWidth={1.5} /></span>
    <TextField label={$t`Name`} bind:value={name} disabled={$folder.disableRename()} />
  </hbox>
  <hbox class="separator" />
  <FormGrid columns="90px minmax(0, 1fr)">
    <span class="lo-form-label">{$t`Type *=> Type of the folder`}</span>
    <span>{$t`Folder containing Mail Items`}</span>
    <span class="lo-form-label">{$t`Location *=> Where the folder is in the folder tree`}</span>
    <span class="location" title={location}>{location}</span>
    <span class="lo-form-label">{$t`Use as`}</span>
    <hbox>
      <ComboBox label={$t`Use as`} options={specialFolderOptions} bind:value={specialFolder}
        disabled={$folder.disableChangeSpecial()} width="220px" />
    </hbox>
  </FormGrid>
  <hbox class="separator" />
  <vbox class="count-mode">
    <Radio label={$t`Show number of unread items`} bind:group={countMode} value={FolderCountMode.Unread} />
    <Radio label={$t`Show total number of items`} bind:group={countMode} value={FolderCountMode.Total} />
  </vbox>
</vbox>

<script lang="ts">
  import { SpecialFolder, specialFolderNames, specialFolderOrder, type Folder } from "../../../logic/Mail/Folder";
  import { FolderCountMode } from "../LeftPane/FolderTreeActions";
  import FormGrid from "../../Shared/Form/FormGrid.svelte";
  import TextField from "../../Shared/Form/TextField.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import Radio from "../../Shared/Form/Radio.svelte";
  import type { ComboOption } from "../../Shared/Form/ComboOption";
  import FolderIcon from "lucide-svelte/icons/folder";
  import { t } from "../../../l10n/l10n";

  export let folder: Folder;
  export let name: string;
  export let specialFolder: SpecialFolder;
  export let countMode: FolderCountMode;

  const specialFolderOptions: ComboOption<SpecialFolder>[] = specialFolderOrder
    .map(type => ({ value: type, label: specialFolderNames[type] }));

  $: location = "\\\\" + [folder.account?.name, ...parentNames(folder)].join("\\");

  function parentNames(child: Folder): string[] {
    let names: string[] = [];
    for (let parent = child.parent; parent; parent = parent.parent) {
      names.unshift(parent.name);
    }
    return names;
  }
</script>

<style>
  .general {
    gap: 12px;
    padding-top: 16px;
  }
  .name-row {
    align-items: center;
    gap: 16px;
  }
  .name-row > :global(.lo-field) {
    flex: 1 1 auto;
  }
  .folder-icon {
    display: flex;
    color: var(--lo-accent-text);
  }
  .separator {
    border-block-start: 1px solid var(--lo-divider);
  }
  .location {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .count-mode {
    gap: 4px;
  }
</style>
