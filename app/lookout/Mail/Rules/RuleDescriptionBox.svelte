<vbox class="rule-description" class:empty={!lines.length} class:fill>
  {#each lines as line, i}
    <div class="line" class:continued={isContinued(i)}>
      {#if isContinued(i)}{$t`and *=> as in: from Ben and with Hello in the subject`}{/if}
      {#each line.parts as part}
        {#if part.isValue && line.item}
          <button type="button" class="value" class:placeholder={part.isPlaceholder}
            on:click={() => dispatch("edit", line.item)}>{part.text}</button>
        {:else if part.isValue}
          <span class="value">{part.text}</span>
        {:else}
          {part.text}
        {/if}
      {/each}
    </div>
  {/each}
  {#if example}
    <hbox class="example">{$t`Example: ${example}`}</hbox>
  {/if}
</vbox>

<script lang="ts">
  import type { RuleDescriptionLine } from "./RuleDescription";
  import type { RuleItem } from "./RuleItems";
  import { t } from "../../../l10n/l10n";
  import { createEventDispatcher } from "svelte";

  export let lines: RuleDescriptionLine[];
  export let example: string | null = null;
  export let fill = false;

  const dispatch = createEventDispatcher<{ edit: RuleItem }>();

  function isContinued(index: number): boolean {
    let item = lines[index]?.item;
    let previous = lines[index - 1]?.item;
    return !!item && !!previous && item.isAction == previous.isAction;
  }
</script>

<style>
  .rule-description {
    flex-shrink: 0;
    min-height: 96px;
    max-height: 132px;
    overflow-y: auto;
    padding: 4px 8px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
    line-height: 20px;
  }
  .rule-description.fill {
    flex: 1 1 0;
    max-height: none;
  }
  .rule-description.empty {
    background-color: var(--lo-pane-alt-bg);
  }
  .line.continued {
    padding-inline-start: 8px;
  }
  .value {
    display: inline;
    padding: 0;
    border: none;
    background: none;
    color: var(--lo-accent-text);
    font: inherit;
    line-height: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  span.value {
    cursor: default;
  }
  .value:hover {
    color: var(--lo-accent-hover);
  }
  .example {
    margin-block-start: 8px;
    padding-block-start: 6px;
    border-block-start: 1px solid var(--lo-divider);
    font-weight: 600;
  }
</style>
