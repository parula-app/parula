<Dialog title={isExport ? $t`Export *=> Export data to a file` : $t`Import`}
  width="680px"
  height="500px"
  on:close>
  <hbox flex class="wizard">
    <vbox class="wizard-art">
      <svelte:component this={isExport ? ExportIcon : ImportIcon} size={56} strokeWidth={1} />
    </vbox>
    <vbox flex class="wizard-page">
      {#if step == "action"}
        <label for="import-export-actions">{$t`Choose what to import`}</label>
        <vbox class="choice-list" id="import-export-actions" role="listbox">
          {#each actions as actionEntry (actionEntry.id)}
            <button class="choice" class:selected={action == actionEntry.id}
              role="option" aria-selected={action == actionEntry.id}
              on:click={() => action = actionEntry.id}
              on:dblclick={() => catchErrors(next)}>
              <svelte:component this={actionEntry.icon} size={16} />
              {actionEntry.label}
            </button>
          {/each}
        </vbox>
        <fieldset class="description">
          <legend>{$t`Description`}</legend>
          {actions.find(actionEntry => actionEntry.id == action)?.description}
        </fieldset>
      {:else if step == "source"}
        <label for="import-export-sources">{$t`Select what to export`}</label>
        <vbox class="choice-list sources" id="import-export-sources" role="listbox">
          {#each sourceGroups as group (group.label)}
            {#if group.sources.length}
              <hbox class="group-header" role="presentation">{group.label}</hbox>
              {#each group.sources as sourceEntry (sourceEntry.source)}
                <button class="choice" class:selected={source == sourceEntry.source}
                  role="option" aria-selected={source == sourceEntry.source}
                  style:padding-inline-start="{8 + sourceEntry.depth * 16}px"
                  on:click={() => source = sourceEntry.source}
                  on:dblclick={() => { source = sourceEntry.source; catchErrors(next); }}>
                  <svelte:component this={group.icon} size={16} />
                  <span class="folder-name">{sourceEntry.source.name}</span>
                  {#if sourceEntry.accountName}
                    <span class="lo-secondary">{sourceEntry.accountName}</span>
                  {/if}
                </button>
              {/each}
            {/if}
          {/each}
          {#if !sourceGroups.some(group => group.sources.length)}
            <hbox class="empty">{$t`You don't have a calendar or an address book yet`}</hbox>
          {/if}
        </vbox>
      {:else if step == "file-type"}
        <label for="import-export-types">{$t`Create a file of type`}</label>
        <vbox class="choice-list" id="import-export-types" role="listbox">
          {#each fileTypes as fileTypeEntry (fileTypeEntry.id)}
            <button class="choice" class:selected={fileType == fileTypeEntry.id}
              role="option" aria-selected={fileType == fileTypeEntry.id}
              on:click={() => fileType = fileTypeEntry.id}
              on:dblclick={() => { fileType = fileTypeEntry.id; catchErrors(finish); }}>
              <svelte:component this={fileTypeEntry.icon} size={16} />
              {fileTypeEntry.label}
            </button>
          {/each}
        </vbox>
        <hbox class="lo-secondary">{$t`Export ${source?.name}`}</hbox>
      {:else if step == "file"}
        <label for="import-export-file">{$t`File to import`}</label>
        <hbox class="file-row">
          <input id="import-export-file" class="lo-text-field" type="text" readonly
            value={file?.name ?? ""} placeholder={$t`Click Browse… to choose a file`} />
          <DialogButton label={$t`Browse… *=> Choose a file on the computer`} onClick={onBrowse} />
        </hbox>
        <FileSelector bind:this={fileSelector}
          acceptFileTypes={action == "import-vcard" ? [ "text/vcard", ".vcf" ] : [ "text/calendar", ".ics", ".vcs" ]} />
      {:else if step == "folder"}
        <label for="import-export-folders">{$t`Select the destination folder`}</label>
        <vbox class="choice-list folders" id="import-export-folders" role="listbox">
          {#each folders as folderEntry (folderEntry.id)}
            <button class="choice" class:selected={folder == folderEntry}
              role="option" aria-selected={folder == folderEntry}
              on:click={() => folder = folderEntry}
              on:dblclick={() => { folder = folderEntry; catchErrors(finish); }}>
              <svelte:component this={worksOnCalendars ? CalendarIcon : AddressbookIcon} size={16} />
              <span class="folder-name">{folderEntry.name}</span>
              {#if folderEntry.mainAccount}
                <span class="lo-secondary">{folderEntry.mainAccount.name}</span>
              {/if}
            </button>
          {:else}
            <hbox class="empty">{worksOnCalendars
              ? $t`You don't have a calendar yet`
              : $t`You don't have an address book yet`}</hbox>
          {/each}
        </vbox>
      {/if}
    </vbox>
  </hbox>
  <svelte:fragment slot="footer">
    <hbox flex />
    <DialogButton label={$t`< Back`} disabled={stepIndex == 0} onClick={() => { step = steps[stepIndex - 1]; }} />
    {#if stepIndex == steps.length - 1}
      <DialogButton label={$t`Finish *=> Complete the wizard`} primary disabled={!canGoNext} onClick={finish} />
    {:else}
      <DialogButton label={$t`Next >`} primary disabled={!canGoNext} onClick={next} />
    {/if}
    <DialogButton label={$t`Cancel`} onClick={() => { dispatch("close"); }} />
  </svelte:fragment>
</Dialog>

<script lang="ts">
  import type { ImportExportAction } from "../SettingsDialogs";
  import { openSetup } from "../SettingsDialogs";
  import { Addressbook } from "../../../logic/Contacts/Addressbook";
  import { Calendar } from "../../../logic/Calendar/Calendar";
  import type { Topic } from "../../../logic/Topic/Topic";
  import { convertVCardsToPersons, personsToVCardFile } from "../../../logic/Contacts/VCard/VCard";
  import { convertICalToEvents } from "../../../logic/Calendar/ICal/ICalToEvent";
  import { eventsToICalFile } from "../../../logic/Calendar/ICal/ICalGenerator";
  import { saveBlobAsFile } from "../../../frontend/Util/util";
  import { appGlobal } from "../../../logic/app";
  import { catchErrors } from "../../../frontend/Util/error";
  import { assert } from "../../../logic/util/util";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import FileSelector from "../../../frontend/Mail/Composer/Attachments/FileSelector.svelte";
  import ExportIcon from "lucide-svelte/icons/file-output";
  import ImportIcon from "lucide-svelte/icons/file-input";
  import CalendarIcon from "lucide-svelte/icons/calendar";
  import AddressbookIcon from "lucide-svelte/icons/book-user";
  import TopicIcon from "lucide-svelte/icons/share-2";
  import HTMLIcon from "lucide-svelte/icons/file-code";
  import MarkdownIcon from "lucide-svelte/icons/file-text";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let preselected: Calendar | Addressbook | null = null;
  export let action: ImportExportAction = "import";

  const dispatch = createEventDispatcher<{ close: void }>();
  const calendars = appGlobal.calendars;
  const addressbooks = appGlobal.addressbooks;
  const topicAccounts = appGlobal.topicAccounts;

  const isExport = action == "export";
  let source: Calendar | Addressbook | Topic | null = preselected;
  let fileType: string | null = null;
  let file: File | null = null;
  let folder: Calendar | Addressbook | null = preselected;
  let fileSelector: FileSelector;

  let step = isExport
    ? (preselected ? "file-type" : "source")
    : (action == "import" ? "action" : "file");
  if (action == "import") {
    action = "import-vcard";
  }
  const steps = isExport ? ["source", "file-type"] : ["action", "file", "folder"];
  $: stepIndex = steps.indexOf(step);
  $: worksOnCalendars = action == "import-ical";
  $: folders = (worksOnCalendars ? $calendars.contents : $addressbooks.contents) as (Calendar | Addressbook)[];
  $: canGoNext =
    step == "source" ? !!source :
    step == "file-type" ? fileTypes.some(fileTypeEntry => fileTypeEntry.id == fileType) :
    step == "file" ? !!file :
    step == "folder" ? folders.includes(folder) :
    true;

  $: actions = [
    { id: "import-vcard", icon: ImportIcon, label: $t`Import a VCARD file (.vcf)`,
      description: $t`Import the contacts of a vCard file into one of your address books` },
    { id: "import-ical", icon: ImportIcon, label: $t`Import an iCalendar (.ics) or vCalendar file (.vcs)`,
      description: $t`Import the appointments and meetings of an iCalendar or vCalendar file into one of your calendars` },
    { id: "import-program", icon: ImportIcon, label: $t`Import from another program or file`,
      description: $t`Import e-mail accounts and address books from another program on this computer` },
  ] as { id: ImportExportAction, icon: ConstructorOfATypedSvelteComponent, label: string, description: string }[];

  $: sourceGroups = [
    { label: $t`Calendars *=> Heading of the list of calendars`, icon: CalendarIcon,
      sources: $calendars.contents.map(calendar => ({ source: calendar, depth: 0, accountName: calendar.mainAccount?.name })) },
    { label: $t`Address books`, icon: AddressbookIcon,
      sources: $addressbooks.contents.map(addressbook => ({ source: addressbook, depth: 0, accountName: addressbook.mainAccount?.name })) },
    { label: $t`Topics *=> Heading of the list of topics, which are pages with notes and links`, icon: TopicIcon,
      sources: $topicAccounts.contents.flatMap(topicAccount => topicTree(topicAccount.topics.contents.filter(topic => !topic.parent), 0)) },
  ] as { label: string, icon: ConstructorOfATypedSvelteComponent, sources: { source: Calendar | Addressbook | Topic, depth: number, accountName?: string }[] }[];

  $: fileTypes = (source instanceof Calendar
    ? [ { id: "text/calendar", icon: CalendarIcon, label: "iCalendar (.ics)" } ]
    : source instanceof Addressbook
    ? [ { id: "text/vcard", icon: AddressbookIcon, label: "vCard (.vcf)" } ]
    : source
    ? [
      { id: "text/html", icon: HTMLIcon, label: $t`Web page (.html)` },
      { id: "text/markdown", icon: MarkdownIcon, label: $t`Markdown text (.md)` },
    ]
    : []) as { id: string, icon: ConstructorOfATypedSvelteComponent, label: string }[];
  $: if (!fileTypes.some(fileTypeEntry => fileTypeEntry.id == fileType)) {
    fileType = fileTypes[0]?.id ?? null;
  }

  function topicTree(topics: Topic[], depth: number): { source: Topic, depth: number, accountName?: string }[] {
    return topics.flatMap(topic => [
      { source: topic, depth, accountName: depth == 0 ? topic.account?.name : undefined },
      ...topicTree(topic.children.contents, depth + 1),
    ]);
  }

  function next() {
    if (step == "action" && action == "import-program") {
      openSetup("/setup/initial");
      return;
    }
    step = steps[stepIndex + 1];
  }

  async function onBrowse() {
    file = await fileSelector.selectFile() ?? file;
  }

  async function finish() {
    if (isExport) {
      assert(source && fileType, $t`Please choose what to export first`);
      await exportToFile(source, fileType);
    } else {
      assert(folders.includes(folder), $t`Please choose a folder first`);
      if (action == "import-vcard") {
        await importVCard(folder as Addressbook, file);
      } else {
        await importICal(folder as Calendar, file);
      }
    }
    dispatch("close");
  }

  async function exportToFile(source: Calendar | Addressbook | Topic, mimeType: string) {
    if (source instanceof Calendar) {
      // <copied from="../../../frontend/Settings/Calendar/ImportExport.svelte">
      let file = await eventsToICalFile(source.events, source.name);
      await saveBlobAsFile(file);
      // </copied>
    } else if (source instanceof Addressbook) {
      // <copied from="../../../frontend/Settings/Contacts/ImportExport.svelte">
      let file = personsToVCardFile(source.persons, source.name);
      await saveBlobAsFile(file);
      // </copied>
    } else {
      // <copied from="../../../frontend/Topic/Page/TopicPage.svelte">
      await saveBlobAsFile(source.toFile(mimeType));
      // </copied>
    }
  }

  // <copied from="../../../frontend/Settings/Contacts/ImportExport.svelte">
  async function importVCard(account: Addressbook, file: File) {
    let fileContents = await file.text();
    let persons = convertVCardsToPersons(fileContents, () => account.newPerson(), ex => account.errorCallback(ex));
    account.persons.addAll(persons);
    for (let person of persons) {
      try {
        await person.save();
      } catch (ex) {
        account.errorCallback(ex);
      }
    }
    await account.save();
  }
  // </copied>

  // <copied from="../../../frontend/Settings/Calendar/ImportExport.svelte">
  async function importICal(account: Calendar, file: File) {
    let fileContents = await file.text();
    let events = convertICalToEvents(fileContents, () => account.newEvent(), ex => account.errorCallback(ex));
    account.events.addAll(events);
    for (let event of events) {
      try {
        await event.save();
      } catch (ex) {
        account.errorCallback(ex);
      }
    }
    await account.save();
  }
  // </copied>
</script>

<style>
  .wizard {
    gap: 20px;
    height: 100%;
    min-height: 0;
  }
  .wizard-art {
    flex-shrink: 0;
    align-items: center;
    justify-content: start;
    width: 120px;
    padding-block-start: 24px;
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-accent-tint);
    color: var(--lo-accent-text);
  }
  .wizard-page {
    min-width: 0;
    min-height: 0;
    gap: 8px;
  }
  .choice-list {
    flex: 0 1 auto;
    min-height: 120px;
    max-height: 200px;
    padding: 2px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
    overflow-y: auto;
  }
  .choice-list.folders,
  .choice-list.sources {
    flex: 1 1 auto;
    max-height: none;
  }
  .group-header {
    flex-shrink: 0;
    padding: 8px 8px 2px 8px;
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
    font-weight: 600;
  }
  .choice {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-shrink: 0;
    gap: 8px;
    height: 30px;
    padding: 0 8px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
    cursor: default;
  }
  .choice :global(svg) {
    flex-shrink: 0;
    color: var(--lo-accent-text);
  }
  .choice:hover {
    background-color: var(--lo-hover-bg);
  }
  .choice.selected {
    background-color: var(--lo-selected-bg);
  }
  .folder-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .description {
    margin: 8px 0 0 0;
    padding: 4px 12px 12px 12px;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
    color: var(--lo-fg-secondary);
  }
  .description legend {
    padding: 0 4px;
    color: var(--lo-fg);
  }
  .file-row {
    align-items: center;
    gap: 8px;
  }
  .file-row input {
    flex: 1;
    min-width: 0;
  }
  .empty {
    padding: 12px 8px;
    color: var(--lo-fg-secondary);
  }
</style>
