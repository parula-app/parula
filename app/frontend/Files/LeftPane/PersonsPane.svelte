<vbox flex class="persons-file-pane">
  {#await filterPersons()}
    <hbox class="progress">{$t`Searching...`}</hbox>
  {:then}
  <PersonsList {persons} bind:selected={$selectedPerson}>
    <hbox class="email" slot="second-row" let:person>
      {person instanceof Person ? person.emailAddresses.sortBy(entry => entry.preference).first?.value ?? "" : ""}
    </hbox>
  </PersonsList>
  {:catch ex}
    <ErrorMessageInline {ex} />
  {/await}
</vbox>

<script lang="ts">
  import { File } from "../../../logic/Files/File";
  import { Directory } from "../../../logic/Files/Directory";
  import { Person } from "../../../logic/Abstract/Person";
  import { PersonUID } from "../../../logic/Abstract/PersonUID";
  import type { Event } from "../../../logic/Calendar/Event";
  import { newSearchEMail } from "../../../logic/Mail/Store/setStorage";
  import { appGlobal } from "../../../logic/app";
  import { selectedPerson } from "../../Contacts/Person/Selected";
  import PersonsList from "../../Contacts/Person/PersonsList.svelte";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import { catchErrors } from "../../Util/error";
  import { ArrayColl, Collection, MapColl, SetColl } from 'svelte-collections';
  import { t } from "../../../l10n/l10n";

  /** The list of files and folders to show on the right pane
   * in/out only */
  export let listFiles: Collection<File>;
  export let listDirs: Collection<Directory>;

  let persons = new SetColl<Person>();

  // onMount(() => catchErrors(filterPersons));

  /** Show only those persons that have files*/
  async function filterPersons(): Promise<Collection<Person>> {
    persons.clear();
    if (!appGlobal.remoteApp) {
      return persons;
    }
    let uids = new MapColl<string, PersonUID>();
    let search = newSearchEMail();
    search.hasAttachment = true;
    let emails = await search.startSearch();
    for (let email of emails) {
      let hasAttachment = email.attachments.hasItems && email.attachments.some(a => !a.hidden);
      if (!hasAttachment) {
        continue;
      }
      if (email.contact instanceof Person) {
        persons.add(email.contact);
      } else if (email.contact instanceof PersonUID) {
        uids.set(email.contact.emailAddress, email.contact);
      }
    }
    for (let event of eventsWithAttachments()) {
      let person = event.organizer?.findPerson();
      if (person) {
        persons.add(person);
      }
    }
    for (let uid of uids.contents) {
      let person = uid.findPerson();
      if (!person) {
        continue;
      }
      persons.add(person);
    }
    return persons;
  }

  /** Meeting attachments are sorted by the organizer of the meeting */
  function eventsWithAttachments(): Collection<Event> {
    return appGlobal.calendars.flatMap(calendar => calendar.events)
      .filterOnce(event => event.attachments.hasItems);
  }

  // $: personFolders = appGlobal.files.filter(file => file.sentToFrom == $selectedPerson);
  // $: displayFiles = personFolders?.first?.files;

  let lastPerson: Person;
  $: $selectedPerson && catchErrors(showPerson)
  async function showPerson() {
    let person = $selectedPerson;
    if (lastPerson == person) {
      return;
    }
    lastPerson = person;
    if (!person) {
      return;
    }
    listFiles = new ArrayColl<File>();
    listDirs = new ArrayColl<Directory>();

    let search = newSearchEMail();
    search.includesPerson = person;
    search.hasAttachment = true;
    let emails = await search.startSearch();
    for (let email of emails) {
      for (let attachment of email.attachments) {
        if (attachment.hidden) {
          continue;
        }
        listFiles.add(attachment.asFileEntry());
      }
    }
    for (let event of eventsWithAttachments()) {
      if (event.organizer?.findPerson() != person) {
        continue;
      }
      for (let attachment of event.attachments) {
        listFiles.add(attachment.asFileEntry());
      }
    }
    console.log("found", listFiles.length, "files and", listDirs.length, "dirs from/to", person.name);
  }
</script>

<style>
  .persons-file-pane {
    margin-block-start: 8px;
  }
  .email {
    display: none;
  }
  :global(.lookout-window) .persons-file-pane {
    min-height: 0;
    overflow: hidden;
    background-color: var(--lo-pane-bg);
    border-radius: var(--lo-radius);
    box-shadow: var(--lo-shadow-card);
  }
  :global(.lookout-window) .email {
    display: block;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .progress {
    align-self: center;
    justify-self: center;
  }
</style>
