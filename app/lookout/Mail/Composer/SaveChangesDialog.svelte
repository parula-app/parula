<Dialog title={appName} on:close={onClose} width="420px">
  <hbox class="question">{$t`Do you want to save changes to this message?`}</hbox>
  <svelte:fragment slot="footer">
    <DialogButton label={$t`Yes`} primary onClick={onYes} disabled={yesDisabled ?? false} />
    <DialogButton label={$t`No`} onClick={onNo} />
    <DialogButton label={$t`Cancel`} onClick={onClose} />
  </svelte:fragment>
</Dialog>

<script lang="ts">
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import { appName } from "../../../logic/build";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let onYes: () => Promise<void>;
  export let yesDisabled: string | null = null;
  export let onNo: () => Promise<void>;

  const dispatch = createEventDispatcher<{ close: void }>();

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .question {
    padding-block: 4px 8px;
  }
</style>
