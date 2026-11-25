<MenuItem
  onClick={deleteFolder}
  label={$t`Delete folder`}
  classes="danger"
  icon={DeleteIcon} />
<MenuDivider />

<script lang="ts">
  import type { Directory } from '../../../logic/Files/Directory';
  import { selectedFolder } from '../selected';
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuLabel from "../../Shared/Menu/MenuLabel.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import { t } from "../../../l10n/l10n";

  export let folder: Directory;

  async function deleteFolder() {
    if (!confirm($t`Do you want to permanently delete the folder ${folder.name} and all its files?`)) {
      return;
    }
    await folder.deleteIt();

    if ($selectedFolder == folder) {
      $selectedFolder = null;
    }
  }
</script>
