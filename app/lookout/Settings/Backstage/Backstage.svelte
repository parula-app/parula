<hbox flex class="backstage">
  <vbox class="backstage-nav">
    <button class="nav-item back" title={$t`Back *=> Close the File view and go back to the app`} aria-label={$t`Back *=> Close the File view and go back to the app`} on:click={onBack}>
      <BackIcon size="20" />
    </button>
    <button class="nav-item" class:selected={$backstagePage == "info"}
      on:click={() => $backstagePage = "info"}>
      <InfoIcon size="18" />
      <hbox class="label">{$t`Info`}</hbox>
    </button>
    <button class="nav-item" class:selected={$backstagePage == "open-export"}
      on:click={() => $backstagePage = "open-export"}>
      <OpenExportIcon size="18" />
      <hbox class="label">{$t`Open & Export`}</hbox>
    </button>
    {#if area}
      <hbox class="separator" />
    {/if}
    {#if area == "mail"}
      <button class="nav-item" disabled={!$selectedMessage} on:click={() => run(() => MessageActions.saveAs($selectedMessage))}>
        <SaveAsIcon size="18" />
        <hbox class="label">{$t`Save As *=> Save the selected item to a file`}</hbox>
      </button>
      <button class="nav-item" disabled={!attachments.length} on:click={() => isSavingAttachments = true}>
        <SaveAttachmentsIcon size="18" />
        <hbox class="label">{$t`Save Attachments`}</hbox>
      </button>
      <button class="nav-item" class:selected={$backstagePage == "print"}
        on:click={() => $backstagePage = "print"}>
        <PrintIcon size="18" />
        <hbox class="label">{$t`Print`}</hbox>
      </button>
    {:else if area == "calendar"}
      <button class="nav-item" disabled={!$selectedCalendar} on:click={() => run(() => saveCalendar($selectedCalendar))}>
        <SaveAsIcon size="18" />
        <hbox class="label">{$t`Save Calendar`}</hbox>
      </button>
    {:else if area == "people"}
      <button class="nav-item" disabled={!($selectedContact instanceof Person)} on:click={() => run(() => saveContact($selectedContact as Person))}>
        <SaveAsIcon size="18" />
        <hbox class="label">{$t`Save As *=> Save the selected item to a file`}</hbox>
      </button>
    {/if}
    <vbox flex class="spacer" />
    <button class="nav-item" class:selected={$backstagePage == "account"}
      on:click={() => $backstagePage = "account"}>
      <AccountIcon size="18" />
      <hbox class="label">{appName}</hbox>
    </button>
    <button class="nav-item" on:click={() => openOptions()}>
      <OptionsIcon size="18" />
      <hbox class="label">{$t`Options *=> Open the settings of the app`}</hbox>
    </button>
    <button class="nav-item" on:click={onExit}>
      <ExitIcon size="18" />
      <hbox class="label">{$t`Exit *=> Close the app`}</hbox>
    </button>
  </vbox>
  <vbox flex class="backstage-page">
    {#if $backstagePage == "info"}
      <InfoPage />
    {:else if $backstagePage == "open-export"}
      <OpenExportPage />
    {:else if $backstagePage == "print" && area == "mail"}
      <PrintPage />
    {:else if $backstagePage == "account"}
      <ProductAccountPage />
    {/if}
  </vbox>
</hbox>
{#if isSavingAttachments}
  <SaveAllAttachmentsDialog {attachments} on:close={() => isSavingAttachments = false} />
{/if}
<svelte:window on:keydown={onKeyDown} />

<script lang="ts">
  import { backstagePage, isBackstageOpen } from "./selected";
  import { openOptions } from "../SettingsDialogs";
  import InfoPage from "./InfoPage.svelte";
  import OpenExportPage from "./OpenExportPage.svelte";
  import ProductAccountPage from "./ProductAccountPage.svelte";
  import PrintPage from "./PrintPage.svelte";
  import type { MustangApp } from "../../../frontend/AppsBar/MustangApp";
  import type { Calendar } from "../../../logic/Calendar/Calendar";
  import { mailMustangApp } from "../../../frontend/Mail/MailMustangApp";
  import { calendarMustangApp } from "../../../frontend/Calendar/CalendarMustangApp";
  import { contactsMustangApp } from "../../../frontend/Contacts/ContactsMustangApp";
  import { eventsToICalFile } from "../../../logic/Calendar/ICal/ICalGenerator";
  import { personsToVCardFile } from "../../../logic/Contacts/VCard/VCard";
  import { saveBlobAsFile } from "../../../frontend/Util/util";
  import { ArrayColl } from "svelte-collections";
  import SaveAllAttachmentsDialog from "../../Mail/Message/SaveAllAttachmentsDialog.svelte";
  import { MessageActions } from "../../Mail/MessageActions";
  import { selectedContact } from "../../Contacts/Person/Selected";
  import { Person } from "../../../logic/Abstract/Person";
  import { selectedMessage } from "../../../frontend/Mail/Selected";
  import { selectedCalendar } from "../../../frontend/Calendar/selected";
  import { selectedApp } from "../../../frontend/AppsBar/selectedApp";
  import { showError } from "../../../frontend/Util/error";
  import SaveAsIcon from "lucide-svelte/icons/save";
  import SaveAttachmentsIcon from "lucide-svelte/icons/paperclip";
  import PrintIcon from "lucide-svelte/icons/printer";
  import AccountIcon from "lucide-svelte/icons/circle-user-round";
  import { appName } from "../../../logic/build";
  import BackIcon from "lucide-svelte/icons/arrow-left";
  import InfoIcon from "lucide-svelte/icons/info";
  import OpenExportIcon from "lucide-svelte/icons/folder-open";
  import OptionsIcon from "lucide-svelte/icons/sliders-horizontal";
  import ExitIcon from "lucide-svelte/icons/log-out";
  import { t } from "../../../l10n/l10n";

  let isSavingAttachments = false;

  $: area = areaOf($selectedApp);
  $: attachments = area == "mail" ? $selectedMessage?.attachments.contents.filter(attachment => !attachment.hidden) ?? [] : [];

  function areaOf(app: MustangApp | null): "mail" | "calendar" | "people" | null {
    if (app == mailMustangApp || mailMustangApp.subApps.includes(app)) {
      return "mail";
    }
    if (app == calendarMustangApp || calendarMustangApp.subApps.includes(app)) {
      return "calendar";
    }
    if (app == contactsMustangApp || contactsMustangApp.subApps.includes(app)) {
      return "people";
    }
    return null;
  }

  async function saveCalendar(calendar: Calendar) {
    // <copied from="../../../frontend/Settings/Calendar/ImportExport.svelte">
    let file = await eventsToICalFile(calendar.events, calendar.name);
    await saveBlobAsFile(file);
    // </copied>
  }

  async function saveContact(person: Person) {
    let file = personsToVCardFile(new ArrayColl([person]), person.name || $t`Contact *=> Default file name for a contact that has no name`);
    await saveBlobAsFile(file);
  }

  function run(action: () => Promise<void>) {
    action().catch(showError);
  }

  function onBack() {
    $isBackstageOpen = false;
  }

  function onExit() {
    window.close();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key == "Escape" && !event.defaultPrevented) {
      $isBackstageOpen = false;
    }
  }
</script>

<style>
  .backstage {
    background-color: var(--lo-pane-bg);
    color: var(--lo-fg);
    min-height: 0;
  }
  .backstage-nav {
    flex: 0 0 auto;
    width: 200px;
    padding: 8px 0;
    background-color: var(--lo-backstage-nav-bg);
    color: var(--lo-backstage-nav-fg);
  }
  .nav-item {
    position: relative;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 12px;
    height: 40px;
    padding: 0 20px;
    border: none;
    background-color: transparent;
    color: inherit;
    font-family: inherit;
    font-size: 15px;
    text-align: start;
  }
  .nav-item.back {
    width: 34px;
    height: 34px;
    margin: 4px 0 16px 16px;
    padding: 0;
    justify-content: center;
    border: 1px solid var(--lo-border-strong);
    border-radius: 50%;
  }
  .nav-item:disabled {
    opacity: 0.5;
  }
  .nav-item .label {
    white-space: nowrap;
  }
  .separator {
    margin: 8px 20px;
    border-block-start: 1px solid var(--lo-divider);
  }
  .nav-item:hover:not(:disabled) {
    background-color: var(--lo-backstage-nav-hover-bg);
  }
  .nav-item.selected {
    background-color: var(--lo-backstage-nav-selected-bg);
    font-weight: 600;
  }
  .nav-item.selected::before {
    content: "";
    position: absolute;
    inset-inline-start: 0;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 2px;
    background-color: var(--lo-accent);
  }
  .backstage-page {
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }
</style>
