<SecondaryWindow title={$event.title || $t`Event`}>
  <ShowEvent {event} />
</SecondaryWindow>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { selectedEvent } from "../selected";
  import SecondaryWindow from "../../MainWindow/SecondaryWindow.svelte";
  import ShowEvent from "./ShowEvent.svelte";
  import { t } from "../../../l10n/l10n";

  export let event: Event;

  $selectedEvent = event;
</script>
