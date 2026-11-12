<Dialog title={$t`Reading Pane`}
  okLabel={$t`OK`}
  okDisabled={isMarkingRead && !isValidDelay && $t`Enter 0 to 20 seconds`}
  onOK={onSave}
  on:close>
  <vbox class="dialog-content">
    <Checkbox label={$t`Mark items as read when viewed in the Reading Pane`} bind:checked={isMarkingRead} />
    <hbox class="delay" class:disabled={!isMarkingRead}>
      <span>{$t`Wait *=> as in: Wait 5 seconds before marking item as read`}</span>
      <SpinBox label={$t`Seconds *=> Number of seconds to wait`} bind:value={delay} min={0} max={20} width="72px" disabled={!isMarkingRead} />
      <span>{$t`seconds before marking item as read *=> as in: Wait 5 seconds before marking item as read`}</span>
    </hbox>
  </vbox>
</Dialog>

<script lang="ts">
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import SpinBox from "../../Shared/Form/SpinBox.svelte";
  import { t } from "../../../l10n/l10n";

  const readAfter = getLocalStorage<number>("mail.read.after", 0);
  let current = readAfter.value;
  let isMarkingRead = current >= 0;
  let delay = Math.max(current, 0);
  $: isValidDelay = Number.isInteger(delay) && delay >= 0 && delay <= 20;

  function onSave() {
    readAfter.value = isMarkingRead ? delay : -1;
  }
</script>

<style>
  .dialog-content {
    gap: 12px;
  }
  .delay {
    align-items: center;
    gap: 8px;
    padding-inline-start: 24px;
  }
  .delay.disabled {
    color: var(--lo-fg-disabled);
  }
</style>
