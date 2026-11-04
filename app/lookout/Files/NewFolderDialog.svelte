<Dialog title={$t`New Folder`}
  okLabel={$t`Create *=> Create the new folder`}
  okDisabled={!name.trim() && $t`Enter a name`}
  onOK={onOK}
  width="420px"
  on:close>
  <FormGrid>
    <span>{$t`Name *=> Name of the new folder`}</span>
    <TextField bind:value={name} label={$t`Name *=> Name of the new folder`} />
  </FormGrid>
</Dialog>

<script lang="ts">
  import type { Directory } from "../../logic/Files/Directory";
  import Dialog from "../Shared/Dialog/Dialog.svelte";
  import FormGrid from "../Shared/Form/FormGrid.svelte";
  import TextField from "../Shared/Form/TextField.svelte";
  import { t } from "../../l10n/l10n";

  export let parent: Directory;

  let name = $t`New Folder`;

  async function onOK() {
    await parent.createSubDirectory(name.trim());
  }
</script>
