<hbox class="action buttons">
  <Toolbar>
    <RoundButton
      onClick={onCopyLink}
      icon={LinkIcon}
      classes=""
      />
    <RoundButton
      onClick={onShare}
      icon={ShareIcon}
      classes=""
      disabled={$t`Not yet implemented`}
      />
    <RoundButton
      onClick={onOpenMoveMenu}
      icon={MoveIcon}
      classes=""
      disabled={$t`Not yet implemented`}
      />
    <RoundButton
      onClick={onDelete}
      icon={TrashIcon}
      classes="delete danger"
      />
  </Toolbar>
</hbox>
{#if toast}
  <hbox class="toast">
    <CheckIcon />
    {toast}
  </hbox>
{/if}

<script lang="ts">
  import type { FileOrDirectory } from "../../../logic/Files/FileOrDirectory";
  import { Directory } from "../../../logic/Files/Directory";
  import { selectedFile, selectedFolder } from "../selected";
  import Toolbar from "../../Shared/Toolbar/Toolbar.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import LinkIcon from "lucide-svelte/icons/link";
  import ShareIcon from "lucide-svelte/icons/share-2";
  import ShareMacIcon from "lucide-svelte/icons/share";
  import MoveIcon from "lucide-svelte/icons/folder-dot";
  import TrashIcon from "lucide-svelte/icons/trash-2";
  import CheckIcon from "lucide-svelte/icons/check";
  import { t } from "../../../l10n/l10n";

  export let file: FileOrDirectory;

  let toast: string | null = null;
  async function onCopyLink() {
    let url = await file.shareLink();
    await navigator.clipboard.writeText(url);
    toast = $t`Link copied to clipboard`;
    setTimeout(() => toast = null, 2000);
  }
  function onShare() {
  }
  function onOpenMoveMenu() {
  }
  async function onDelete() {
    if (file instanceof Directory && !confirm($t`Do you want to permanently delete the folder ${file.name} and all its files?`)) {
      return;
    }
    await file.deleteIt();

    if ($selectedFile == file) {
      $selectedFile = null;
    }
    if ($selectedFolder == file && file instanceof Directory) {
      $selectedFolder = file.parent;
    }
  }
</script>

<style>
  .buttons {
    justify-content: end;
    gap: 8px;
  }
  .toast {
    color: green;
  }
</style>
