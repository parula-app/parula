<hbox flex class="contact-list" on:keydown={onKeyDown}>
  <vbox class="letter-strip" role="navigation" aria-label={$t`Go to letter`}>
    {#each LetterIndex.alphabet as letter}
      <button class="letter"
        class:has-contacts={letterIndex.hasLetter(letter)}
        on:click={() => jumpTo(letter)}
        tabindex="-1">
        {letter}
      </button>
    {/each}
  </vbox>
  {#if $persons.hasItems}
    <FastList
      items={persons}
      bind:selectedItem={selected}
      bind:selectedItems={selectedPersons}
      on:init={onInit}
      columns="auto">
      <PersonLine slot="row" let:item person={item} on:contextmenu={event => onContextMenu(event, item)} />
    </FastList>
  {:else}
    <vbox flex class="empty">{emptyText}</vbox>
  {/if}
</hbox>

<PersonMenu bind:this={contextMenu} />

<script lang="ts">
  import type { Contact } from "../../../logic/Abstract/Contact";
  import { LetterIndex } from "../LetterIndex";
  import { ContactActions } from "../ContactActions";
  import PersonLine from "./PersonLine.svelte";
  import PersonMenu from "../PersonPage/PersonMenu.svelte";
  import FastList from "../../../frontend/Shared/FastList.svelte";
  import type { ArrayColl, Collection } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let persons: Collection<Contact>;
  export let selected: Contact;
  export let selectedPersons: ArrayColl<Contact>;
  export let emptyText: string;

  let contextMenu: PersonMenu;
  let scrollToItem: (contact: Contact) => void = null;
  let scrollToIndex: (index: number) => void = null;

  $: letterIndex = new LetterIndex($persons.contents);

  function onInit(event: CustomEvent<{ scrollToIndex: (index: number) => void, scrollToItem: (contact: Contact) => void }>) {
    scrollToItem = event.detail.scrollToItem;
    scrollToIndex = event.detail.scrollToIndex;
    if (!persons.contains(selected)) {
      selectedPersons.clear();
      selectedPersons.add(persons.first);
    }
    scrollToItem(selectedPersons.first ?? selected);
  }

  function jumpTo(letter: string) {
    let contact = letterIndex.contactAtOrAfter(letter);
    if (!contact) {
      return;
    }
    selectedPersons.clear();
    selectedPersons.add(contact);
    let index = persons.contents.indexOf(contact);
    scrollToTop(Math.max(index - 1, 0));
  }

  function scrollToTop(index: number) {
    if (!scrollToIndex) {
      return;
    }
    // FastList scrolls only as far as needed, so coming from below puts the row at the top
    scrollToIndex(persons.length - 1);
    scrollToIndex(index);
  }

  function onContextMenu(event: MouseEvent, contact: Contact) {
    contextMenu.openFor(event, contact, selectedPersons);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }
    if (event.key == "Enter" && selected) {
      event.preventDefault();
      ContactActions.edit(selected);
    } else if (event.key.length == 1 && /\p{L}/u.test(event.key)) {
      event.preventDefault();
      jumpTo(LetterIndex.letterFor(event.key));
    }
  }
</script>

<style>
  .contact-list {
    min-height: 0;
  }
  .letter-strip {
    flex-shrink: 0;
    justify-content: space-between;
    width: 28px;
    padding: 6px 0;
    overflow: hidden;
    border-inline-end: 1px solid var(--lo-divider);
  }
  .letter {
    flex: 0 1 18px;
    min-height: 0;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-disabled);
    font: inherit;
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
  }
  .letter.has-contacts {
    color: var(--lo-fg-secondary);
  }
  .letter:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-accent-text);
  }
  .contact-list :global(.fast-list) {
    padding-block-start: 2px;
  }
  .contact-list :global(.fast-list .row > *) {
    padding: 0 12px;
  }
  .contact-list :global(.fast-list:focus-visible) {
    outline: none;
  }
  .contact-list :global(.fast-list:focus-visible .row.selected > *) {
    outline: 1px solid var(--lo-focus-ring);
    outline-offset: -1px;
  }
  .empty {
    align-items: center;
    padding: 32px 16px;
    color: var(--lo-fg-secondary);
    text-align: center;
  }
</style>
