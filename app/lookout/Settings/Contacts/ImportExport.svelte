<OptionsSection title={$t`Import and export`}>
  <OptionsRow icon={ImportExportIcon}>
    <hbox>{$t`Import contacts from a vCard file, or export an address book to a file for use in other programs`}</hbox>
    <hbox class="buttons">
      <DialogButton label={$t`Import…`} icon={ImportIcon} onClick={() => { wizardAction = "import-vcard"; }} />
      <DialogButton label={$t`Export…`} icon={ExportIcon} onClick={() => { wizardAction = "export"; }} />
    </hbox>
  </OptionsRow>
</OptionsSection>

{#if wizardAction}
  <ImportExportWizard preselected={account} action={wizardAction} on:close={() => { wizardAction = null; }} />
{/if}

<script lang="ts">
  import type { Addressbook } from "../../../logic/Contacts/Addressbook";
  import type { ImportExportAction } from "../SettingsDialogs";
  import OptionsSection from "../Shared/OptionsSection.svelte";
  import OptionsRow from "../Shared/OptionsRow.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import ImportExportWizard from "../ImportExport/ImportExportWizard.svelte";
  import ImportExportIcon from "lucide-svelte/icons/arrow-left-right";
  import ImportIcon from "lucide-svelte/icons/file-input";
  import ExportIcon from "lucide-svelte/icons/file-output";
  import { t } from "../../../l10n/l10n";

  export let account: Addressbook;

  let wizardAction: ImportExportAction | null = null;
</script>

<style>
  .buttons {
    gap: 8px;
  }
</style>
