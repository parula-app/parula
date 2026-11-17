<vbox flex class="contacts-page" bind:this={pageEl}>
  <ContactsRibbon selectedAddressbook={$selectedAddressbook} selectedPersons={selectedContacts}>
    {#if isSearch}
      <ContactSearchTab hasSelectedAddressbook={!!$selectedAddressbook} />
    {/if}
  </ContactsRibbon>

  <hbox flex class="panes">
    <Splitter name="lookout.contacts.addressbooks" initialRightRatio={5} leftMinWidth={200} rightMinWidth={480}
      hasLeft={$folderPane.value != false}>
      <AddressbookSelector slot="left" bind:selectedAddressbook={$selectedAddressbook} />
      <hbox flex class="main" slot="right">
        <Splitter name="lookout.contacts.card" initialRightRatio={1.6} leftMinWidth={260} rightMinWidth={320}
          hasRight={showCardPane}>
          <vbox flex class="list-pane lo-card" class:single={!showCardPane} slot="left">
            <hbox class="search-bar">
              <ContactSearchBox placeholder={searchPlaceholder} />
            </hbox>
            {#if view == ContactView.People}
              <PersonsList persons={sortedContacts} bind:selected={currentContact} bind:selectedPersons={selectedContacts} {emptyText} />
            {:else if view == ContactView.BusinessCard}
              <BusinessCardView persons={sortedContacts} bind:selected={currentContact} selectedPersons={selectedContacts} {emptyText} />
            {:else if view == ContactView.Card}
              <CardView persons={sortedContacts} bind:selected={currentContact} selectedPersons={selectedContacts} {emptyText} />
            {:else}
              <PersonsTable persons={sortedContacts} {view}
                bind:selected={currentContact} bind:selectedPersons={selectedContacts} {emptyText} />
            {/if}
          </vbox>
          <vbox flex class="card-pane lo-card" slot="right">
            {#if $selectedContacts.length > 1}
              <vbox flex class="card-placeholder">
                <MultipleIcon size={48} strokeWidth={1.2} />
                {$t`${$selectedContacts.length} contacts selected`}
              </vbox>
            {:else if currentContact instanceof Person}
              <PersonDetails person={currentContact} />
            {:else if currentContact instanceof Group}
              <GroupCard group={currentContact} />
            {:else}
              <vbox flex class="card-placeholder">
                <NoSelectionIcon size={48} strokeWidth={1.2} />
                {$t`Select a contact to see the details`}
              </vbox>
            {/if}
          </vbox>
        </Splitter>
      </hbox>
    </Splitter>
  </hbox>
</vbox>

<svelte:window on:keydown={onKeyDown} />

<script lang="ts">
  import type { Contact } from "../../logic/Abstract/Contact";
  import { Person } from "../../logic/Abstract/Person";
  import { Group } from "../../logic/Abstract/Group";
  import { selectedAddressbook, selectedContact } from "./Person/Selected";
  import { ContactActions } from "./ContactActions";
  import { defaultContactSearchOptions, hasContactRefiners, findContacts, matchesContactRefiners } from "./ContactSearch";
  import { contactSearchOptions, contactSearchInput, ContactSearchScope } from "./Person/Selected";
  import { ContactColumn, contactComparator, ContactView, type ContactSort } from "./Person/ContactColumns";
  import { LetterIndex } from "./LetterIndex";
  import { appGlobal } from "../../logic/app";
  import { selectedPerson } from "../../frontend/Contacts/Person/Selected";
  import { globalSearchTerm } from "../../frontend/AppsBar/selectedApp";
  import { catchErrors } from "../../frontend/Util/error";
  import { getLocalStorage } from "../../frontend/Util/LocalStorage";
  import { statusBarContent, type StatusBarContent } from "../MainWindow/Selected";
  import Splitter from "../../frontend/Shared/Splitter.svelte";
  import ContactsRibbon from "./ContactsRibbon.svelte";
  import ContactSearchTab from "./Search/ContactSearchTab.svelte";
  import ContactSearchBox from "./Search/ContactSearchBox.svelte";
  import AddressbookSelector from "./AddressbookSelector.svelte";
  import PersonsList from "./Person/PersonsList.svelte";
  import PersonsTable from "./Person/PersonsTable.svelte";
  import BusinessCardView from "./Person/BusinessCardView.svelte";
  import CardView from "./Person/CardView.svelte";
  import PersonDetails from "./PersonPage/PersonDetails.svelte";
  import GroupCard from "./PersonPage/GroupCard.svelte";
  import MultipleIcon from "lucide-svelte/icons/users-round";
  import NoSelectionIcon from "lucide-svelte/icons/contact-round";
  import { ArrayColl, mergeColls, type Collection } from "svelte-collections";
  import { onDestroy } from "svelte";
  import { get } from "svelte/store";
  import { t } from "../../l10n/l10n";

  let addressbooks = appGlobal.addressbooks;
  let searchOnlyAddressbooks = appGlobal.searchOnlyAddressbooks;
  const allContacts = mergeColls(appGlobal.addressbooks.map(addressbook => addressbook.contacts)) as Collection<Contact>;

  const viewSetting = getLocalStorage<ContactView>("lookout.contacts.view", ContactView.People);
  const sort = getLocalStorage<ContactSort>("lookout.contacts.sort", { column: ContactColumn.FullName, ascending: true });
  const folderPane = getLocalStorage<boolean>("lookout.contacts.folderPane", true);
  const readingPane = getLocalStorage<boolean>("lookout.contacts.readingPane", true);

  $: view = Object.values(ContactView).includes($viewSetting.value) ? $viewSetting.value : ContactView.People;
  $: showCardPane = $readingPane.value != false && view == ContactView.People;

  let lastGlobalSearchTerm = $globalSearchTerm;
  $: takeGlobalSearchTerm($globalSearchTerm);
  function takeGlobalSearchTerm(term: string | null) {
    if (term == lastGlobalSearchTerm) {
      return;
    }
    lastGlobalSearchTerm = term;
    $contactSearchOptions = { ...$contactSearchOptions, term: term?.toLowerCase() || null };
  }

  $: isDirectory = !!$selectedAddressbook && $searchOnlyAddressbooks.some(addressbook => addressbook == $selectedAddressbook);
  $: isSearch = !!$contactSearchOptions.term?.trim() || hasContactRefiners($contactSearchOptions);
  $: isCurrentFolder = $contactSearchOptions.scope == ContactSearchScope.CurrentFolder && !!$selectedAddressbook;
  $: searchedAddressbooks = isCurrentFolder
    ? [ $selectedAddressbook ]
    : [ ...$addressbooks.contents, ...$searchOnlyAddressbooks.contents ];
  $: folderContacts = isDirectory
    ? new ArrayColl<Contact>()
    : $selectedAddressbook?.contacts ?? allContacts;
  $: searchTerm = $contactSearchOptions.term?.trim();
  let listedContacts: Collection<Contact>;
  $: showListed(!isSearch
    ? folderContacts
    : searchTerm
      ? findContacts(searchedAddressbooks, searchTerm)
      : isCurrentFolder ? folderContacts : allContacts);
  function showListed(contacts: Collection<Contact>) {
    if (contacts != listedContacts) {
      listedContacts = contacts;
    }
  }
  $: refinedSearch = hasContactRefiners($contactSearchOptions) ? $contactSearchOptions : null;
  $: refinedContacts = refinedSearch
    ? listedContacts.filterObservable(contact => matchesContactRefiners(contact, refinedSearch))
    : listedContacts;
  $: compareContacts = view == ContactView.List || view == ContactView.Phone
    ? contactComparator($sort.value)
    : LetterIndex.compareByName;
  $: sortedContacts = refinedContacts.sort(compareContacts);
  $: shownAddressbook = $selectedAddressbook;
  $: searchPlaceholder = $shownAddressbook
    ? $t`Search ${$shownAddressbook.name}`
    : $t`Search All Contacts`;
  $: emptyText = isSearch
    ? $t`We didn't find anything to show here`
    : isDirectory
      ? $t`Type a name in the search box to find people in the directory`
      : $t`There are no items to show in this view`;

  let selectedContacts = new ArrayColl<Contact>();
  let currentContact: Contact | null = $selectedPerson && $selectedPerson != $selectedContact
    ? $selectedPerson
    : $selectedContact;
  if (currentContact) {
    selectedContacts.add(currentContact);
  }
  $: showContactFromOutside($selectedContact);
  function showContactFromOutside(contact: Contact | null) {
    if (!contact || contact == currentContact) {
      return;
    }
    if ($selectedAddressbook && contact.addressbook != $selectedAddressbook) {
      $selectedAddressbook = contact.addressbook;
    }
    currentContact = contact;
    selectedContacts.replaceAll([contact]);
  }
  $: showPersonFromOutside($selectedPerson);
  function showPersonFromOutside(person: Person | null) {
    showContactFromOutside(person);
  }
  $: clearSelectionWhenEmpty($sortedContacts.isEmpty);
  function clearSelectionWhenEmpty(isEmpty: boolean) {
    if (!isEmpty) {
      return;
    }
    selectedContacts.clear();
    currentContact = null;
  }
  $: rememberSelection(currentContact);
  function rememberSelection(contact: Contact | null) {
    $selectedContact = contact;
    let person = contact instanceof Person ? contact : null;
    if ($selectedPerson != person) {
      $selectedPerson = person;
    }
  }

  async function deleteSelected() {
    await ContactActions.deleteContacts(selectedContacts.contents);
  }

  // <copied to="ContactsRibbon.svelte">
  function focusSearch() {
    $contactSearchInput?.focus();
    $contactSearchInput?.select();
  }
  // </copied>

  // <copied to="Search/ContactSearchBox.svelte, Search/ContactSearchTab.svelte, ContactsRibbon.svelte">
  function closeSearch() {
    $contactSearchOptions = defaultContactSearchOptions($contactSearchOptions.scope);
  }
  // </copied>

  let status: StatusBarContent;
  $: status = {
    left: [
      { label: $t`Items: ${$sortedContacts.length}` },
      ...($selectedContacts.length > 1 ? [{ label: $t`Selected: ${$selectedContacts.length}` }] : []),
    ],
    right: [],
    views: [],
  };
  // <copied from="../Mail/MailApp.svelte">
  $: $statusBarContent = status;
  onDestroy(() => {
    if (get(statusBarContent) == status) {
      statusBarContent.set(null);
    }
  });
  // </copied>

  let pageEl: HTMLElement;
  function onKeyDown(event: KeyboardEvent) {
    let target = event.target as HTMLElement;
    if (event.defaultPrevented || !pageEl?.contains(target) && target != document.body) {
      return;
    }
    let isTextField = target?.closest?.("input, textarea, select, [contenteditable]");
    if (event.key == "Delete" && !isTextField && !event.ctrlKey && !event.altKey && selectedContacts.hasItems) {
      event.preventDefault();
      catchErrors(deleteSelected);
    } else if (event.key == "Escape" && !isTextField && isSearch) {
      event.preventDefault();
      closeSearch();
    } else if (event.ctrlKey && !event.altKey && event.key.toLowerCase() == "n" && !event.shiftKey ||
        event.ctrlKey && !event.altKey && event.key.toLowerCase() == "c" && event.shiftKey) {
      event.preventDefault();
      catchErrors(() => ContactActions.newContact($selectedAddressbook));
    } else if (event.ctrlKey && !event.altKey && event.shiftKey && event.key.toLowerCase() == "l") {
      event.preventDefault();
      catchErrors(() => ContactActions.newGroup($selectedAddressbook));
    } else if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() == "e" ||
        event.key == "F3" && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      focusSearch();
    }
  }
</script>

<style>
  .contacts-page {
    min-height: 0;
  }
  .panes {
    min-height: 0;
  }
  .main {
    min-width: 0;
  }
  .list-pane {
    min-width: 0;
    margin: 0 4px 8px 0;
    overflow: hidden;
  }
  .list-pane.single {
    margin-inline-end: 8px;
  }
  .card-pane {
    min-width: 0;
    margin: 0 8px 8px 4px;
    overflow: hidden;
  }
  .search-bar {
    flex-shrink: 0;
    padding: 12px 12px 8px 12px;
    border-block-end: 1px solid var(--lo-divider);
  }
  .card-placeholder {
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--lo-fg-secondary);
  }
  .card-placeholder :global(svg) {
    color: var(--lo-fg-disabled);
  }
</style>
