<RibbonTab label={$t`Search`} isSelected>
  <RibbonGroup label={$t`Scope *=> Ribbon group to choose where to search`}>
    <RibbonToggleButton label={$t`Current Folder`} icon={CurrentFolderIcon}
      selected={$options.scope == CalendarSearchScope.CurrentFolder}
      disabled={!hasSelectedCalendar && $t`Select a calendar first`}
      tooltip={$t`Search only the selected calendar`}
      onClick={() => update({ scope: CalendarSearchScope.CurrentFolder })} />
    <RibbonToggleButton label={$t`All Calendar Items`} icon={AllCalendarsIcon}
      selected={$options.scope == CalendarSearchScope.AllCalendarItems}
      tooltip={$t`Search all calendars`}
      onClick={() => update({ scope: CalendarSearchScope.AllCalendarItems })} />
  </RibbonGroup>
  <RibbonGroup label={$t`Refine *=> Ribbon group to narrow down the search results`}>
    <RibbonMenuButton label={organizerLabel} icon={OrganizerIcon}
      disabled={!organizers.length && !$options.organizerEMail && $t`None of the found items has an organizer`}>
      <MenuItem label={$t`Any Organizer`} icon={AnyOrganizerIcon} checked={!$options.organizerEMail}
        onClick={() => update({ organizerEMail: null })} />
      <MenuDivider />
      {#each organizers as organizer (organizer.emailAddress)}
        <MenuItem label={organizer.name || organizer.emailAddress} tooltip={organizer.emailAddress}
          icon={OrganizerIcon} checked={$options.organizerEMail == organizer.emailAddress}
          onClick={() => update({ organizerEMail: organizer.emailAddress })} />
      {/each}
    </RibbonMenuButton>
    <RibbonToggleButton label={$t`Has Attachments`} icon={AttachmentIcon}
      selected={$options.hasAttachments}
      onClick={() => update({ hasAttachments: !$options.hasAttachments })} />
    <RibbonToggleButton label={$t`Recurring *=> Search only for recurring events`} icon={RecurringIcon}
      selected={$options.isRecurring}
      onClick={() => update({ isRecurring: !$options.isRecurring })} />
  </RibbonGroup>
  <RibbonGroup label={$t`Close`}>
    <RibbonButton label={$t`Close Search`} icon={CloseIcon} shortCutInfo={$t`Esc *=> Escape key`}
      onClick={closeSearch} />
  </RibbonGroup>
</RibbonTab>

<script lang="ts">
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import { calendarSearchOptions as options, CalendarSearchScope, type CalendarSearchOptions } from "../selected";
  import { globalSearchTerm } from "../../../frontend/AppsBar/selectedApp";
  import RibbonTab from "../../Shared/Ribbon/RibbonTab.svelte";
  import RibbonGroup from "../../Shared/Ribbon/RibbonGroup.svelte";
  import RibbonButton from "../../Shared/Ribbon/RibbonButton.svelte";
  import RibbonToggleButton from "../../Shared/Ribbon/RibbonToggleButton.svelte";
  import RibbonMenuButton from "../../Shared/Ribbon/RibbonMenuButton.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import CurrentFolderIcon from "lucide-svelte/icons/calendar";
  import AllCalendarsIcon from "lucide-svelte/icons/calendars";
  import OrganizerIcon from "lucide-svelte/icons/user-round";
  import AnyOrganizerIcon from "lucide-svelte/icons/users-round";
  import AttachmentIcon from "lucide-svelte/icons/paperclip";
  import RecurringIcon from "lucide-svelte/icons/repeat";
  import CloseIcon from "lucide-svelte/icons/x";
  import { t } from "../../../l10n/l10n";

  export let organizers: PersonUID[];
  export let hasSelectedCalendar: boolean;


  $: chosenOrganizer = organizers.find(organizer => organizer.emailAddress == $options.organizerEMail);
  $: organizerLabel = $options.organizerEMail
    ? chosenOrganizer?.name || $options.organizerEMail
    : $t`Organizer *=> The person who invited to this meeting`;

  function update(change: Partial<CalendarSearchOptions>) {
    $options = { ...$options, ...change };
  }

  // <copied from="../CalendarApp.svelte">
  function closeSearch() {
    $globalSearchTerm = null;
    $options = { scope: $options.scope, isRecurring: false, hasAttachments: false, organizerEMail: null };
  }
  // </copied>
</script>
