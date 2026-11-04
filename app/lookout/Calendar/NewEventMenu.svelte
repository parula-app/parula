<NewEventSubMenu label={$t`Appointment *=> Create a new appointment in the calendar`} icon={NewAppointmentIcon}
  onCreate={calendar => CalendarActions.newEventAtSelection(calendar)} />
<NewEventSubMenu label={$t`Meeting`} icon={NewMeetingIcon}
  onCreate={calendar => CalendarActions.newEventAtSelection(calendar, "meeting")} />
<NewEventSubMenu label={$t`All Day Event`} icon={AllDayIcon}
  onCreate={calendar => CalendarActions.newEventAtSelection(calendar, "all-day")} />
<NewEventSubMenu label={$t`Recurring Appointment`} icon={RecurringIcon}
  onCreate={calendar => CalendarActions.newEventAtSelection(calendar, "recurring")} />
<NewEventSubMenu label={$t`Recurring Meeting`} icon={RecurringMeetingIcon}
  onCreate={calendar => CalendarActions.newEventAtSelection(calendar, "recurring-meeting")} />

<script lang="ts">
  import { CalendarActions } from "./CalendarActions";
  import NewEventSubMenu from "./NewEventSubMenu.svelte";
  import NewAppointmentIcon from "lucide-svelte/icons/calendar-plus";
  import NewMeetingIcon from "lucide-svelte/icons/users-round";
  import AllDayIcon from "lucide-svelte/icons/sun";
  import RecurringIcon from "lucide-svelte/icons/repeat";
  import RecurringMeetingIcon from "lucide-svelte/icons/calendar-sync";
  import { t } from "../../l10n/l10n";
</script>
