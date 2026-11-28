{#if $selectedPerson}
  <CombinedButton
    icon1={calendarMustangApp.icon}
    icon2={$selectedPerson.picture ?? PersonIcon}
    page="/calendar/person"
    params={{ person: $selectedPerson}} />
{:else}
  <hbox class="empty" />
{/if}
<BasicButton label={$t`TODO`} icon={TODOsIcon} onClick={goToTODOs} />
<AppButton app={calendarMustangApp} page="/calendar/" />
<BasicButton icon={SearchIcon} page="/calendar/search" />
<BasicButton icon={PlusIcon} onClick={() => createNewEvent($selectedCalendar, new Date(), false)} />

<script lang="ts">
  import { createNewEvent } from "../../../Calendar/event";
  import { calendarMustangApp } from "../../../Calendar/CalendarMustangApp";
  import { selectedCalendar } from "../../../Calendar/selected";
  import { selectedPerson } from "../../../Contacts/Person/Selected";
  import { goTo } from "../../selectedApp";
  import AppButton from "../AppButton.svelte";
  import CombinedButton from "../CombinedButton.svelte";
  import BasicButton from "../BasicButton.svelte";
  import SearchIcon from "lucide-svelte/icons/search";
  import PersonIcon from "lucide-svelte/icons/user";
  import PlusIcon from "lucide-svelte/icons/plus";
  import TODOsIcon from "lucide-svelte/icons/square-check-big";
  import { t } from "../../../../l10n/l10n";

  function goToTODOs() {
    goTo("/calendar/todos", {});
  }
</script>
