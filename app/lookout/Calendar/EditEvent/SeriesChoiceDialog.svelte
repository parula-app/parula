<Dialog title={title} okLabel={okLabel} onOK={() => onChoose(choice)} on:close={onClose}>
  <p class="question">{$t`This is one occurrence in a series. What do you want to change?`}</p>
  <vbox class="choices">
    {#each choices as option}
      <Radio label={labels[option]} name="series-choice" value={option} bind:group={choice} />
    {/each}
  </vbox>
</Dialog>

<script lang="ts">
  import type { SeriesChoice } from "./EventEditFlow";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import Radio from "../../Shared/Form/Radio.svelte";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let title: string;
  export let okLabel: string;
  export let choices: SeriesChoice[];
  export let onChoose: (choice: SeriesChoice) => Promise<void>;

  const dispatch = createEventDispatcher<{ close: void }>();

  let choice: SeriesChoice = choices[0];

  const labels: Record<SeriesChoice, string> = {
    occurrence: $t`Just this one *=> Only this occurrence of the recurring event`,
    following: $t`This and all following occurrences`,
    series: $t`The entire series`,
  };

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .question {
    margin: 0 0 12px 0;
  }
  .choices {
    gap: 6px;
  }
</style>
