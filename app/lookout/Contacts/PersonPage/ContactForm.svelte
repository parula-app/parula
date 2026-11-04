<vbox flex class="contact-form-page" bind:this={pageEl}>
  <Ribbon>
    <RibbonTab label={$t`Contact *=> Ribbon tab with commands for this contact`}>
      <RibbonGroup label={$t`Actions`}>
        <RibbonButton label={$t`Save & Close`} icon={SaveCloseIcon}
          onClick={saveAndClose} shortCutInfo={$t`Alt+S *=> Keyboard shortcut`} />
        <RibbonButton label={$t`Delete`} icon={DeleteIcon}
          onClick={deleteIt} />
        <RibbonSplitButton label={$t`Save & New`} icon={SaveNewIcon} size="small"
          onClick={saveAndNew}>
          <MenuItem label={$t`Save & New`} icon={SaveNewIcon} onClick={saveAndNew} />
          <MenuItem label={$t`Contact from the Same Company`} icon={SameCompanyIcon}
            onClick={saveAndNewFromSameCompany} />
        </RibbonSplitButton>
      </RibbonGroup>
      <RibbonGroup label={$t`Show *=> Ribbon group to choose which page of the form is shown`}>
        <RibbonToggleButton label={$t`General`} icon={GeneralIcon}
          selected={page == "general"} onClick={() => { page = "general"; }} />
        <RibbonToggleButton label={$t`Details`} icon={DetailsIcon}
          selected={page == "details"} onClick={() => { page = "details"; }} />
        <RibbonToggleButton label={$t`Certificates *=> Page with the certificates (Digital IDs) of the contact`} icon={CertificatesIcon}
          selected={page == "certificates"} onClick={() => { page = "certificates"; }} />
        <RibbonToggleButton label={$t`All Fields`} icon={AllFieldsIcon}
          selected={page == "all-fields"} onClick={() => { page = "all-fields"; }} />
      </RibbonGroup>
      <RibbonGroup label={$t`Communicate *=> Ribbon group with commands to contact the person`}>
        <RibbonButton label={$t`Email *=> Write an email to the contact`} icon={MailIcon} size="small"
          onClick={() => ContactActions.writeMail([person])}
          disabled={!hasEmailAddress && $t`Enter an email address first`} />
        <NewEventRibbonButton label={$t`Meeting`} icon={MeetingIcon} size="small"
          onCreate={calendar => ContactActions.newMeeting([person], calendar)}
          disabled={!hasEmailAddress && $t`Enter an email address first`} />
        <RibbonMenuButton label={$t`More *=> More ways to contact the person`} icon={MoreIcon} size="small">
          <SubMenu label={$t`Call`} icon={CallIcon} disabled={!$phoneNumbers.hasItems && $t`Enter a phone number first`}>
            {#each $phoneNumbers.each as entry}
              <MenuItem label={`${entry.value} (${entry.purposeLabel || $t`Phone`})`} icon={CallIcon}
                onClick={() => ContactActions.call(entry.value)} />
            {/each}
          </SubMenu>
        </RibbonMenuButton>
      </RibbonGroup>
      <RibbonGroup label={$t`Options *=> Ribbon group with more options for the contact`}>
        <RibbonMenuButton label={$t`Picture *=> Change or remove the picture of the contact`} icon={PictureIcon}>
          <MenuItem label={$person.picture ? $t`Change Picture…` : $t`Add Picture…`} icon={ChangePictureIcon}
            onClick={onSelectPicture} />
          <MenuItem label={$t`Remove Picture`} icon={RemovePictureIcon}
            disabled={!$person.picture}
            onClick={() => { person.picture = null; }} />
        </RibbonMenuButton>
      </RibbonGroup>
    </RibbonTab>
  </Ribbon>

  <FormCard title={$person.name || $t`Untitled *=> Placeholder for a contact or group without a name`} kind={$t`Contact *=> Type of item: a person in the address book`}>
    <hbox flex class="form-body">
      {#if page == "certificates"}
        <vbox class="column main">
          <Encryption {person} />
        </vbox>
      {:else if page == "all-fields"}
        <vbox class="column main">
          <AllFieldsPage {person} />
        </vbox>
      {:else if page == "details"}
        <vbox class="column main">
          <div class="fields">
            <label for="contact-department">{$t`Department`}</label>
            <input id="contact-department" type="text" class="lo-text-field" bind:value={person.department} />
          </div>
        </vbox>
      {:else}
        <vbox class="column main">
          <div class="fields">
            <DialogButton label={$t`Full Name…`} classes="field-button" onClick={() => { isFullNameOpen = true; }} />
            <hbox class="name-and-picture">
              <vbox class="name-fields">
                <input type="text" class="lo-text-field" bind:value={person.name} bind:this={nameInput}
                  aria-label={$t`Full Name`} />
              </vbox>
            </hbox>
            <label for="contact-company">{$t`Company`}</label>
            <input id="contact-company" type="text" class="lo-text-field" bind:value={person.company} />
            <label for="contact-position">{$t`Job title`}</label>
            <input id="contact-position" type="text" class="lo-text-field" bind:value={person.position} />

            <span class="section">{$t`Internet *=> Section with the email, web page and chat addresses`}</span>
            <SlotButton slots={emailSlots} bind:slot={emailSlot} entries={emailAddresses} />
            <SlotField slots={emailSlots} bind:slot={emailSlot} entries={emailAddresses} type="email" />
            <label for="contact-web">{$t`Web page address`}</label>
            <input id="contact-web" type="url" class="lo-text-field"
              value={$urls && firstValue(urls)} on:input={event => setFirstValue(urls, event.currentTarget.value, null)} />
            <label for="contact-im">{$t`IM address`}</label>
            <input id="contact-im" type="text" class="lo-text-field"
              value={$chatAccounts && firstValue(chatAccounts)} on:input={event => setFirstValue(chatAccounts, event.currentTarget.value, "xmpp")} />

            <span class="section">{$t`Phone numbers`}</span>
            {#each phoneRows as row, i}
              <SlotButton slots={phoneSlots} bind:slot={phoneRows[i]} entries={phoneNumbers} />
              <SlotField slots={phoneSlots} bind:slot={phoneRows[i]} entries={phoneNumbers} type="tel" />
            {/each}

            <span class="section">{$t`Addresses *=> Section with the postal addresses of the contact`}</span>
            <div class="top-aligned">
              <SlotButton slots={addressSlots} bind:slot={addressSlot} entries={streetAddresses}
                onClick={() => { isAddressOpen = true; }} />
            </div>
            <button class="address-box" title={$t`Edit the address`} on:click={() => { isAddressOpen = true; }}>
              {$streetAddresses && addressText(addressSlot.valueIn(streetAddresses))}
            </button>
          </div>
        </vbox>
        <vbox class="picture-box">
          <button class="picture" on:click={() => catchErrors(onSelectPicture)}
            title={$person.picture ? $t`Change Picture…` : $t`Add Picture…`}>
            <PersonPicture {person} size={104} />
            <hbox class="camera"><CameraIcon size={16} /></hbox>
          </button>
        </vbox>
      {/if}

      {#if page == "general"}
        <vbox class="column side">
          <vbox class="business-card">
            <hbox class="card-top">
              <PersonPicture {person} size={56} />
              <vbox class="card-text">
                <span class="card-name">{$person.name || $t`Untitled *=> Placeholder for a contact or group without a name`}</span>
                {#if $person.company}<span>{$person.company}</span>{/if}
                {#if $person.position}<span>{$person.position}</span>{/if}
              </vbox>
            </hbox>
            {#if preferredPhone}<span class="card-detail">{preferredPhone}</span>{/if}
            {#if preferredEmail}<span class="card-detail link">{preferredEmail}</span>{/if}
          </vbox>
          <label for="contact-notes" class="notes-label">{$t`Notes`}</label>
          <textarea id="contact-notes" class="lo-text-field" bind:value={person.notes} />
        </vbox>
      {/if}
    </hbox>
  </FormCard>
  <FileSelector {acceptFileTypes} bind:this={fileSelector} />
</vbox>

{#if isFullNameOpen}
  <FullNameDialog {person} on:close={() => { isFullNameOpen = false; }} />
{/if}
{#if isAddressOpen}
  <CheckAddressDialog value={addressSlot.valueIn(streetAddresses)}
    on:change={event => { addressSlot = addressSlot.setValueIn(streetAddresses, event.detail, addressSlots); }}
    on:close={() => { isAddressOpen = false; }} />
{/if}

<svelte:window on:keydown={onKeyDown} />

<script lang="ts">
  import { ContactEntry, Person } from "../../../logic/Abstract/Person";
  import { ContactActions } from "../ContactActions";
  import { emailSlots, phoneSlots, addressSlots, phoneSlot } from "./ContactSlots";
  import { addressText } from "../Person/ContactColumns";
  import { newPerson } from "../../../frontend/Contacts/Person/Selected";
  import { catchErrors } from "../../../frontend/Util/error";
  import { getOSName } from "../../../frontend/Util/util";
  import Ribbon from "../../Shared/Ribbon/Ribbon.svelte";
  import RibbonTab from "../../Shared/Ribbon/RibbonTab.svelte";
  import RibbonGroup from "../../Shared/Ribbon/RibbonGroup.svelte";
  import RibbonButton from "../../Shared/Ribbon/RibbonButton.svelte";
  import RibbonToggleButton from "../../Shared/Ribbon/RibbonToggleButton.svelte";
  import RibbonMenuButton from "../../Shared/Ribbon/RibbonMenuButton.svelte";
  import RibbonSplitButton from "../../Shared/Ribbon/RibbonSplitButton.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import NewEventRibbonButton from "../../Calendar/NewEventRibbonButton.svelte";
  import SubMenu from "../../Shared/Menu/SubMenu.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import PersonPicture from "../Person/PersonPicture.svelte";
  import FormCard from "./FormCard.svelte";
  import SlotButton from "./SlotButton.svelte";
  import SlotField from "./SlotField.svelte";
  import FullNameDialog from "./FullNameDialog.svelte";
  import CheckAddressDialog from "./CheckAddressDialog.svelte";
  import Encryption from "./Encryption.svelte";
  import AllFieldsPage from "./AllFieldsPage.svelte";
  import FileSelector from "../../../frontend/Mail/Composer/Attachments/FileSelector.svelte";
  import { scaleImageToDataURL } from "../../../frontend/Shared/image";
  import SaveCloseIcon from "lucide-svelte/icons/save";
  import SaveNewIcon from "lucide-svelte/icons/file-plus-corner";
  import SameCompanyIcon from "lucide-svelte/icons/building-2";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import GeneralIcon from "lucide-svelte/icons/contact-round";
  import DetailsIcon from "lucide-svelte/icons/list";
  import CertificatesIcon from "lucide-svelte/icons/file-badge";
  import AllFieldsIcon from "lucide-svelte/icons/table-properties";
  import MailIcon from "lucide-svelte/icons/mail";
  import MeetingIcon from "lucide-svelte/icons/calendar-plus";
  import MoreIcon from "lucide-svelte/icons/ellipsis";
  import CallIcon from "lucide-svelte/icons/phone";
  import PictureIcon from "lucide-svelte/icons/circle-user-round";
  import ChangePictureIcon from "lucide-svelte/icons/image-up";
  import RemovePictureIcon from "lucide-svelte/icons/image-off";
  import CameraIcon from "lucide-svelte/icons/camera";
  import type { URLString } from "../../../logic/util/util";
  import type { ArrayColl } from "svelte-collections";
  import { onMount, tick } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let person: Person;

  let nameInput: HTMLInputElement;
  let page: "general" | "details" | "certificates" | "all-fields" = "general";
  let isFullNameOpen = false;
  let isAddressOpen = false;

  $: emailAddresses = person.emailAddresses;
  $: phoneNumbers = person.phoneNumbers;
  $: chatAccounts = person.chatAccounts;
  $: urls = person.urls;
  $: streetAddresses = person.streetAddresses;
  $: hasEmailAddress = $emailAddresses.some(entry => !!entry.value);
  $: preferredEmail = $emailAddresses.sortBy(entry => entry.preference).first?.value || null;
  $: preferredPhone = $phoneNumbers.sortBy(entry => entry.preference).first?.value || null;

  let emailSlot = emailSlots[0];
  let phoneRows = ["business", "home", "business-fax", "mobile"].map(id => phoneSlot(id));
  let addressSlot = addressSlots.find(slot => slot.entryIn(person.streetAddresses)) ?? addressSlots[0];

  onMount(async () => {
    await tick();
    if (!person.name) {
      nameInput?.focus();
    }
  });

  function firstValue(entries: ArrayColl<ContactEntry>): string {
    return entries.first?.value ?? "";
  }

  function setFirstValue(entries: ArrayColl<ContactEntry>, value: string, protocol: string | null) {
    let entry = entries.first;
    if (entry && value.trim()) {
      entry.value = value.trim();
    } else if (entry) {
      entries.remove(entry);
    } else if (value.trim()) {
      entries.add(new ContactEntry(value.trim(), "work", protocol));
    }
  }

  async function save() {
    await person.save();
    $newPerson = null;
  }

  async function saveAndClose() {
    await save();
    ContactActions.closeForm(person);
  }

  async function saveAndNew() {
    await save();
    ContactActions.edit(ContactActions.createPerson(person.addressbook));
  }

  async function saveAndNewFromSameCompany() {
    await save();
    ContactActions.edit(ContactActions.createColleague(person));
  }

  async function deleteIt() {
    if (await ContactActions.deleteContacts([person])) {
      ContactActions.closeForm(null);
    }
  }

  // <copied from="../../../frontend/Contacts/PersonPage/SetPictureButton.svelte">
  let fileSelector: FileSelector;
  const acceptFileTypes = [ "image/*", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg" ];

  async function onSelectPicture() {
    let file = await fileSelector.selectFile();
    if (!file) {
      return;
    }
    person.picture = await scalePicture(file);
  }

  async function scalePicture(file: Blob): Promise<URLString> {
    const kPictureSize = 240; // at least 96px * 2 for HiDPI
    /** ActiveSync allows only 48 kB of base64 for a contact picture @see [MS-ASCNTC] 2.2.2.58 `Picture`
     * and the other protocols have size limits, too */
    const kMaxPictureLength = 48 * 1024;

    return await scaleImageToDataURL(file, kPictureSize, kMaxPictureLength);
  }
  // </copied>

  let pageEl: HTMLElement;
  function onKeyDown(event: KeyboardEvent) {
    let target = event.target as HTMLElement;
    if (!pageEl?.contains(target) && target != document.body) {
      return;
    }
    if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() == "s") {
      event.preventDefault();
      catchErrors(save);
    } else if (event.altKey && !event.ctrlKey && !event.shiftKey && event.code == "KeyS" && getOSName() != "macintosh") {
      event.preventDefault();
      catchErrors(saveAndClose);
    }
  }
</script>

<style>
  .contact-form-page {
    min-height: 0;
  }
  .form-body {
    min-height: 0;
    overflow-y: auto;
    gap: 24px;
    padding: 16px 24px 24px 24px;
    align-items: start;
  }
  .column.main {
    flex: 3 1 0;
    min-width: 360px;
    max-width: 560px;
  }
  .column.side {
    flex: 2 1 0;
    min-width: 240px;
    max-width: 420px;
    align-self: stretch;
  }
  .fields {
    display: grid;
    grid-template-columns: 140px minmax(0, 1fr);
    align-items: center;
    gap: 6px 12px;
  }
  .fields :global(.field-button) {
    width: 100%;
    height: 28px;
    justify-content: start;
  }
  .name-and-picture {
    min-width: 0;
  }
  .name-fields {
    flex: 1;
    min-width: 0;
  }
  .section {
    grid-column: 1 / -1;
    margin-block-start: 10px;
    font-weight: 600;
    color: var(--lo-fg);
  }
  label {
    color: var(--lo-fg-secondary);
  }
  .top-aligned {
    align-self: start;
  }
  .address-box {
    min-height: 72px;
    padding: 6px 8px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
    white-space: pre-line;
    cursor: text;
  }
  .address-box:hover {
    border-color: var(--lo-border-strong);
  }
  .picture-box {
    position: relative;
    flex-shrink: 0;
  }
  .picture {
    position: relative;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    cursor: pointer;
  }
  .picture:hover {
    filter: brightness(0.92);
  }
  .camera {
    position: absolute;
    right: 0;
    bottom: 0;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 1px solid var(--lo-border);
    border-radius: 50%;
    background-color: var(--lo-pane-bg);
    color: var(--lo-accent-text);
  }
  .business-card {
    gap: 4px;
    padding: 16px;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius);
    background-color: var(--lo-pane-alt-bg);
  }
  .card-top {
    gap: 12px;
    align-items: center;
    margin-block-end: 6px;
  }
  .card-text {
    min-width: 0;
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .card-name {
    color: var(--lo-fg);
    font-size: var(--lo-font-size);
    font-weight: 600;
  }
  .card-detail {
    font-size: var(--lo-font-size-small);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-detail.link {
    color: var(--lo-accent-text);
  }
  .notes-label {
    margin-block: 20px 6px;
    font-weight: 600;
    color: var(--lo-fg);
  }
  textarea {
    flex: 1;
    min-height: 200px;
    resize: vertical;
  }
</style>
