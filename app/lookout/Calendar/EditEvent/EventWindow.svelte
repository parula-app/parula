<SecondaryWindow title={$event.title || $t`Untitled *=> Placeholder for an event without a title`}>
  <EditEvent {event} />
</SecondaryWindow>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { selectedEvent } from "../../../frontend/Calendar/selected";
  import SecondaryWindow from "../../MainWindow/SecondaryWindow.svelte";
  import EditEvent from "./EditEvent.svelte";
  import { t } from "../../../l10n/l10n";

  export let event: Event;

  $selectedEvent = event;
</script>
