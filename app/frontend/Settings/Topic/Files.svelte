<HeaderGroupBox>
  <hbox slot="header">{$t`Files`}</hbox>
  <Checkbox
    checked={$account.saveAsLocalFiles}
    label={$t`Also save the topics as Markdown files on this computer, for other apps`}
    allowIndetermined={false}
    on:change={event => catchErrors(() => onSaveAsLocalFiles(event.detail))}
    />
</HeaderGroupBox>

<script lang="ts">
  import type { TopicAccount } from "../../../logic/Topic/TopicAccount";
  import { setContentStorage } from "../../../logic/Topic/TopicAccounts";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import Checkbox from "../../Shared/Checkbox.svelte";
  import { catchErrors } from "../../Util/error";
  import { t } from "../../../l10n/l10n";

  export let account: TopicAccount;

  async function onSaveAsLocalFiles(saveAsLocalFiles: boolean) {
    account.saveAsLocalFiles = saveAsLocalFiles;
    await account.save();
    await setContentStorage(account);
  }
</script>
