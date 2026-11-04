<vbox flex class="contact-card">
  <hbox class="header">
    <PersonPicture {person} size={72} />
    <vbox class="title">
      <h1 class="name">{$person.name || $t`(No name)`}</h1>
      {#if jobLine}
        <hbox class="job">{jobLine}</hbox>
      {/if}
      {#if $person.company}
        <hbox class="company">{$person.company}</hbox>
      {/if}
      <hbox class="actions">
        <CardButton label={$t`Email *=> Write an email to the contact`} icon={MailIcon}
          onClick={() => ContactActions.writeMail([person])}
          disabled={$emailAddresses.isEmpty && $t`This contact has no email address`} />
        <CardButton label={$t`Meeting`} icon={MeetingIcon} hasMenu={$shownCalendars.length > 1}
          onClick={event => newEventMenu.openMenu(event.currentTarget as HTMLElement, calendar => ContactActions.newMeeting([person], calendar))}
          disabled={$emailAddresses.isEmpty && $t`This contact has no email address`} />
        {#if preferredPhone}
          <CardButton label={$t`Call`} icon={CallIcon} href="tel:{preferredPhone}" />
        {/if}
        <CardButton label={$t`Edit`} icon={EditIcon}
          onClick={() => ContactActions.edit(person)} />
      </hbox>
    </vbox>
  </hbox>

  <hbox class="pivots" role="tablist">
    {#each pivots as pivot (pivot.id)}
      <button class="pivot" class:active={pivot.id == shownPivot} role="tab" aria-selected={pivot.id == shownPivot}
        on:click={() => shownPivot = pivot.id}>
        {pivot.label}
      </button>
    {/each}
  </hbox>

  {#if shownPivot != "overview"}
    <vbox flex class="sections">
      <ContactHistory {activities} kind={shownPivot}
        emptyText={pivots.find(pivot => pivot.id == shownPivot)?.emptyText}
        on:showmore={() => activities = activities.more()} />
    </vbox>
  {:else}
  <vbox flex class="sections">
    {#if hasContactInfo}
      <section>
        <h2>{$t`Contact information`}</h2>
        <grid class="fields">
          {#each $emailAddresses.each as entry}
            <CardField icon={MailIcon} label={entryLabel(entry, $t`Email *=> Email address of unknown type`)} copyValue={entry.value}>
              <a class="link" href="mailto:{entry.value}">{entry.value}</a>
            </CardField>
          {/each}
          {#each $phoneNumbers.each as entry}
            <CardField icon={PhoneIcon} label={entryLabel(entry, $t`Phone`)} copyValue={entry.value}>
              <a class="link" href="tel:{entry.value}">{entry.value}</a>
            </CardField>
          {/each}
          {#each $chatAccounts.each as entry}
            <CardField icon={ChatIcon} label={entry.protocol ?? entryLabel(entry, $t`Chat`)} copyValue={entry.value}>
              {entry.value}
            </CardField>
          {/each}
          {#each $urls.each as entry}
            <CardField icon={WebsiteIcon} label={entryLabel(entry, $t`Website`)} copyValue={entry.value}>
              <a class="link" href={entry.value} target="_blank">{entry.value}</a>
            </CardField>
          {/each}
          {#each $streetAddresses.each as entry}
            <CardField icon={AddressIcon} label={entryLabel(entry, $t`Address *=> Postal address of unknown type`)}
              copyValue={addressText(entry.value)}>
              <span class="address">{addressText(entry.value)}</span>
            </CardField>
          {/each}
        </grid>
      </section>
    {/if}

    {#if $person.company || $person.position || $person.department}
      <section>
        <h2>{$t`Organization`}</h2>
        <grid class="fields">
          {#if $person.company}
            <CardField icon={CompanyIcon} label={$t`Company`}>{$person.company}</CardField>
          {/if}
          {#if $person.position}
            <CardField icon={JobIcon} label={$t`Job title`}>{$person.position}</CardField>
          {/if}
          {#if $person.department}
            <CardField icon={DepartmentIcon} label={$t`Department`}>{$person.department}</CardField>
          {/if}
        </grid>
      </section>
    {/if}

    {#if $groups.hasItems}
      <section>
        <h2>{$t`Groups`}</h2>
        <grid class="fields">
          {#each $groups.each as entry}
            <CardField icon={GroupIcon} label={entry.purposeLabel}>{entry.value}</CardField>
          {/each}
        </grid>
      </section>
    {/if}

    {#if $person.notes?.trim()}
      <section>
        <h2>{$t`Notes`}</h2>
        <div class="notes">{$person.notes}</div>
      </section>
    {/if}

    {#if !hasContactInfo && !$person.notes?.trim()}
      <hbox class="no-info">{$t`No contact information yet`}</hbox>
    {/if}

    {#if $recentMessages.hasItems}
      <section>
        <h2>{$t`Recent messages`}</h2>
        <ContactHistory {activities} kind={ActivityKind.Messages} maxCount={3} emptyText=""
          on:showall={() => shownPivot = ActivityKind.Messages} />
      </section>
    {/if}

    {#if $recentFiles.hasItems}
      <section>
        <h2>{$t`Recent files`}</h2>
        <ContactHistory {activities} kind={ActivityKind.Files} maxCount={3} emptyText=""
          on:showall={() => shownPivot = ActivityKind.Files} />
      </section>
    {/if}

    <hbox class="saved-in">
      <AddressbookIcon size={14} />
      {$t`Saved in ${$person.addressbook?.name ?? ""}`}
    </hbox>
  </vbox>
  {/if}
</vbox>
<NewEventCalendarMenu bind:this={newEventMenu} />

<script lang="ts">
  import type { Person, ContactEntry } from "../../../logic/Abstract/Person";
  import { addressText } from "../Person/ContactColumns";
  import { ContactActions } from "../ContactActions";
  import { ActivityKind, ContactActivities } from "../History/ContactActivities";
  import ContactHistory from "../History/ContactHistory.svelte";
  import PersonPicture from "../Person/PersonPicture.svelte";
  import CardField from "./CardField.svelte";
  import CardButton from "./CardButton.svelte";
  import NewEventCalendarMenu from "../../Calendar/NewEventCalendarMenu.svelte";
  import { shownCalendars } from "../../../frontend/Calendar/selected";
  import MailIcon from "lucide-svelte/icons/mail";
  import MeetingIcon from "lucide-svelte/icons/calendar-plus";
  import CallIcon from "lucide-svelte/icons/phone-outgoing";
  import EditIcon from "lucide-svelte/icons/square-pen";
  import PhoneIcon from "lucide-svelte/icons/phone";
  import ChatIcon from "lucide-svelte/icons/message-circle";
  import WebsiteIcon from "lucide-svelte/icons/globe";
  import AddressIcon from "lucide-svelte/icons/map-pin";
  import CompanyIcon from "lucide-svelte/icons/building-2";
  import JobIcon from "lucide-svelte/icons/briefcase-business";
  import DepartmentIcon from "lucide-svelte/icons/network";
  import GroupIcon from "lucide-svelte/icons/users-round";
  import AddressbookIcon from "lucide-svelte/icons/book-user";
  import { t } from "../../../l10n/l10n";

  export let person: Person;

  $: emailAddresses = person.emailAddresses;
  $: phoneNumbers = person.phoneNumbers;
  $: chatAccounts = person.chatAccounts;
  $: streetAddresses = person.streetAddresses;
  $: urls = person.urls;
  $: groups = person.groups;

  let newEventMenu: NewEventCalendarMenu;
  let shownPivot: "overview" | ActivityKind = "overview";
  $: pivots = [
    { id: "overview", label: $t`Overview *=> Tab with a summary of the contact`, emptyText: "" },
    { id: ActivityKind.Messages, label: $t`Messages`, emptyText: $t`No messages with this person` },
    { id: ActivityKind.Files, label: $t`Files`, emptyText: $t`No files shared with this person` },
    { id: ActivityKind.Meetings, label: $t`Meetings *=> Tab with the meetings with this person`, emptyText: $t`No meetings with this person` },
  ] as { id: "overview" | ActivityKind, label: string, emptyText: string }[];
  $: activities = new ContactActivities(person);
  $: recentMessages = activities.of(ActivityKind.Messages);
  $: recentFiles = activities.of(ActivityKind.Files);

  $: jobLine = [$person.position, $person.department].filter(part => part).join(", ");
  $: preferredPhone = $phoneNumbers.sortBy(entry => entry.preference).first?.value || null;
  $: hasContactInfo = $emailAddresses.hasItems || $phoneNumbers.hasItems || $chatAccounts.hasItems ||
    $urls.hasItems || $streetAddresses.hasItems;

  function entryLabel(entry: ContactEntry, kind: string): string {
    return entry.purposeLabel || kind;
  }
</script>

<style>
  .address {
    white-space: pre-line;
  }
  .contact-card {
    min-height: 0;
  }
  .header {
    align-items: start;
    gap: 20px;
    padding: 24px 24px 12px 24px;
  }
  .title {
    min-width: 0;
  }
  .name {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .job,
  .company {
    color: var(--lo-fg-secondary);
  }
  .job {
    margin-block-start: 2px;
  }
  .actions {
    flex-wrap: wrap;
    gap: 8px;
    margin-block-start: 14px;
  }
  .pivots {
    flex-shrink: 0;
    gap: 4px;
    padding: 0 16px;
    border-block-end: 1px solid var(--lo-divider);
  }
  .pivot {
    position: relative;
    height: 40px;
    padding: 0 8px;
    border: none;
    background: none;
    color: var(--lo-fg);
    font: inherit;
    cursor: pointer;
  }
  .pivot:hover {
    color: var(--lo-accent-text);
  }
  .pivot.active {
    font-weight: 600;
  }
  .pivot.active::after {
    content: "";
    position: absolute;
    inset-inline: 8px;
    bottom: 0;
    height: 2px;
    border-radius: 1px;
    background-color: var(--lo-accent);
  }
  .sections {
    min-height: 0;
    overflow-y: auto;
    padding: 8px 16px 16px 16px;
  }
  section {
    padding-block: 8px;
  }
  section + section {
    border-block-start: 1px solid var(--lo-divider);
  }
  h2 {
    margin: 4px 8px 6px 8px;
    font-size: 15px;
    font-weight: 600;
  }
  grid.fields {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    column-gap: 8px;
  }
  .notes {
    margin: 0 8px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .no-info {
    margin: 16px 8px;
    color: var(--lo-fg-secondary);
  }
  .saved-in {
    align-items: center;
    gap: 6px;
    margin: 12px 8px 0 8px;
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
  }
  .fields :global(.streetaddress) {
    white-space: normal;
  }
</style>
