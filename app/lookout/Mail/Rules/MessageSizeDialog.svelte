<Dialog title={$t`Message Size`} okLabel={$t`OK`} onOK={onSubmit} on:close={onClose} width="380px"
  okDisabled={(!atLeast && !atMost && $t`Enter a size`) ||
    (!!atLeast && !!atMost && atLeast > atMost && $t`At least must not be larger than At most`)}>
  <vbox class="size">
    <span>{$t`Specify the size (in kilobytes) to check for`}</span>
    <grid class="fields">
      <span>{$t`At least`}</span>
      <SpinBox label={$t`At least`} bind:value={atLeast} min={0} stepSize={10} suffix={$t`KB *=> Kilobytes, unit of the email size`} width="120px" />
      <span>{$t`At most`}</span>
      <SpinBox label={$t`At most`} bind:value={atMost} min={0} stepSize={10} suffix={$t`KB *=> Kilobytes, unit of the email size`} width="120px" />
    </grid>
  </vbox>
</Dialog>

<script lang="ts">
  import { kilobytes } from "./RuleItems";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import SpinBox from "../../Shared/Form/SpinBox.svelte";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let sizeMin: number | null;
  export let sizeMax: number | null;
  const dispatch = createEventDispatcher<{ choose: { sizeMin: number | null, sizeMax: number | null }, close: void }>();

  let atLeast: number | null = kilobytes(sizeMin);
  let atMost: number | null = kilobytes(sizeMax);

  function onSubmit() {
    dispatch("choose", { sizeMin: atLeast ? atLeast * 1024 : null, sizeMax: atMost ? atMost * 1024 : null });
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .size {
    gap: 10px;
  }
  .fields {
    grid-template-columns: max-content max-content;
    align-items: center;
    gap: 8px 12px;
    margin-inline-start: 16px;
  }
</style>
