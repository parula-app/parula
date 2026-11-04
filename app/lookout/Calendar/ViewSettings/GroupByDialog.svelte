<Dialog title={$t`Group By`} okLabel={$t`OK`} onOK={save} width="420px" on:close>
  <GroupBox label={$t`Group items by`}>
    <ComboBox options={groupOptions} bind:value={chosen} label={$t`Group items by`} width="200px" />
  </GroupBox>
</Dialog>

<script lang="ts">
  import { EventTableGrouping } from "../ListView/EventTable";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import GroupBox from "../../Shared/Form/GroupBox.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import { t } from "../../../l10n/l10n";

  export let grouping: EventTableGrouping;

  let chosen = grouping;

  $: groupOptions = [
    { value: EventTableGrouping.None, label: $t`(none) *=> No field for grouping` },
    { value: EventTableGrouping.Recurrence, label: $t`Recurrence *=> Group the events by how often they repeat` },
  ];

  function save() {
    grouping = chosen;
  }
</script>
