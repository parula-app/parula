<vbox class="expressions-pane" role="complementary" aria-label={$t`Expressions *=> Pane with emojis to insert into the text`}>
  <hbox class="pane-header">
    <span class="pane-title">{$t`Expressions *=> Pane with emojis to insert into the text`}</span>
    <hbox flex />
    <button type="button" class="icon-button" title={$t`Close`} aria-label={$t`Close`}
      on:click={() => isOpen = false}>
      <CloseIcon size={16} />
    </button>
  </hbox>
  <hbox class="search-box">
    <SearchIcon size={16} />
    <input type="text" class="search-input" bind:value={searchTerm} bind:this={searchEl}
      placeholder={$t`Search emojis`} aria-label={$t`Search emojis`}
      autocomplete="off" spellcheck="false"
      on:keydown={onSearchKey} />
    {#if searchTerm}
      <button type="button" class="icon-button clear" title={$t`Clear search`} aria-label={$t`Clear search`}
        on:click={clearSearch}>
        <CloseIcon size={14} />
      </button>
    {/if}
  </hbox>
  <hbox class="pivot" role="tablist" aria-label={$t`Expressions *=> Pane with emojis to insert into the text`}>
    <span class="pivot-tab" role="tab" aria-selected="true">{$t`Emojis *=> Tab with the list of emojis`}</span>
  </hbox>
  {#if !isSearching}
    <hbox class="categories" role="tablist" aria-label={$t`Emoji categories`}>
      {#each emojiCategories as category (category.id)}
        <button type="button" class="category" role="tab"
          class:selected={category.id == selectedCategory}
          aria-selected={category.id == selectedCategory}
          title={categoryLabel(category.id)} aria-label={categoryLabel(category.id)}
          on:click={() => scrollToCategory(category.id)}>
          <svelte:component this={categoryIcon(category.id)} size={18} strokeWidth={1.6} />
        </button>
      {/each}
    </hbox>
  {/if}
  <vbox flex class="emoji-scroll" bind:this={scrollEl} on:scroll={onScroll} on:keydown={onGridKey}>
    {#if isSearching}
      <span class="section-header">{$t`Search results`}</span>
      {#if results.length}
        <div class="emoji-grid" role="group" aria-label={$t`Search results`}>
          {#each results as entry (entry.emoji)}
            <button type="button" class="emoji" title={entry.name} aria-label={entry.name}
              on:click={() => insert(entry)}>{entry.emoji}</button>
          {/each}
        </div>
      {:else}
        <span class="empty">{$t`No emojis found`}</span>
      {/if}
    {:else}
      {#each emojiCategories as category (category.id)}
        <span class="section-header" data-category={category.id}>{categoryLabel(category.id)}</span>
        <div class="emoji-grid" role="group" aria-label={categoryLabel(category.id)}>
          {#each category.emojis as entry (entry.emoji)}
            <button type="button" class="emoji" title={entry.name} aria-label={entry.name}
              on:click={() => insert(entry)}>{entry.emoji}</button>
          {/each}
        </div>
      {/each}
    {/if}
  </vbox>
</vbox>

<script lang="ts">
  import { emojiCategories, searchEmojis, type EmojiEntry } from "./EmojiCatalog";
  import type { Editor } from "@tiptap/core";
  import SmileysIcon from "lucide-svelte/icons/smile";
  import PeopleIcon from "lucide-svelte/icons/users";
  import AnimalsIcon from "lucide-svelte/icons/paw-print";
  import FoodIcon from "lucide-svelte/icons/utensils";
  import TravelIcon from "lucide-svelte/icons/car";
  import ActivitiesIcon from "lucide-svelte/icons/trophy";
  import ObjectsIcon from "lucide-svelte/icons/lightbulb";
  import SymbolsIcon from "lucide-svelte/icons/heart";
  import FlagsIcon from "lucide-svelte/icons/flag";
  import SearchIcon from "lucide-svelte/icons/search";
  import CloseIcon from "lucide-svelte/icons/x";
  import { t } from "../../../l10n/l10n";
  import { onMount, tick } from "svelte";

  export let editor: Editor;
  export let isOpen = true;

  let searchTerm = "";
  let searchEl: HTMLInputElement;
  let scrollEl: HTMLElement;
  let selectedCategory = emojiCategories[0]?.id;

  $: isSearching = !!searchTerm.trim();
  $: results = searchEmojis(searchTerm);

  onMount(() => searchEl?.focus());

  function categoryLabel(id: string): string {
    switch (id) {
      case "smileys-emotion": return $t`Smileys *=> Emoji category: smileys and emotions`;
      case "people-body": return $t`People *=> or Persons - Short word, less than 10 characters`;
      case "animals-nature": return $t`Animals and nature`;
      case "food-drink": return $t`Food and drink`;
      case "travel-places": return $t`Travel and places`;
      case "activities": return $t`Activities *=> Emoji category: sports and activities`;
      case "objects": return $t`Objects *=> Emoji category: objects`;
      case "symbols": return $t`Symbols *=> Emoji category: symbols`;
      case "flags": return $t`Flags *=> Emoji category: flags of countries`;
      default: return emojiCategories.find(category => category.id == id)?.title ?? id;
    }
  }

  function categoryIcon(id: string) {
    switch (id) {
      case "people-body": return PeopleIcon;
      case "animals-nature": return AnimalsIcon;
      case "food-drink": return FoodIcon;
      case "travel-places": return TravelIcon;
      case "activities": return ActivitiesIcon;
      case "objects": return ObjectsIcon;
      case "symbols": return SymbolsIcon;
      case "flags": return FlagsIcon;
      default: return SmileysIcon;
    }
  }

  function insert(entry: EmojiEntry) {
    editor?.commands.insertContent(entry.emoji);
  }

  function sectionHeaders(): HTMLElement[] {
    return Array.from(scrollEl?.querySelectorAll<HTMLElement>(".section-header[data-category]") ?? []);
  }

  function scrollToCategory(id: string) {
    selectedCategory = id;
    let header = sectionHeaders().find(header => header.dataset.category == id);
    if (header) {
      scrollEl.scrollTop = header.offsetTop - scrollEl.offsetTop;
    }
  }

  function onScroll() {
    if (isSearching) {
      return;
    }
    let top = scrollEl.scrollTop + scrollEl.offsetTop + 4;
    let current = sectionHeaders().filter(header => header.offsetTop <= top).pop();
    selectedCategory = current?.dataset.category ?? emojiCategories[0]?.id;
  }

  async function clearSearch() {
    searchTerm = "";
    await tick();
    searchEl?.focus();
  }

  function onSearchKey(event: KeyboardEvent) {
    if (event.key == "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (searchTerm) {
        searchTerm = "";
      } else {
        isOpen = false;
      }
    } else if (event.key == "ArrowDown" || event.key == "Enter") {
      let first = scrollEl?.querySelector<HTMLButtonElement>("button.emoji");
      if (!first) {
        return;
      }
      event.preventDefault();
      if (event.key == "Enter") {
        first.click();
      } else {
        first.focus();
      }
    }
  }

  function onGridKey(event: KeyboardEvent) {
    let current = event.target as HTMLElement;
    if (!current.classList?.contains("emoji")) {
      return;
    }
    let buttons = Array.from(scrollEl.querySelectorAll<HTMLButtonElement>("button.emoji"));
    let index = buttons.indexOf(current as HTMLButtonElement);
    let next: HTMLButtonElement;
    if (event.key == "ArrowRight") {
      next = buttons[index + 1];
    } else if (event.key == "ArrowLeft") {
      next = buttons[index - 1];
    } else if (event.key == "ArrowDown" || event.key == "ArrowUp") {
      next = verticalNeighbour(buttons, current, event.key == "ArrowDown");
      if (!next && event.key == "ArrowUp") {
        searchEl?.focus();
        event.preventDefault();
        return;
      }
    } else if (event.key == "Home") {
      next = buttons[0];
    } else if (event.key == "End") {
      next = buttons[buttons.length - 1];
    } else {
      return;
    }
    event.preventDefault();
    next?.focus();
  }

  function verticalNeighbour(buttons: HTMLButtonElement[], current: HTMLElement, down: boolean): HTMLButtonElement {
    let top = current.offsetTop;
    let rowTops = buttons.map(button => button.offsetTop).filter(rowTop => down ? rowTop > top : rowTop < top);
    if (!rowTops.length) {
      return null;
    }
    let rowTop = down ? Math.min(...rowTops) : Math.max(...rowTops);
    let row = buttons.filter(button => button.offsetTop == rowTop);
    let left = current.offsetLeft;
    return row.reduce((best, button) =>
      Math.abs(button.offsetLeft - left) < Math.abs(best.offsetLeft - left) ? button : best);
  }
</script>

<style>
  .expressions-pane {
    flex-shrink: 0;
    width: 312px;
    min-height: 0;
    border-inline-start: 1px solid var(--lo-divider);
    background-color: var(--lo-pane-bg);
  }
  .pane-header {
    flex-shrink: 0;
    align-items: center;
    padding: 10px 8px 6px 16px;
  }
  .pane-title {
    font-size: var(--lo-font-size-large);
    font-weight: 600;
  }
  .icon-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
  }
  .icon-button:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .search-box {
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    height: 32px;
    margin: 4px 16px 8px 16px;
    padding: 0 2px 0 8px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
    color: var(--lo-fg-secondary);
  }
  .search-box:focus-within {
    border-color: var(--lo-accent);
    box-shadow: inset 0 -1px 0 var(--lo-accent);
  }
  .search-input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: none;
    outline: none;
    background: none;
    color: var(--lo-fg);
    font: inherit;
  }
  .search-input::placeholder {
    color: var(--lo-fg-secondary);
  }
  .search-box .clear {
    width: 24px;
    height: 24px;
  }
  .pivot {
    flex-shrink: 0;
    padding: 0 16px;
  }
  .pivot-tab {
    padding: 6px 2px;
    border-bottom: 2px solid var(--lo-accent);
    font-weight: 600;
  }
  .categories {
    flex-shrink: 0;
    justify-content: space-between;
    margin: 4px 16px 0 16px;
    padding-bottom: 2px;
    border-bottom: 1px solid var(--lo-divider);
  }
  .category {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 32px;
    padding: 0;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    background: none;
    color: var(--lo-fg-secondary);
  }
  .category:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .category.selected {
    border-bottom-color: var(--lo-accent);
    color: var(--lo-accent-text);
  }
  .emoji-scroll {
    position: relative;
    min-height: 0;
    padding: 0 12px 12px 16px;
    overflow-y: auto;
  }
  .section-header {
    padding: 12px 0 6px 0;
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .emoji-grid {
    display: grid;
    grid-template-columns: repeat(7, 36px);
    grid-auto-rows: 36px;
  }
  .emoji {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    font-family: "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", var(--lo-font);
    font-size: 22px;
    line-height: 1;
  }
  .emoji:hover {
    background-color: var(--lo-hover-bg);
  }
  .emoji:focus-visible {
    outline: 2px solid var(--lo-focus-ring);
    outline-offset: -2px;
  }
  .empty {
    padding: 8px 0;
    color: var(--lo-fg-secondary);
  }
</style>
