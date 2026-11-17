<Dialog title={$t`Other Settings`} okLabel={$t`OK`} onOK={save} width="580px" on:close
  okDisabled={useCompactLayout && !isValidChars && $t`Enter 10 to 999 characters`}>
  <vbox class="other-settings">
    <GroupBox label={$t`Column Headings and Rows`}>
      <hbox class="compact-row">
        <Checkbox label={$t`Use compact layout in widths smaller than`} bind:checked={useCompactLayout} />
        <SpinBox label={$t`Characters *=> Number of characters`} bind:value={compactLayoutChars} min={10} max={999} width="72px" disabled={!useCompactLayout} />
        <span class:disabled={!useCompactLayout}>{$t`characters *=> as in: Use compact layout in widths smaller than 80 characters`}</span>
      </hbox>
      <Checkbox label={$t`Use tighter spacing`} bind:checked={tighterSpacing} />
    </GroupBox>
    <GroupBox label={$t`Grid Lines and Group Headings`}>
      <Checkbox label={$t`Show items in Groups`} bind:checked={showInGroups} />
    </GroupBox>
    <GroupBox label={$t`Message Preview`}>
      <hbox class="radios">
        {#each previewOptions as option}
          <Radio label={option.label} bind:group={previewLines} value={option.lines} />
        {/each}
      </hbox>
    </GroupBox>
    <GroupBox label={$t`Reading Pane`}>
      <hbox class="radios">
        <Radio label={$t`Right *=> Reading pane on the right side`} bind:group={readingPane} value="right" />
        <Radio label={$t`Bottom *=> Reading pane at the bottom`} bind:group={readingPane} value="bottom" />
        <Radio label={$t`Off *=> The pane is hidden`} bind:group={readingPane} value="off" />
      </hbox>
    </GroupBox>
  </vbox>
</Dialog>

<script lang="ts">
  import type { ViewSettings } from "./ViewSettings";
  import type { ReadingPanePosition } from "../3pane/3Pane.svelte";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import GroupBox from "../../Shared/Form/GroupBox.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import Radio from "../../Shared/Form/Radio.svelte";
  import SpinBox from "../../Shared/Form/SpinBox.svelte";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let settings: ViewSettings;
  export let readingPanePosition: ReadingPanePosition;
  const dispatch = createEventDispatcher<{ change: { changes: Partial<ViewSettings>, readingPane: ReadingPanePosition } }>();

  let showInGroups = settings.showInGroups;
  let tighterSpacing = settings.tighterSpacing;
  let previewLines = settings.previewLines;
  let useCompactLayout = settings.useCompactLayout;
  let compactLayoutChars = settings.compactLayoutChars;
  $: isValidChars = Number.isInteger(compactLayoutChars) && compactLayoutChars >= 10 && compactLayoutChars <= 999;
  let readingPane = readingPanePosition;

  const previewOptions = [
    { lines: 0, label: $t`Off *=> No preview text in the message list` },
    { lines: 1, label: $t`1 Line` },
    { lines: 2, label: $t`2 Lines` },
    { lines: 3, label: $t`3 Lines` },
  ];

  function save() {
    dispatch("change", { changes: { showInGroups, tighterSpacing, previewLines, useCompactLayout, compactLayoutChars }, readingPane });
  }
</script>

<style>
  .other-settings {
    gap: 12px;
  }
  .radios {
    gap: 20px;
  }
  .compact-row {
    align-items: center;
    gap: 8px;
  }
  .disabled {
    color: var(--lo-fg-disabled);
  }
</style>
