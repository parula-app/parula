<vbox flex class="page">
  <PageHeader title={$t`Auto Replies *=> Automatic replies to incoming mail, e.g. during vacation`}
    subtitle={$t`Automatically respond to incoming mail while you are away`} />

  <AutoResponderEdit {account} bind:isLoaded bind:isChanged bind:this={autoResponderEdit} />

  {#if isLoaded}
    <hbox class="buttons">
      <Button label={$t`Save`}
        classes="save"
        icon={SaveIcon}
        onClick={() => autoResponderEdit.save()}
        />
    </hbox>
  {/if}
</vbox>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import AutoResponderEdit from "./AutoResponderEdit.svelte";
  import PageHeader from "../Shared/PageHeader.svelte";
  import Button from "../../Shared/Button.svelte";
  import SaveIcon from "lucide-svelte/icons/save";
  import { catchErrors } from "../../Util/error";
  import { onDestroy } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let account: MailAccount;

  let isLoaded = false;
  let isChanged = false;
  let autoResponderEdit: AutoResponderEdit;

  // Also without Save, e.g. when the user closes Lookout's settings dialog
  onDestroy(() => catchErrors(onClose));
  async function onClose() {
    if (isChanged) {
      await autoResponderEdit.save();
    }
  }
</script>

<style>
  .page {
    max-width: 40em;
  }
  .buttons {
    justify-content: end;
    margin-block-start: 32px;
  }
</style>
