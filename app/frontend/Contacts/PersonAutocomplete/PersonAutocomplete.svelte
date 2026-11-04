<hbox flex class="person-autocomplete"
  class:new-person={hasNameField}
  bind:this={topEl}
  on:keydown={event => catchErrors(() => onKeyDown(event))}>
  <Autocomplete
    onChange={person => catchErrors(() => addPerson(person))}
    searchFunction={search}
    delay={200}
    minCharactersToSearch={2}
    localFiltering={false}
    localSorting={false}
    closeOnBlur={false}
    hideArrow={true}
    noResultsText={$t`No person found`}
    bind:text={typedText}
    create={() => catchErrors(() => canCreate(typedText))}
    createText={sanitize.emailAddress(typedText, "")
      ? $t`Add this person (Press ENTER)`
      : $t`Enter a person from your address book, or an email address`}
    onCreate={(text) => catchErrors(() => onCreate(text))}
    {placeholder}
    {autofocus}
    tabIndex={tabindex}
    >
    <hbox slot="loading">{$t`Loading...`}</hbox>
    <svelte:fragment slot="item" let:item={person}>
      <PersonAutocompleteResult {person}>
        <slot name="result-bottom-row" slot="bottom-row" {person} />
      </PersonAutocompleteResult>
    </svelte:fragment>
  </Autocomplete>
  {#if hasNameField}
    <hbox class="name-line">
      <input class="name" type="text"
        bind:value={name}
        bind:this={nameInputEl}
        on:focus={onNameFocus}
        on:input={() => isNameEdited = true}
        on:keydown={event => catchErrors(() => onNameKeyDown(event))}
        placeholder={$t`Full name`}
        {tabindex} />
      {#if !knownPerson}
        <AccountDropDown
          bind:selectedAccount={addressbook}
          accounts={appGlobal.addressbooks}
          filterByWorkspace={false}
          icon={AddressbookIcon}
          iconSize="16px"
          withLabel={false}
          />
      {/if}
      <RoundButton
        label={$t`Add this person (Press ENTER)`}
        icon={EnterKeyIcon}
        iconSize="14px"
        padding="4px"
        border={false}
        onClick={onAddNewPerson}
        />
    </hbox>
  {/if}
</hbox>
<svelte:window on:click|capture={event => catchErrors(() => onClickOutside(event))} />

<script lang="ts">
  import { findPerson, nameFromEmailAddress, PersonUID } from "../../../logic/Abstract/PersonUID";
  import type { Person } from "../../../logic/Abstract/Person";
  import type { Addressbook } from "../../../logic/Contacts/Addressbook";
  import { searchContacts } from "../../../logic/Contacts/Search";
  import { appGlobal } from "../../../logic/app";
  import PersonAutocompleteResult from "./PersonAutocompleteResult.svelte";
  import AccountDropDown from "../../Shared/AccountDropDown.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import AddressbookIcon from "lucide-svelte/icons/book-user";
  import EnterKeyIcon from "lucide-svelte/icons/corner-down-left";
  import { ArrayColl, type Collection } from "svelte-collections";
  // <https://github.com/pstanoev/simple-svelte-autocomplete>
  // <http://simple-svelte-autocomplete.surge.sh>
  import Autocomplete from 'simple-svelte-autocomplete';
  import { tick } from 'svelte';
  import { catchErrors, showError } from "../../Util/error";
  import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
  import { UserError } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";

  export let skipPersons: Collection<PersonUID> = new ArrayColl<PersonUID>();
  export let skipPersonFunc = (person: PersonUID) => !!skipPersons.find(e => e.emailAddress == person.emailAddress);
  export let placeholder = $t`Add person`;
  export let tabindex = null;
  export let autofocus = false;
  export let typedText: string = ""; /* in/out */
  export let onAddPerson: (person: PersonUID) => void | Promise<void>;
  export let askForName = false;

  async function search(inputStr: string) {
    try {
      return await searchContacts(inputStr, skipPersonFunc);
    } catch (ex) {
      showError(ex);
      return [];
    }
  }

  let topEl: HTMLDivElement;
  $: inputEl = topEl?.querySelector("input");

  async function addPerson(person: PersonUID) {
    if (!person) {
      return;
    }
    typedText = "";
    isNameEdited = false;
    await onAddPerson(person);

    // Clear, to allow user to enter the next person
    await tick();
    // Hack, because component doesn't allow me to clear the text field value
    if (inputEl) {
      inputEl.value = "";
    }
  }

  async function onCreate(text: string) {
    // email address is substring, e.g. "Fred <fred@example.com>"
    if (!text.includes("@")) {
      throw new UserError($t`Need email address`);
    }

    if (hasNameField) {
      sanitize.emailAddress(text.trim());
      await focusName();
      return;
    }

    // Parse typed text into name and email address
    text = text.trim();
    let name: string;
    let emailAddress = text;
    let hasName = text.includes("<") && text.includes(">");
    if (hasName) {
      let startBracket = text.indexOf("<");
      name = text.substring(0, startBracket - 1).trimEnd();
      let endBracket = text.indexOf(">");
      emailAddress = text.substring(startBracket + 1, endBracket);
    } else {
      name = nameFromEmailAddress(emailAddress);
    }
    sanitize.emailAddress(emailAddress);

    let personUID = new PersonUID(emailAddress, name);
    await addPerson(personUID);
  }

  /** Clicking outside the field should add the person, same as pressing ENTER.
   * Capture phase, so that we run before the click reaches its target, e.g. the
   * [Send] button. */
  async function onClickOutside(event: MouseEvent) {
    if (!typedText || topEl.contains(event.target as Node)) {
      return; // clicks on a search result add the person themselves
    }
    let highlightedResult = topEl.querySelector(".autocomplete-list:not(.hidden) .autocomplete-list-item.selected");
    if (hasNameField && !highlightedResult && canCreate(typedText)) {
      await addNewPerson();
      return;
    }
    if (!highlightedResult && !canCreate(typedText)) {
      return; // nothing to add, e.g. a half-typed name
    }
    // The autocomplete component offers no API to add, so fake the ENTER key
    inputEl.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter" }));
  }

  function canCreate(typedText: string) {
    // email address is substring, e.g. "Fred <fred@example.com>"
    return typedText && sanitize.emailAddress(typedText, "");
  }

  export function focus() {
    inputEl?.focus();
    // The autocomplete component opens its list on focus, even with the results
    // of the previous text, and closes it only on ESC
    inputEl?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  }

  let name = "";
  let isNameEdited = false;
  let knownPerson: Person = null;
  let nameInputEl: HTMLInputElement;
  let addressbook: Addressbook = appGlobal.collectedAddressbook;
  $: isEMailAddressTyped = typedText?.includes("@") && !typedText.includes("<");
  $: hasNameField = askForName && isEMailAddressTyped;
  $: typedText, onTypedTextChanged();
  function onTypedTextChanged() {
    knownPerson = null;
    if (hasNameField && !isNameEdited) {
      name = nameFromEmailAddress(typedText.trim());
    }
  }

  function onNameFocus() {
    knownPerson = findPerson(typedText.trim());
    if (knownPerson?.name && !isNameEdited) {
      name = knownPerson.name;
    }
  }

  async function onKeyDown(event: KeyboardEvent) {
    if (event.target != inputEl || event.key != "Tab" || event.shiftKey || !hasNameField) {
      return;
    }
    event.preventDefault();
    await focusName();
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
    let emailAddress = sanitize.emailAddress(typedText.trim());
    let personUID = new PersonUID(emailAddress, name.trim() || nameFromEmailAddress(emailAddress));
    let newPerson = personUID.findPerson() ? null : personUID.createPerson(addressbook);
    await addPerson(personUID);
    await newPerson?.save();
  }
</script>

<style>
.person-autocomplete {
  height: 24px;
  margin-block-end: -1px;
}

.person-autocomplete :global(.autocomplete) {
  height: 100% !important;
}
.person-autocomplete :global(.input-container) {
  height: 100%;
}
.person-autocomplete :global(input) {
  background-color: var(--main-bg);
  color: var(--main-fg);
  padding: 0px 12px !important;
  box-shadow: -1px 0px 5px 0.5px rgb(0, 0, 0, 3%);
  border-radius: 100px;
  align-items: center;
}
.person-autocomplete :global(input::placeholder) {
  color: #7D7886;
}
.person-autocomplete :global(.autocomplete-list) {
  border-bottom-left-radius: 5px;
  border-bottom-right-radius: 5px;
}
.person-autocomplete :global(.autocomplete-list-item-create) {
  color: rgb(from var(--main-fg) r g b / 50%);
  font-size: 14px;
}
.person-autocomplete :global(.mdc-deprecated-list-item--activated) {
  border: 1px solid red;
  background-color: green;
}
.person-autocomplete :global(.hidden) {
  display: none;
}

.person-autocomplete.new-person {
  flex: none;
  max-width: 100%;
  height: 28px;
  margin-block: -2px -3px;
  background-color: var(--main-bg);
  border-radius: 100px;
  box-shadow:
    0px 0px 0px 1.5px var(--input-focus),
    0px 0px 0px 5px rgb(from var(--input-focus) r g b / 20%);
}
.new-person :global(input) {
  background-color: transparent;
  color: rgb(from var(--main-fg) r g b / 55%);
  box-shadow: none;
  padding: 0px 14px !important;
  field-sizing: content;
}
.new-person :global(input:focus) {
  color: var(--main-fg);
}
.new-person :global(input.autocomplete-input) {
  min-width: 100%;
}
.new-person :global(.autocomplete-list:not(:has(.autocomplete-list-item))) {
  display: none;
}
.name-line {
  align-items: center;
  padding-inline-end: 3px;
}
.name-line input.name {
  height: 100%;
  min-width: 8em;
  border: none;
  font: inherit;
}
.name-line :global(.account-selector) {
  margin-inline-end: 8px;
}
.name-line :global(button.button:not(:hover)) {
  background-color: var(--selected-bg);
  color: var(--selected-fg);
}
@container persons-autocomplete (max-width: 500px) {
  .person-autocomplete.new-person {
    flex: 1 0 0;
    flex-direction: column;
    height: unset;
    margin-block: 0px -1px;
    border-radius: 14px;
  }
  .new-person :global(.autocomplete) {
    height: 28px !important;
    width: 100%;
  }
  .new-person :global(.autocomplete-list) {
    margin-block-start: 28px;
  }
  .name-line {
    height: 28px;
  }
  .name-line input.name {
    flex: 1 0 0;
  }
}
</style>
