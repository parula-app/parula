<OptionsPage icon={FilesIcon} description={$t`Change how you share files`}>
  <OptionsSection title={$t`File sharing accounts`}>
    <OptionsRow icon={ShareIcon}>
      <span>{$t`Connect a file server, for example WebDAV or Nextcloud, to share files with other people and to open the files of your team`}</span>
      <hbox>
        <DialogButton label={$t`Add Account…`} icon={AddIcon} onClick={onAddAccount} />
      </hbox>
    </OptionsRow>
  </OptionsSection>
</OptionsPage>

<script lang="ts">
  import { openSetup } from "../SettingsDialogs";
  import OptionsPage from "../Shared/OptionsPage.svelte";
  import OptionsSection from "../Shared/OptionsSection.svelte";
  import OptionsRow from "../Shared/OptionsRow.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import FilesIcon from "lucide-svelte/icons/folder";
  import ShareIcon from "lucide-svelte/icons/folder-up";
  import AddIcon from "lucide-svelte/icons/plus";
  import { t } from "../../../l10n/l10n";

  function onAddAccount() {
    openSetup("/setup/files", { kind: "options", categoryID: "files" });
  }
</script>
