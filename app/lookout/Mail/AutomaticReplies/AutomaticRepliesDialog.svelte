<Dialog title={$t`Automatic Replies - ${account.emailAddress || account.name}`} on:close width="640px"
  okLabel={$t`OK`} okDisabled={!isLoaded} onOK={() => autoResponderEdit.save()}>
  <AutoResponderEdit {account} bind:isLoaded bind:this={autoResponderEdit} />
</Dialog>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import AutoResponderEdit from "../../../frontend/Settings/Mail/AutoResponderEdit.svelte";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import { t } from "../../../l10n/l10n";

  export let account: MailAccount;

  let isLoaded = false;
  let autoResponderEdit: AutoResponderEdit;
</script>
