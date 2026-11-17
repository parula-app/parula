<hbox class="new-event-button">
  {#if haveMultipleCalendars}
    <ButtonMenu bind:isMenuOpen>
      <RoundButton
        classes="add-button create"
        label={$t`New event`}
        icon={AddToCalendarIcon}
        iconSize="22px"
        padding="6px"
        slot="control"
        onClick={() => isMenuOpen = !isMenuOpen}
        />
      {#each $shownCalendars.each as calendar}
        <NewEventMenuItem {calendar} startTime={$selectedDate} exact={false} />
      {/each}
    </ButtonMenu>
  {:else}
    <RoundButton
      classes="add-button create"
      label={$t`New event`}
      icon={AddToCalendarIcon}
      iconSize="22px"
      padding="6px"
      onClick={() => createNewEvent($selectedCalendar, $selectedDate, false)}
      />
  {/if}
</hbox>

<script lang="ts">
  import { createNewEvent } from "./event";
  import { selectedCalendar, selectedDate, shownCalendars } from "./selected";
  import ButtonMenu from "../Shared/Menu/ButtonMenu.svelte";
  import NewEventMenuItem from "./NewEventMenuItem.svelte";
  import RoundButton from "../Shared/RoundButton.svelte";
  import AddToCalendarIcon from "lucide-svelte/icons/plus";
  import { t } from "../../l10n/l10n";

  $: haveMultipleCalendars = $shownCalendars.length > 1;
  let isMenuOpen = false;
</script>

<style>
  .new-event-button {
    align-items: center;
    border-right: 1px solid var(--border);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    border-radius: 30px;
    margin: 4px;
  }
  .new-event-button :global(.add-button) {
    align-items: center;
    justify-content: center;
    position: relative;
  }
</style>
