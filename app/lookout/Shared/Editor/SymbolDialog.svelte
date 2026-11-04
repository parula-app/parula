<Dialog title={$t`Symbol *=> Insert a special character, e.g. the copyright sign`} on:close={onClose} width="620px" height="560px">
  <DialogTabs tabs={[{ id: "symbols", label: $t`Symbols *=> Characters to insert, e.g. arrows or currency signs` }, { id: "special", label: $t`Special Characters` }]}
    bind:selected={tab} />
  {#if tab == "symbols"}
    <vbox flex class="page">
      <hbox class="subset-row">
        <span>{$t`Subset *=> Unicode block to choose the symbols from, e.g. Arrows`}</span>
        <ComboBox label={$t`Subset *=> Unicode block to choose the symbols from, e.g. Arrows`} options={subsetOptions} bind:value={subset} width="260px" />
      </hbox>
      <grid class="symbols" role="grid" aria-label={$t`Symbols *=> Characters to insert, e.g. arrows or currency signs`}>
        {#each characters as character (character)}
          <button type="button" class="symbol" class:selected={character == selected}
            title={"U+" + characterCode(character)}
            on:click={() => selected = character}
            on:dblclick={() => insert(character)}>
            {character}
          </button>
        {/each}
      </grid>
      <vbox class="recent">
        <span class="caption">{$t`Recently used symbols`}</span>
        <hbox class="recent-symbols">
          {#each recent as character (character)}
            <button type="button" class="symbol" class:selected={character == selected}
              on:click={() => onRecent(character)}
              on:dblclick={() => insert(character)}>
              {character}
            </button>
          {/each}
        </hbox>
      </vbox>
      <hbox class="code-row lo-secondary">
        {#if selected}
          {$t`Character code`} {characterCode(selected)} {$t`from: Unicode (hex)`}
        {/if}
      </hbox>
    </vbox>
  {:else}
    <vbox flex class="page special">
      <hbox class="special-header">
        <span class="special-character">{$t`Character *=> Column header: the special character`}</span>
      </hbox>
      <vbox flex class="special-list" role="listbox" aria-label={$t`Special Characters`}>
        {#each specialCharacters() as special (special.character)}
          <button type="button" class="special-row" role="option"
            aria-selected={special.character == selectedSpecial}
            class:selected={special.character == selectedSpecial}
            on:click={() => selectedSpecial = special.character}
            on:dblclick={() => insert(special.character)}>
            <span class="special-character">{special.character.trim() ? special.character : ""}</span>
            <span>{special.name}</span>
          </button>
        {/each}
      </vbox>
    </vbox>
  {/if}
  <svelte:fragment slot="footer">
    <DialogButton label={$t`Insert *=> Insert the selected symbol into the text`} primary
      disabled={!(tab == "symbols" ? selected : selectedSpecial) && $t`Select a symbol`}
      onClick={() => insert(tab == "symbols" ? selected : selectedSpecial)} />
    <DialogButton label={hasInserted ? $t`Close` : $t`Cancel`} onClick={onClose} />
  </svelte:fragment>
</Dialog>

<script lang="ts">
  import { recentSymbols, symbolSubsets, specialCharacters, subsetCharacters, symbolSubsetOf, characterCode, noteSymbolUsed, type SymbolSubset } from "./SymbolTable";
  import Dialog from "../Dialog/Dialog.svelte";
  import DialogButton from "../Dialog/DialogButton.svelte";
  import DialogTabs from "../Dialog/DialogTabs.svelte";
  import ComboBox from "../Form/ComboBox.svelte";
  import type { Editor } from "@tiptap/core";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let editor: Editor;

  const dispatch = createEventDispatcher<{ close: void }>();

  let tab = "symbols";
  let subsets = symbolSubsets();
  let subset: SymbolSubset = subsets[0];
  let subsetOptions = subsets.map(candidate => ({ value: candidate, label: candidate.name }));
  let selected: string = null;
  let selectedSpecial: string = null;
  let hasInserted = false;
  $: recent = $recentSymbols.value ?? [];
  $: characters = subsetCharacters(subset);

  function onRecent(character: string) {
    selected = character;
    let recentSubset = symbolSubsetOf(character);
    subset = subsets.find(candidate => candidate.name == recentSubset?.name) ?? subset;
  }

  function insert(character: string) {
    if (!character) {
      return;
    }
    editor.chain().focus().insertContent({ type: "text", text: character }).run();
    noteSymbolUsed(character);
    hasInserted = true;
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .page {
    gap: 8px;
    padding-block-start: 12px;
    min-height: 0;
  }
  .subset-row {
    align-items: center;
    gap: 8px;
  }
  .symbols {
    grid-template-columns: repeat(16, 1fr);
    grid-auto-rows: 32px;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
  }
  .symbol {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    height: 32px;
    padding: 0;
    border: none;
    border-inline-end: 1px solid var(--lo-divider);
    border-block-end: 1px solid var(--lo-divider);
    background: none;
    color: var(--lo-fg);
    font-size: 16px;
  }
  .symbol:hover {
    background-color: var(--lo-hover-bg);
  }
  .symbol.selected {
    background-color: var(--lo-accent);
    color: var(--lo-accent-fg);
  }
  .recent {
    gap: 4px;
  }
  .caption {
    font-weight: 600;
  }
  .recent-symbols {
    height: 34px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
    overflow: hidden;
  }
  .recent-symbols .symbol {
    width: 32px;
    flex-shrink: 0;
  }
  .code-row {
    height: 20px;
    font-size: var(--lo-font-size-small);
  }
  .special-header {
    padding: 0 8px;
    font-weight: 600;
  }
  .special-list {
    min-height: 0;
    overflow-y: auto;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
  }
  .special-row {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    height: 26px;
    padding: 0 8px;
    border: none;
    background: none;
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
  }
  .special-row:hover {
    background-color: var(--lo-hover-bg);
  }
  .special-row.selected {
    background-color: var(--lo-selected-bg);
  }
  .special-character {
    width: 96px;
    flex-shrink: 0;
  }
</style>
