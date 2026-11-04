<Dialog title={title ?? $t`Select Names: ${addressbook?.name ?? $t`All address books`}`} on:close={onCancelClicked} width="800px" height="620px">
  <grid class="search-grid">
    <hbox class="search-label">
      <label for="select-names-search" class="label">{$t`Search`}</label>
      <Radio label={$t`All columns`} bind:group={nameOnly} value={false} />
      <Radio label={$t`Name only`} bind:group={nameOnly} value={true} />
    </hbox>
    <span class="label">{$t`Address Book`}</span>
    <hbox class="search">
      <input id="select-names-search" class="lo-text-field" type="text" bind:value={typedTerm} autofocus
        on:input={onTyped} on:keydown={onSearchKey} />
      <button type="button" class="icon-button" title={$t`Go *=> Start the search`} aria-label={$t`Go *=> Start the search`} on:click={onGo}>
        <GoIcon size={14} />
      </button>
      <button type="button" class="icon-button" title={$t`Clear`} aria-label={$t`Clear`}
        disabled={!typedTerm} on:click={onClear}>
        <ClearIcon size={14} />
      </button>
    </hbox>
    <ComboBox label={$t`Address Book`} options={addressbookOptions($addressbooks.contents, $searchOnlyAddressbooks.contents)}
      bind:value={addressbook} width="220px" />
  </grid>
  <vbox flex class="list">
    <FastList items={foundPersons} bind:selectedItems columns="minmax(150px, 1.4fr) minmax(90px, 1fr) minmax(110px, 1fr) minmax(90px, 1fr) minmax(90px, 1fr) minmax(170px, 1.5fr)">
      <svelte:fragment slot="header">
        <hbox class="column-header">{$t`Name`}</hbox>
        <hbox class="column-header">{$t`Title *=> Job title of the person`}</hbox>
        <hbox class="column-header">{$t`Business Phone`}</hbox>
        <hbox class="column-header">{$t`Department`}</hbox>
        <hbox class="column-header">{$t`Company`}</hbox>
        <hbox class="column-header">{$t`E-mail Address`}</hbox>
      </svelte:fragment>
      <svelte:fragment slot="row" let:item={person}>
        <hbox class="cell name" on:dblclick={() => onAdd(defaultPick)}>
          <UserIcon size={14} />
          <span>{person.name ?? ""}</span>
        </hbox>
        <hbox class="cell" on:dblclick={() => onAdd(defaultPick)}><span>{person.position ?? ""}</span></hbox>
        <hbox class="cell" on:dblclick={() => onAdd(defaultPick)}><span>{businessPhone(person)}</span></hbox>
        <hbox class="cell" on:dblclick={() => onAdd(defaultPick)}><span>{person.department ?? ""}</span></hbox>
        <hbox class="cell" on:dblclick={() => onAdd(defaultPick)}><span>{person.company ?? ""}</span></hbox>
        <hbox class="cell" on:dblclick={() => onAdd(defaultPick)}>
          <span>{person.emailAddresses.sortBy(entry => entry.preference).first?.value ?? ""}</span>
        </hbox>
      </svelte:fragment>
    </FastList>
    {#if $foundPersons.isEmpty}
      <hbox class="empty lo-secondary">
        {#if searchTerm}
          {$t`No matching names`}
        {:else if isSearchOnly}
          {$t`Type a name and select Go to search this address book`}
        {:else}
          {$t`This address book has no names with an email address`}
        {/if}
      </hbox>
    {/if}
  </vbox>
  <grid class="picks">
    {#each shownFields as field}
      <DialogButton label={field.label + " ->"} onClick={() => onAdd(field)}
        disabled={$selectedItems.isEmpty && $t`Select a name first`} />
      <hbox class="pick-field">
        <MailAutocomplete addresses={field.picks} label={field.label} />
      </hbox>
    {/each}
  </grid>
  <svelte:fragment slot="footer">
    <DialogButton label={$t`OK`} primary onClick={onOKClicked} />
    <DialogButton label={$t`Cancel`} onClick={onCancelClicked} />
  </svelte:fragment>
</Dialog>

<script lang="ts" context="module">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { writable } from "svelte/store";

  export enum RecipientField {
    To = "to",
    Cc = "cc",
    Bcc = "bcc",
  }

  export const openSelectNames = writable<{ mail: EMail, field: RecipientField } | null>(null);
</script>

<script lang="ts">
  import type { Person } from "../../../logic/Abstract/Person";
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import type { Addressbook } from "../../../logic/Contacts/Addressbook";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import Radio from "../../Shared/Form/Radio.svelte";
  import type { ComboOption } from "../../Shared/Form/ComboOption";
  import { appGlobal } from "../../../logic/app";
  import { searchPersons, SelectNamesField } from "./SelectNames";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import MailAutocomplete from "./MailAutocomplete.svelte";
  import FastList from "../../../frontend/Shared/FastList.svelte";
  import UserIcon from "lucide-svelte/icons/user-round";
  import GoIcon from "lucide-svelte/icons/arrow-right";
  import ClearIcon from "lucide-svelte/icons/x";
  import { ArrayColl } from "svelte-collections";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let mail: EMail = null;
  export let defaultField: RecipientField = RecipientField.To;
  export let persons: ArrayColl<PersonUID> = null;
  export let label: string = null;
  export let single = false;
  export let title: string = null;

  const dispatch = createEventDispatcher<{ ok: void, close: void }>();

  const shownFields = mail
    ? [
      new SelectNamesField($t`To`, mail.to.contents),
      new SelectNamesField($t`Cc`, mail.cc.contents),
      new SelectNamesField($t`Bcc`, mail.bcc.contents),
    ]
    : [new SelectNamesField(label, persons?.contents ?? [], single)];
  const defaultPick = mail
    ? shownFields[[RecipientField.To, RecipientField.Cc, RecipientField.Bcc].indexOf(defaultField)]
    : shownFields[0];

  let addressbooks = appGlobal.addressbooks;
  let searchOnlyAddressbooks = appGlobal.searchOnlyAddressbooks;
  let addressbook: Addressbook = null;

  function addressbookOptions(books: Addressbook[], searchOnlyBooks: Addressbook[]): ComboOption<Addressbook | null>[] {
    return [
      { value: null, label: $t`All address books` },
      ...[...books, ...searchOnlyBooks].map(book => ({ value: book, label: book.name })),
    ];
  }
  let nameOnly = false;
  let typedTerm = "";
  let searchTerm = "";
  let selectedItems = new ArrayColl<Person>();
  $: isSearchOnly = !!addressbook && $searchOnlyAddressbooks.some(book => book == addressbook);
  $: searchedBooks = addressbook ? [addressbook]
    : searchTerm ? [...$addressbooks.each, ...$searchOnlyAddressbooks.each]
    : $addressbooks.contents;
  $: foundPersons = isSearchOnly && !searchTerm
    ? new ArrayColl<Person>()
    : searchPersons(searchedBooks, searchTerm, nameOnly);

  function onTyped() {
    if (nameOnly) {
      searchTerm = typedTerm;
    }
  }

  function onGo() {
    searchTerm = typedTerm;
  }

  function onClear() {
    typedTerm = "";
    searchTerm = "";
  }

  function onSearchKey(event: KeyboardEvent) {
    if (event.key == "Enter") {
      event.preventDefault();
      onGo();
    }
  }

  function onAdd(field: SelectNamesField) {
    field.add(selectedItems);
  }

  function businessPhone(person: Person): string {
    let phones = person.phoneNumbers.sortBy(entry => entry.preference);
    return (phones.find(entry => entry.purpose == "work") ?? phones.first)?.value ?? "";
  }

  function onOKClicked() {
    if (mail) {
      mail.to.replaceAll(shownFields[0].picks.contents);
      mail.cc.replaceAll(shownFields[1].picks.contents);
      mail.bcc.replaceAll(shownFields[2].picks.contents);
    } else if (persons) {
      persons.replaceAll(shownFields[0].picks.contents);
    }
    dispatch("ok");
    dispatch("close");
  }

  function onCancelClicked() {
    dispatch("close");
  }
</script>

<style>
  .search-grid {
    grid-template-columns: 1fr 280px;
    align-items: center;
    gap: 4px 24px;
    margin-block-end: 12px;
  }
  .search-label {
    align-items: center;
    gap: 12px;
  }
  .label {
    font-weight: 600;
  }
  .search {
    align-items: center;
    gap: 4px;
  }
  .search input {
    flex: 1 1 auto;
    min-width: 0;
  }
  .icon-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
    color: var(--lo-fg);
  }
  .icon-button:hover:not(:disabled) {
    background-color: var(--lo-hover-bg);
  }
  .icon-button:disabled {
    color: var(--lo-fg-disabled);
  }
  .list {
    position: relative;
    min-height: 160px;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
    overflow-x: auto;
  }
  /* <copied to="../Rules/Rules.svelte"> */
  .list :global(.fast-list .header > *) {
    padding: 4px 8px;
    border-block-end: 1px solid var(--lo-divider);
    border-inline-end: 1px solid var(--lo-divider);
    background-color: var(--lo-pane-alt-bg);
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
    white-space: nowrap;
    overflow: hidden;
    position: sticky;
    top: 0;
  }
  /* </copied> */
  .cell {
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 8px !important;
    white-space: nowrap;
    overflow: hidden;
    cursor: default;
  }
  .cell.name :global(svg) {
    flex-shrink: 0;
    color: var(--lo-fg-secondary);
  }
  .cell span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .empty {
    position: absolute;
    inset: 40px 0 auto 0;
    justify-content: center;
  }
  .picks {
    grid-template-columns: 96px 1fr;
    align-items: center;
    gap: 8px 8px;
    margin-block-start: 12px;
  }
  .picks > :global(button) {
    width: 96px;
  }
  .pick-field {
    min-width: 0;
    max-height: 64px;
    overflow-y: auto;
    padding: 0 6px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
  }
  .pick-field:focus-within {
    border-color: var(--lo-accent);
  }
</style>
