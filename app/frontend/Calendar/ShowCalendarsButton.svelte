<hbox class="show-calendars-button" class:closed={!$isCalendarListOpen}>
  <RoundButton
    label={$isCalendarListOpen ? $t`Hide the calendars` : $t`Show the calendars`}
    icon={CalendarIcon}
    iconSize="18px"
    padding="6px"
    border={true}
    selected={$isCalendarListOpen}
    onClick={() => $isCalendarListOpen = !$isCalendarListOpen}
    />
</hbox>

<script lang="ts">
  import { isCalendarListOpen } from "./selected";
  import RoundButton from "../Shared/RoundButton.svelte";
  import CalendarIcon from "lucide-svelte/icons/calendar";
  import { t } from "../../l10n/l10n";
</script>

<style>
  .show-calendars-button {
    margin-inline-start: -2px;
    margin-inline-end: 4px;
  }
  .show-calendars-button.closed :global(button) {
    border-top-color: blue;
    border-bottom-color: #1FA89A;
    border-left-color: #F6CC41;
    border-right-color: red;
  }
</style>
