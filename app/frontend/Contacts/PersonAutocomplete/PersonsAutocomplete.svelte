<hbox flex class="persons-autocomplete">
  {#each $persons.each as person}
    <PersonEntry {person}
      {onRemovePerson}
      on:focusNext={focus}
      {disabled}
      >
      <slot name="person-pill-before-avatar" slot="before-avatar" {person} />
      <slot name="person-pill-after-name" slot="after-name" {person} />
      <slot name="person-popup-bottom" slot="person-popup-bottom" {person} />
      <slot name="person-popup-buttons" slot="person-popup-buttons" {person} />
      <slot name="person-context-menu" slot="context-menu" {person} />
    </PersonEntry>
  {/each}
  {#if !disabled}
    <hbox flex class="input">
      <PersonAutocomplete
        {onAddPerson}
        askForName
        skipPersons={$persons}
        {placeholder} {tabindex} {autofocus}
        bind:this={autocompleteEl}
        >
        <slot name="result-bottom-row" slot="result-bottom-row" let:person {person} />
      </PersonAutocomplete>
      <slot name="end" />
    </hbox>
  {/if}
</hbox>

<script lang="ts">
  import type { Collection } from "svelte-collections";
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import PersonAutocomplete from "./PersonAutocomplete.svelte";
  import PersonEntry from "./PersonEntry.svelte";

  /**
   * The persons that the user selected.
   * in/out */
  export let persons: Collection<PersonUID>;
  export let placeholder: string = null;
  export let tabindex = null;
  export let autofocus = false;
  export let disabled = false;
  export let onAddPerson: (person: PersonUID) => void | Promise<void> = onAddPersonDefault;
  export let onRemovePerson: (person: PersonUID) => void | Promise<void> = onRemovePersonDefault;

  //$: console.log("persons", persons.contents);

  function onAddPersonDefault(person: PersonUID) {
    // <copied to="MailAutocomplete.onAddPerson()">
    if (!person || persons.contains(person)) {
      return;
    }
    persons.add(person);
    // </copied>
  }
  function onRemovePersonDefault(person: PersonUID) {
    if (!person) {
      return;
    }
    persons.remove(person);
  }
  let autocompleteEl: PersonAutocomplete;
  export function focus() {
    autocompleteEl?.focus();
  }
</script>

<style>
  .persons-autocomplete {
    container-type: inline-size;
    container-name: persons-autocomplete;
    flex-wrap: wrap;
    border-bottom: 1px solid rgb(0, 0, 0, 7%);
    align-items: center;
    padding: 3px 4px;
  }
  .input {
    margin-inline-start: 4px;
  }
  .persons-autocomplete > :global(*) {
    margin: 3.5px 3px;
  }
  .persons-autocomplete :global(input.autocomplete-input) {
    border: none;
  }
</style>
