<vbox class="advanced-search">
  <grid class="fields">
    {#if showAccount}
      <span class="label">{$t`Search In`}</span>
      <ComboBox label={$t`Search In`} options={scopeOptions} bind:value={draft.scope} width="100%" />
    {/if}
    {#if showSearchTerm}
      <span class="label">{$t`Keywords *=> Words to search for`}</span>
      <TextField label={$t`Keywords *=> Words to search for`} bind:value={draft.keywords} classes="underlined"
        tooltip={$t`Words in the subject or the message text`}
        on:keydown={onEnter} />
    {/if}
    <span class="label">{$t`From`}</span>
    <hbox class="person-field underlined">
      {#if from}
        <hbox class="person-chip">
          <PersonCircle name={from.name} picture={from.picture} size={20} />
          <span class="name">{from.name}</span>
          <button type="button" class="chip-remove" title={$t`Remove`} aria-label={$t`Remove`}
            on:click={() => { draft.setFrom(null); draft = draft; }}>
            <RemoveIcon size={12} />
          </button>
        </hbox>
      {/if}
      <hbox flex />
      <button type="button" class="pick" title={$t`Select Names`} aria-label={$t`Select Names`}
        on:click={() => picking = Direction.From}>
        <AddressBookIcon size={16} />
      </button>
    </hbox>
    <span class="label">{$t`To`}</span>
    <hbox class="person-field underlined">
      {#if to}
        <hbox class="person-chip">
          <PersonCircle name={to.name} picture={to.picture} size={20} />
          <span class="name">{to.name}</span>
          <button type="button" class="chip-remove" title={$t`Remove`} aria-label={$t`Remove`}
            on:click={() => { draft.setTo(null); draft = draft; }}>
            <RemoveIcon size={12} />
          </button>
        </hbox>
      {/if}
      <hbox flex />
      <button type="button" class="pick" title={$t`Select Names`} aria-label={$t`Select Names`}
        on:click={() => picking = Direction.To}>
        <AddressBookIcon size={16} />
      </button>
    </hbox>
    <!-- {#if showDates}
      <span class="label">{$t`Received *=> Date when the email was received`}</span>
      <hbox class="dates">
        <DateField label={$t`Start Date`} placeholder={$t`Start Date`} bind:date={draft.startDate} />
        <span class="lo-secondary">{$t`to *=> as in: Monday to Friday`}</span>
        <DateField label={$t`End Date`} placeholder={$t`End Date`} bind:date={draft.endDate} />
      </hbox>
    {/if} -->
    <span class="label">{$t`Categories *=> Categories of the email`}</span>
    <hbox class="categories-field">
      <button type="button" class="lo-text-field combo" bind:this={categoriesButton}
        disabled={!$tags.hasItems}
        on:click|stopPropagation={() => isCategoriesOpen = !isCategoriesOpen}>
        <hbox flex class="combo-value">
          {#each draft.tags as tag (tag)}
            <hbox class="category"><CategorySquare {tag} />{tag.name}</hbox>
          {:else}
            <span class="lo-secondary">{$tags.hasItems ? $t`Any *=> Any category` : $t`No categories yet`}</span>
          {/each}
        </hbox>
        <ChevronIcon size={14} />
      </button>
      <Menu bind:isMenuOpen={isCategoriesOpen} anchor={categoriesButton} placement="bottom-start">
        <CategoryMenuItems bind:selected={draft.tags} keepOpen />
      </Menu>
    </hbox>
    <span class="label">{$t`Read status`}</span>
    <ComboBox label={$t`Read status`} options={readOptions} bind:value={draft.readStatus} width="100%" />
    <span class="label">{$t`Size *=> Size of the file`}</span>
    <ComboBox label={$t`Size *=> Size of the file`} options={sizeOptions} bind:value={draft.size} width="100%" />
    <span class="label">{$t`Attachments`}</span>
    <Checkbox label={$t`Has Attachments`} bind:checked={draft.hasAttachment} />
    <span class="label">{$t`Flagged *=> State of the email that has been flagged for follow-up`}</span>
    <Checkbox label={$t`Flagged for follow up`} bind:checked={draft.flagged} />
    <span class="label">{$t`Replied *=> State of the email that has been replied to`}</span>
    <Checkbox label={$t`I replied to it`} bind:checked={draft.replied} />
  </grid>
  {#if showButtons}
    <hbox class="buttons">
      <hbox flex />
      <DialogButton label={$t`Search`} primary onClick={() => { dispatch("search"); }} />
      <DialogButton label={$t`Clear filters`} onClick={() => { draft.clear(); draft = draft; }} />
    </hbox>
  {/if}
</vbox>
{#if picking}
  <SearchPersonDialog
    fieldLabel={picking == Direction.To ? $t`To` : $t`From`}
    person={picking == Direction.To ? to : from}
    on:pick={event => onPicked(event.detail)}
    on:close={() => picking = null} />
{/if}

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import type { Person } from "../../../logic/Abstract/Person";
  import { availableTags } from "../../../logic/Abstract/Tag";
  import { isScopeAvailable, scopeLabel, SearchScope } from "./MailSearch";
  import { AdvancedSearchDraft, ReadStatus } from "./AdvancedSearchDraft";
  import { SizeRange, sizeRangeLabel, namedSizeRanges } from "./SearchRanges";
  import CategoryMenuItems from "./CategoryMenuItems.svelte";
  import CategorySquare from "../../Shared/Tag/CategorySquare.svelte";
  import SearchPersonDialog from "./SearchPersonDialog.svelte";
  import PersonCircle from "../../Contacts/Person/PersonCircle.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import Menu from "../../Shared/Menu/Menu.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import TextField from "../../Shared/Form/TextField.svelte";
  // import DateField from "../../Shared/Form/DateField.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import type { ComboOption } from "../../Shared/Form/ComboOption";
  import AddressBookIcon from "lucide-svelte/icons/book-user";
  import RemoveIcon from "lucide-svelte/icons/x";
  import ChevronIcon from "lucide-svelte/icons/chevron-down";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let draft: AdvancedSearchDraft;
  export let account: MailAccount | null = null;
  export let folder: Folder | null = null;
  export let showAccount = true;
  export let showSearchTerm = true;
  export let showButtons = true;
  // export let showDates = true;
  const dispatch = createEventDispatcher<{ search: void }>();

  enum Direction {
    From = "from",
    To = "to",
  }

  $: scopeOptions = [SearchScope.AllAccounts, SearchScope.CurrentAccount, SearchScope.CurrentFolder]
    .map(scope => ({
      value: scope,
      label: scopeLabel(scope),
      disabled: !isScopeAvailable(scope, account, folder),
    })) as ComboOption<SearchScope>[];
  const readOptions: ComboOption<ReadStatus>[] = [
    { value: ReadStatus.All, label: $t`All` },
    { value: ReadStatus.Read, label: $t`Read *=> State of the message that has been read` },
    { value: ReadStatus.Unread, label: $t`Unread *=> State of the message that has not been read` },
  ];
  const sizeOptions: ComboOption<SizeRange>[] = [SizeRange.Any, ...namedSizeRanges]
    .map(size => ({ value: size, label: sizeRangeLabel(size) }));
  const tags = availableTags;
  let categoriesButton: HTMLButtonElement;
  let isCategoriesOpen = false;
  let picking: Direction | null = null;
  $: from = draft.isOutgoing === true ? null : draft.person;
  $: to = draft.isOutgoing === true ? draft.person : null;

  function onPicked(person: Person | null) {
    if (picking == Direction.To) {
      draft.setTo(person);
    } else {
      draft.setFrom(person);
    }
    draft = draft;
  }

  function onEnter(event: KeyboardEvent) {
    if (event.key == "Enter") {
      event.preventDefault();
      dispatch("search");
    }
  }
</script>

<style>
  .advanced-search {
    gap: 12px;
  }
  .fields {
    grid-template-columns: max-content minmax(0, 1fr);
    grid-auto-rows: 32px;
    align-items: center;
    gap: 4px 16px;
  }
  .label {
    color: var(--lo-fg);
  }
  .underlined,
  .advanced-search :global(.lo-field.underlined) {
    box-sizing: border-box;
    height: 32px;
    padding: 0 4px;
    border: none;
    border-bottom: 1px solid var(--lo-input-border);
    border-radius: 0;
    background-color: transparent;
    color: var(--lo-fg);
    font: inherit;
  }
  .advanced-search :global(.lo-field.underlined:focus),
  .person-field:focus-within {
    outline: none;
    box-shadow: none;
    border-bottom: 2px solid var(--lo-accent);
  }
  .person-field {
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .person-chip {
    align-items: center;
    gap: 6px;
    padding: 2px 4px 2px 2px;
    border-radius: 14px;
    background-color: var(--lo-accent-tint);
  }
  .person-chip .name {
    white-space: nowrap;
  }
  .chip-remove,
  .pick {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border: none;
    border-radius: var(--lo-radius-small);
    background-color: transparent;
    color: var(--lo-fg-secondary);
  }
  .chip-remove:hover,
  .pick:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .pick {
    color: var(--lo-accent-text);
  }
  /* .dates {
    align-items: center;
    gap: 12px;
  }
  .dates :global(.lo-datefield) {
    flex: 1 1 0;
    min-width: 0;
  } */
  .combo {
    display: flex;
    align-items: center;
    gap: 6px;
    box-sizing: border-box;
    width: 100%;
    height: 32px;
    text-align: start;
  }
  .combo:disabled {
    color: var(--lo-fg-disabled);
  }
  .combo-value {
    gap: 10px;
    overflow: hidden;
    white-space: nowrap;
  }
  .category {
    align-items: center;
    gap: 4px;
  }
  .categories-field {
    min-width: 0;
  }
  .buttons {
    gap: 8px;
  }
</style>
