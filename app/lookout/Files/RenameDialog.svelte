<Dialog title={file instanceof Directory ? $t`Rename Folder` : $t`Rename File`}
  okLabel={$t`Rename`}
  okDisabled={!name.trim() && $t`Enter a name`}
  onOK={onOK}
  width="420px"
  on:close>
  <FormGrid>
    <span>{$t`New name`}</span>
    <TextField bind:value={name} label={$t`New name`} />
  </FormGrid>
</Dialog>

<script lang="ts">
  import type { FileOrDirectory } from "../../logic/Files/FileOrDirectory";
  import { Directory } from "../../logic/Files/Directory";
  import Dialog from "../Shared/Dialog/Dialog.svelte";
  import FormGrid from "../Shared/Form/FormGrid.svelte";
  import TextField from "../Shared/Form/TextField.svelte";
  import { t } from "../../l10n/l10n";

  export let file: FileOrDirectory;

  let name = file.name;

  async function onOK() {
    await file.rename(name.trim());
  }
</script>
