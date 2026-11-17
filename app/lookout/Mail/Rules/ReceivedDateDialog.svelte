<Dialog title={$t`Received *=> Date when the email was received`} okLabel={$t`OK`} onOK={onSubmit} on:close={onClose} width="360px"
  okDisabled={(!hasAfter && !hasBefore && $t`Choose After, Before or both`) ||
    (hasAfter && !after && $t`Enter the date for After`) ||
    (hasBefore && !before && $t`Enter the date for Before`)}>
  <grid class="received">
    <Checkbox label={$t`After *=> Received after this date`} bind:checked={hasAfter} />
    <DateField label={$t`After *=> Received after this date`} bind:date={after} disabled={!hasAfter} on:change={() => { hasAfter = true; }} />
    <Checkbox label={$t`Before *=> Received before this date`} bind:checked={hasBefore} />
    <DateField label={$t`Before *=> Received before this date`} bind:date={before} disabled={!hasBefore} on:change={() => { hasBefore = true; }} />
  </grid>
</Dialog>

<script lang="ts">
  import { afterDayOf, beforeDayOf, sentDateMinAfter, sentDateMaxBefore } from "./RuleItems";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import DateField from "../../Shared/Form/DateField.svelte";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let sentDateMin: Date | null;
  export let sentDateMax: Date | null;
  const dispatch = createEventDispatcher<{ choose: { sentDateMin: Date | null, sentDateMax: Date | null }, close: void }>();

  let after: Date | null = afterDayOf(sentDateMin);
  let before: Date | null = beforeDayOf(sentDateMax);
  let hasAfter = !!after;
  let hasBefore = !!before;

  function onSubmit() {
    dispatch("choose", {
      sentDateMin: hasAfter ? sentDateMinAfter(after) : null,
      sentDateMax: hasBefore ? sentDateMaxBefore(before) : null,
    });
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .received {
    grid-template-columns: max-content 1fr;
    align-items: center;
    gap: 10px 12px;
    padding-block: 4px;
  }
</style>
