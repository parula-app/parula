<ButtonMenu>
  <MenuItem
    onClick={openExternal}
    label={$t`Open in external app`}
    tooltip={$t`Open in external application`}
    disabled={executable ?? !$attachment.filepathLocal}
    icon={OpenIcon} />
  <MenuItem
    onClick={openFolder}
    label={$t`Open folder`}
    tooltip={$t`Open containing folder`}
    disabled={!$attachment.filepathLocal}
    icon={FolderIcon} />
  <MenuItem
    onClick={saveFile}
    label={$t`Save as`}
    tooltip={$t`Save in a folder on your computer`}
    icon={SaveIcon} />
  <!--
  <MenuItem
    onClick={deleteIt}
    label=$t`Delete this attachment`
    tooltip=$t`Delete`
    icon={DeleteIcon} />
  -->
</ButtonMenu>

<script lang="ts">
  import type { Attachment } from "../../../logic/Abstract/Attachment";
  import { executableMessage } from "../../../logic/Files/FileType/ExecutableFile";
  import { saveBlobAsFile } from "../../Util/util";
  import ButtonMenu from "../../Shared/Menu/ButtonMenu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import OpenIcon from "lucide-svelte/icons/external-link";
  import FolderIcon from "lucide-svelte/icons/folder";
  import SaveIcon from "lucide-svelte/icons/save";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import { t } from "../../../l10n/l10n";

  export let attachment: Attachment;

  /** Why we refuse to open it. null = safe. */
  $: executable = $attachment.executable ? executableMessage($attachment.executable) : null;

  async function openExternal() {
    await attachment.openOSApp();
  }
  async function openFolder() {
    await attachment.openOSFolder();
  }
  async function saveFile() {
    await saveBlobAsFile(await attachment.getContent());
  }
  async function deleteIt() {
    await attachment.deleteFile();
  }
</script>
