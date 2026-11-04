<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<hbox class="address-field" class:chips class:disabled bind:this={fieldEl}
  on:click={onFieldClick}>
  {#each $addresses.each as recipient (recipient)}
    {#if recipient == editedRecipient}
      <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
      <hbox class="recipient edited-person" bind:this={editedEl} on:click|stopPropagation={() => editedNameEl.focus()}>
        <input class="name" type="text"
          bind:value={editedName}
          bind:this={editedNameEl}
          on:keydown={event => catchErrors(() => onEditedNameKeyDown(event))}
          aria-label={$t`Full name`}
          placeholder={$t`Full name`}
          spellcheck="false"
          {tabindex} />
        <span class="address">{recipient.emailAddress}</span>
      </hbox>
    {:else}
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <hbox class="recipient" class:selected={recipient == selected}
        title={recipient.emailAddress}
        on:click|stopPropagation={() => onSelect(recipient)}
        on:dblclick|stopPropagation={() => catchErrors(() => onEditName(recipient))}
        on:contextmenu|preventDefault|stopPropagation={event => onRecipientMenu(event, recipient)}>
        {#if chips}
          <PersonCircle name={displayName(recipient)}
            picture={recipient.person?.picture} colorKey={recipient.emailAddress} size={20} />
          <span class="name">{displayName(recipient)}</span>
          {#if !disabled}
            <button type="button" class="remove" tabindex={-1} title={$t`Remove`} aria-label={$t`Remove`}
              on:click|stopPropagation={() => remove(recipient)}>
              <RemoveIcon size={12} />
            </button>
          {/if}
        {:else}
          <span class="name">{displayName(recipient)}</span><span class="separator">;</span>
        {/if}
      </hbox>
    {/if}
  {/each}
  {#if !disabled}
    <hbox class="typed-person" class:new-person={hasNameField} bind:this={typedPersonEl}>
      <input type="text" class="typed" bind:this={inputEl} bind:value={typed}
        role="combobox" aria-label={label} aria-autocomplete="list"
        aria-expanded={isListOpen} aria-controls={listID}
        aria-activedescendant={isListOpen ? `${listID}-${highlighted}` : null}
        autocomplete="off" spellcheck="false"
        placeholder={$addresses.isEmpty ? placeholder : null}
        {tabindex} {autofocus}
        on:input={onInput}
        on:keydown={onKeyDown}
        on:paste={onPaste}
        on:blur={onBlur} />
      {#if hasNameField}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <hbox class="name-line" on:keydown={onNameLineKeyDown}>
          <input class="name" type="text"
            bind:value={name}
            bind:this={nameInputEl}
            on:focus={onNameFocus}
            on:input={() => isNameEdited = true}
            on:keydown={event => catchErrors(() => onNameKeyDown(event))}
            aria-label={$t`Full name`}
            placeholder={$t`Full name`}
            spellcheck="false"
            {tabindex} />
          {#if !knownPerson}
            <button type="button" class="addressbook" tabindex={-1}
              title={$t`Save the new contact in ${addressbook?.name}`}
              aria-label={$t`Save the new contact in ${addressbook?.name}`}
              aria-haspopup="menu" aria-expanded={isAddressbookMenuOpen}
              bind:this={addressbookButtonEl}
              on:mousedown|preventDefault
              on:click|stopPropagation={() => isAddressbookMenuOpen = !isAddressbookMenuOpen}>
              <AddressbookIcon size={16} />
              <ChevronDownIcon size={12} />
            </button>
            <Menu bind:isMenuOpen={isAddressbookMenuOpen} anchor={addressbookButtonEl} placement="bottom-start"
              autoFocus={false} on:close={() => nameInputEl?.focus()}>
              {#each $addressbooks.each as listedAddressbook (listedAddressbook.id)}
                <MenuItem label={listedAddressbook.name} selected={listedAddressbook == addressbook}
                  onClick={() => addressbook = listedAddressbook} />
              {/each}
            </Menu>
          {/if}
          <button type="button" class="add" tabindex={-1}
            title={$t`Add this person (Press ENTER)`}
            aria-label={$t`Add this person (Press ENTER)`}
            on:click={() => catchErrors(onAddNewPerson)}>
            <EnterKeyIcon size={14} />
          </button>
        </hbox>
      {/if}
    </hbox>
  {/if}
</hbox>
{#if isListOpen}
  <AutocompleteList {suggestions} bind:highlighted anchor={fieldEl} id={listID} on:select={event => choose(event.detail)} />
{/if}
<svelte:window on:click|capture={event => catchErrors(() => onClickOutside(event))} />
<ContextMenu bind:this={contextMenu}>
  <MenuItem label={$t`Copy`} icon={CopyIcon} onClick={() => onCopy(menuRecipient)} />
  <MenuItem label={$t`Cut`} icon={CutIcon} disabled={disabled} onClick={() => onCut(menuRecipient)} />
  <MenuItem label={$t`Remove`} icon={RemoveIcon} disabled={disabled} onClick={() => remove(menuRecipient)} />
  <MenuItem label={$t`Edit Name`} icon={EditIcon} disabled={disabled} onClick={() => onEditName(menuRecipient)} />
  <MenuDivider />
  <MenuItem label={menuRecipient?.findPerson() ? $t`Open Contact Card` : $t`Add to Contacts`}
    icon={ContactIcon} onClick={() => openPersonFromOtherApp(menuRecipient.createPerson(appGlobal.personalAddressbook))} />
</ContextMenu>

<script lang="ts">
  import { findPerson, nameFromEmailAddress, PersonUID } from "../../../logic/Abstract/PersonUID";
  import type { Person } from "../../../logic/Abstract/Person";
  import type { Addressbook } from "../../../logic/Contacts/Addressbook";
  import { searchContacts } from "../../../logic/Contacts/Search";
  import { UserError } from "../../../logic/util/util";
  import { catchErrors, showError, minorError } from "../../../frontend/Util/error";
  import AutocompleteList from "./AutocompleteList.svelte";
  import PersonCircle from "../../Contacts/Person/PersonCircle.svelte";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import Menu from "../../Shared/Menu/Menu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import RemoveIcon from "lucide-svelte/icons/x";
  import CopyIcon from "lucide-svelte/icons/copy";
  import CutIcon from "lucide-svelte/icons/scissors";
  import EditIcon from "lucide-svelte/icons/pencil";
  import ContactIcon from "lucide-svelte/icons/contact-round";
  import AddressbookIcon from "lucide-svelte/icons/book-user";
  import ChevronDownIcon from "lucide-svelte/icons/chevron-down";
  import EnterKeyIcon from "lucide-svelte/icons/corner-down-left";
  import type { ArrayColl } from "svelte-collections";
  import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
  import { t } from "../../../l10n/l10n";
  import { appGlobal } from "../../../logic/app";
  import { openPersonFromOtherApp } from "../../../frontend/Contacts/open";
  import { createEventDispatcher, tick } from "svelte";

  export let addresses: ArrayColl<PersonUID>;
  export let label: string;
  export let chips = false;
  export let disabled = false;
  export let autofocus = false;
  export let tabindex: number = null;
  export let placeholder: string = null;
  export let askForName = false;

  const dispatch = createEventDispatcher<{ add: PersonUID }>();
  const listID = "address-suggestions-" + Math.random().toString(36).slice(2);
  let fieldEl: HTMLElement;
  let typedPersonEl: HTMLElement;
  let inputEl: HTMLInputElement;
  let contextMenu: ContextMenu;
  let typed = "";
  let selected: PersonUID | null = null;
  let menuRecipient: PersonUID | null = null;
  let suggestions: PersonUID[] = [];
  let highlighted = 0;
  let searchCounter = 0;
  $: isListOpen = suggestions.length > 0 && !!typed.trim();

  export function focus() {
    inputEl?.focus();
  }

  export async function checkNames(): Promise<boolean> {
    let text = typed.trim();
    if (!text) {
      return true;
    }
    if (hasNameField && canCreate(typed)) {
      await addNewPerson();
      return true;
    }
    let { recipients: parsed, unresolved } = parseRecipientList(text);
    parsed.forEach(add);
    let stillUnresolved: string[] = [];
    for (let name of unresolved) {
      let found = await searchContacts(name, isAdded);
      if (found.length == 1) {
        add(found[0]);
      } else {
        stillUnresolved.push(name);
      }
    }
    typed = stillUnresolved.join("; ");
    if (stillUnresolved.length) {
      await updateSuggestions();
      if (!suggestions.length) {
        throw new UserError($t`No contact matches ${stillUnresolved.join("; ")}`);
      }
      return false;
    }
    return true;
  }

  function isAdded(recipient: PersonUID): boolean {
    return addresses.some(existing => existing.emailAddress == recipient.emailAddress);
  }

  function add(recipient: PersonUID) {
    if (!recipient || isAdded(recipient)) {
      return;
    }
    addresses.add(recipient);
    isNameEdited = false;
    dispatch("add", recipient);
  }

  function remove(recipient: PersonUID) {
    if (!recipient) {
      return;
    }
    addresses.remove(recipient);
    if (selected == recipient) {
      selected = null;
    }
  }

  function choose(recipient: PersonUID) {
    addAndClear(recipient);
    inputEl?.focus();
  }

  function addAndClear(recipient: PersonUID) {
    add(recipient);
    typed = "";
    suggestions = [];
  }

  function acceptTyped(): boolean {
    if (isListOpen && suggestions[highlighted]) {
      choose(suggestions[highlighted]);
      return true;
    }
    let { recipients: parsed, unresolved } = parseRecipientList(typed);
    if (!parsed.length) {
      return false;
    }
    parsed.forEach(add);
    typed = unresolved.join("; ");
    suggestions = [];
    return true;
  }

  async function updateSuggestions() {
    let thisSearch = ++searchCounter;
    let text = typed.trim();
    if (text.length < 2) {
      suggestions = [];
      return;
    }
    let found = await searchContacts(text, isAdded);
    if (thisSearch != searchCounter) {
      return;
    }
    suggestions = found.slice(0, 12);
    highlighted = 0;
  }

  function onInput() {
    selected = null;
    updateSuggestions().catch(minorError);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.isComposing) {
      return;
    }
    if (hasNameField) {
      catchErrors(() => onNewPersonKeyDown(event));
      if (event.defaultPrevented) {
        return;
      }
    }
    let atStart = inputEl.selectionStart == 0 && inputEl.selectionEnd == 0;
    if (event.key == "ArrowDown" && isListOpen) {
      event.preventDefault();
      highlighted = (highlighted + 1) % suggestions.length;
    } else if (event.key == "ArrowUp" && isListOpen) {
      event.preventDefault();
      highlighted = (highlighted - 1 + suggestions.length) % suggestions.length;
    } else if (event.key == "Escape" && isListOpen) {
      event.preventDefault();
      event.stopPropagation();
      suggestions = [];
    } else if ((event.key == "Enter" && !event.ctrlKey && !event.metaKey) || event.key == ";" || event.key == ",") {
      if (typed.trim() && acceptTyped()) {
        event.preventDefault();
      } else if (event.key == "Enter" && typed.trim()) {
        event.preventDefault();
        checkNames().catch(showError);
      }
    } else if (event.key == "Tab" && !event.shiftKey && typed.trim()) {
      acceptTyped();
    } else if ((event.key == "Backspace" || event.key == "Delete") && selected) {
      event.preventDefault();
      remove(selected);
    } else if ((event.key == "Backspace" || event.key == "ArrowLeft") && atStart && addresses.hasItems) {
      event.preventDefault();
      selected = addresses.getIndex(addresses.length - 1);
    } else if (event.key != "Shift" && event.key != "Control") {
      selected = null;
    }
  }

  function onPaste(event: ClipboardEvent) {
    let text = event.clipboardData?.getData("text/plain") ?? "";
    let { recipients: parsed, unresolved } = parseRecipientList(text);
    if (!parsed.length || askForName && splitRecipientList(text).length == 1 && !text.includes("<")) {
      return;
    }
    event.preventDefault();
    parsed.forEach(add);
    typed = (typed + " " + unresolved.join("; ")).trim();
  }

  function onBlur() {
    selected = null;
    if (hasNameField) {
      return;
    }
    if (typed.trim()) {
      let { recipients: parsed, unresolved } = parseRecipientList(typed);
      parsed.forEach(add);
      typed = unresolved.join("; ");
    }
    suggestions = [];
  }

  function parseRecipientList(text: string): { recipients: PersonUID[], unresolved: string[] } {
    let recipients: PersonUID[] = [];
    let unresolved: string[] = [];
    for (let part of splitRecipientList(text)) {
      let recipient = parseRecipient(part);
      if (recipient) {
        recipients.push(recipient);
      } else {
        unresolved.push(part);
      }
    }
    return { recipients, unresolved };
  }

  function parseRecipient(text: string): PersonUID | null {
    let match = text.trim().match(/^(.*?)\s*<([^<>]*)>$/);
    let name = match ? match[1].replace(/^"(.*)"$/, "$1").trim() : "";
    let emailAddress = (match ? match[2] : text).trim();
    if (!sanitize.emailAddress(emailAddress, null)) {
      return null;
    }
    return new PersonUID(emailAddress, name || nameFromEmailAddress(emailAddress));
  }

  function splitRecipientList(text: string): string[] {
    return splitOutsideQuotes(text, [";", "\n"])
      .flatMap(part => joinNameParts(splitOutsideQuotes(part, [","])))
      .map(part => part.trim())
      .filter(part => !!part);
  }

  function splitOutsideQuotes(text: string, separators: string[]): string[] {
    let parts: string[] = [];
    let current = "";
    let inQuotes = false;
    let inBrackets = false;
    for (let char of text) {
      if (char == '"') {
        inQuotes = !inQuotes;
      } else if (char == "<") {
        inBrackets = true;
      } else if (char == ">") {
        inBrackets = false;
      } else if (!inQuotes && !inBrackets && separators.includes(char)) {
        parts.push(current);
        current = "";
        continue;
      }
      current += char;
    }
    parts.push(current);
    return parts;
  }

  function joinNameParts(parts: string[]): string[] {
    let joined: string[] = [];
    let pending: string[] = [];
    for (let part of parts) {
      pending.push(part);
      if (part.includes("@")) {
        joined.push(pending.join(","));
        pending = [];
      }
    }
    if (pending.length) {
      joined.push(pending.join(","));
    }
    return joined;
  }

  function onFieldClick(event: MouseEvent) {
    selected = null;
    if (event.target == fieldEl || event.target == typedPersonEl) {
      inputEl?.focus();
    }
  }

  function onSelect(recipient: PersonUID) {
    selected = recipient;
    inputEl?.focus();
  }

  function onRecipientMenu(event: MouseEvent, recipient: PersonUID) {
    selected = recipient;
    menuRecipient = recipient;
    contextMenu.onContextMenu(event);
  }

  async function onCopy(recipient: PersonUID) {
    await navigator.clipboard.writeText(clipboardText(recipient));
  }

  async function onCut(recipient: PersonUID) {
    await onCopy(recipient);
    remove(recipient);
  }

  async function onClickOutside(event: MouseEvent) {
    let target = event.target as Node;
    if (editedRecipient && !editedEl?.contains(target)) {
      await saveEditedName();
    }
    if (!hasNameField || typedPersonEl.contains(target) || document.getElementById(listID)?.contains(target)) {
      return;
    }
    if (isListOpen && suggestions[highlighted]) {
      addAndClear(suggestions[highlighted]);
    } else if (canCreate(typed)) {
      await addNewPerson();
    }
  }

  async function onNewPersonKeyDown(event: KeyboardEvent) {
    let hasResult = isListOpen && !!suggestions[highlighted];
    if (event.key == "Tab" && !event.shiftKey ||
        event.key == "Enter" && !event.ctrlKey && !event.metaKey && !hasResult && canCreate(typed)) {
      event.preventDefault();
      await focusName();
    } else if ((event.key == ";" || event.key == ",") && !hasResult && canCreate(typed)) {
      event.preventDefault();
      await addNewPerson();
    }
  }

  const addressbooks = appGlobal.addressbooks;
  let addressbookButtonEl: HTMLButtonElement;
  let isAddressbookMenuOpen = false;

  function onNameLineKeyDown(event: KeyboardEvent) {
    if (event.key != "Escape" || !isAddressbookMenuOpen) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    isAddressbookMenuOpen = false;
  }

  // <copied from="../../../frontend/Contacts/PersonAutocomplete/PersonAutocomplete.svelte">
  function canCreate(typedText: string) {
    return typedText && sanitize.emailAddress(typedText, "");
  }

  let name = "";
  let isNameEdited = false;
  let knownPerson: Person = null;
  let nameInputEl: HTMLInputElement;
  let addressbook: Addressbook = appGlobal.collectedAddressbook;
  $: isEMailAddressTyped = typed.includes("@") && !/[<;,]/.test(typed);
  $: hasNameField = askForName && isEMailAddressTyped;
  $: typed, onTypedTextChanged();
  function onTypedTextChanged() {
    knownPerson = null;
    if (hasNameField && !isNameEdited) {
      name = nameFromEmailAddress(typed.trim());
    }
  }

  function onNameFocus() {
    suggestions = [];
    knownPerson = findPerson(typed.trim());
    if (knownPerson?.name && !isNameEdited) {
      name = knownPerson.name;
    }
  }

  async function focusName() {
    nameInputEl.focus();
    if (isNameEdited) {
      return;
    }
    await tick(); // `onNameFocus()` may change the name, and writing it into the field moves the cursor to the end
    nameInputEl.setSelectionRange(0, 0);
  }

  async function onNameKeyDown(event: KeyboardEvent) {
    if (!(event.key == "Enter" || event.key == "Tab" && !event.shiftKey)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    await onAddNewPerson();
  }

  async function onAddNewPerson() {
    focus();
    await addNewPerson();
  }

  async function addNewPerson() {
    let emailAddress = sanitize.emailAddress(typed.trim());
    let personUID = new PersonUID(emailAddress, name.trim() || nameFromEmailAddress(emailAddress));
    let newPerson = personUID.findPerson() ? null : personUID.createPerson(addressbook);
    addAndClear(personUID);
    await newPerson?.save();
  }
  // </copied>

  let editedRecipient: PersonUID | null = null;
  let editedName = "";
  let editedEl: HTMLElement;
  let editedNameEl: HTMLInputElement;

  async function onEditName(recipient: PersonUID) {
    if (disabled) {
      return;
    }
    selected = null;
    editedRecipient = recipient;
    editedName = recipient.name ?? "";
    await tick();
    editedNameEl.focus();
    editedNameEl.select();
  }

  async function onEditedNameKeyDown(event: KeyboardEvent) {
    if (event.key == "Escape") {
      event.preventDefault();
      event.stopPropagation();
      editedRecipient = null;
      focus();
      return;
    }
    if (!(event.key == "Enter" || event.key == "Tab" && !event.shiftKey)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    focus();
    await saveEditedName();
  }

  async function saveEditedName() {
    let recipient = editedRecipient;
    let newName = editedName.trim();
    editedRecipient = null;
    if (!newName || newName == recipient.name) {
      return;
    }
    recipient.name = newName;
    // <copied from="../../../frontend/Contacts/PersonAutocomplete/PersonPopup.svelte" onLoad() and onSave()>
    let person = recipient.createPerson(appGlobal.collectedAddressbook);
    if (person.addressbook && person.addressbook != appGlobal.collectedAddressbook) {
      return;
    }
    person.name = newName;
    await person.save();
    // </copied>
  }

  /* <copied from="../Message/RecipientsList.svelte"> */
  function displayName(recipient: PersonUID): string {
    return recipient.name || recipient.emailAddress;
  }

  function clipboardText(recipient: PersonUID): string {
    return recipient.name && recipient.name != recipient.emailAddress
      ? `${recipient.name} <${recipient.emailAddress}>`
      : recipient.emailAddress;
  }
  /* </copied> */
</script>

<style>
  .address-field {
    flex: 1 1 0;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    column-gap: 4px;
    row-gap: 2px;
    min-height: 30px;
    padding: 1px 0;
    cursor: text;
    container-type: inline-size;
    container-name: address-field;
  }
  .recipient {
    align-items: center;
    max-width: 100%;
    cursor: default;
    border-radius: 2px;
  }
  .name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .address-field:not(.chips) span.name {
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-color: var(--lo-fg-secondary);
  }
  .address-field:not(.chips) .recipient.selected .name {
    background-color: var(--lo-selected-bg);
  }
  .chips .recipient {
    gap: 6px;
    height: 24px;
    padding: 0 2px 0 2px;
    border-radius: 12px;
    background-color: var(--lo-pane-alt-bg);
    border: 1px solid var(--lo-border);
  }
  .chips .recipient:hover {
    background-color: var(--lo-hover-bg);
  }
  .chips .recipient.selected {
    background-color: var(--lo-selected-bg);
    border-color: var(--lo-accent);
  }
  .remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--lo-fg-secondary);
  }
  .remove:hover {
    background-color: var(--lo-pressed-bg);
    color: var(--lo-fg);
  }
  .typed-person {
    flex: 1 1 80px;
    min-width: 80px;
    align-items: center;
  }
  .typed,
  input.name {
    height: 26px;
    padding: 0 2px;
    border: none;
    outline: none;
    background: transparent;
    color: var(--lo-fg);
    font: inherit;
  }
  .typed {
    flex: 1 1 0;
    min-width: 0;
  }
  .typed-person.new-person,
  .recipient.edited-person {
    flex: none;
    max-width: 100%;
    height: 28px;
    box-sizing: border-box;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
  }
  .chips .typed-person.new-person,
  .chips .recipient.edited-person {
    border-radius: 14px;
  }
  .typed-person.new-person:focus-within,
  .recipient.edited-person {
    border-color: var(--lo-accent);
    box-shadow: inset 0 -1px 0 var(--lo-accent);
  }
  .new-person .typed {
    flex: none;
    width: auto;
    field-sizing: content;
    min-width: 2ch;
    height: 100%;
    padding: 0 8px;
    color: var(--lo-fg-secondary);
  }
  .new-person .typed:focus {
    color: var(--lo-fg);
  }
  .name-line {
    align-items: center;
    gap: 2px;
    height: 100%;
    padding-inline-end: 3px;
    border-inline-start: 1px solid var(--lo-divider);
  }
  .name-line input.name,
  .edited-person input.name {
    width: auto;
    min-width: 8em;
    height: 100%;
    padding: 0 8px;
    field-sizing: content;
  }
  .name-line button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1px;
    height: 20px;
    padding: 0 3px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
  }
  .name-line button:hover,
  .name-line button[aria-expanded="true"] {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .name-line button.add {
    width: 22px;
    background-color: var(--lo-accent);
    color: var(--lo-accent-fg);
  }
  .name-line button.add:hover {
    background-color: var(--lo-accent-hover);
    color: var(--lo-accent-fg);
  }
  .chips .name-line button.add {
    border-radius: 10px;
  }
  .recipient.edited-person {
    gap: 0;
    padding: 0 8px 0 0;
    cursor: text;
  }
  .edited-person .address {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--lo-fg-secondary);
  }
  @container address-field (max-width: 500px) {
    .typed-person.new-person {
      flex: 1 0 100%;
      flex-direction: column;
      align-items: stretch;
      height: unset;
    }
    .chips .typed-person.new-person {
      border-radius: 14px;
    }
    .new-person .typed {
      width: 100%;
      field-sizing: fixed;
      height: 26px;
    }
    .name-line {
      height: 26px;
      border-inline-start: none;
      border-block-start: 1px solid var(--lo-divider);
    }
    .name-line input.name {
      flex: 1 0 0;
      min-width: 0;
    }
  }
</style>
