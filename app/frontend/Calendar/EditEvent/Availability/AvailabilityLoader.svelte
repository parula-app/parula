{#if error}
  <hbox class="error">
    <ErrorMessageInline ex={error} />
  </hbox>
{:else if freeBusy}
  <slot />
{:else}
  <hbox class="checking">{$t`Checking availability…`}</hbox>
{/if}

<script lang="ts">
  import type { Event } from "../../../../logic/Calendar/Event";
  import { FreeBusy } from "../../../../logic/Calendar/FreeBusy";
  import { appGlobal } from "../../../../logic/app";
  import ErrorMessageInline from "../../../Shared/ErrorMessageInline.svelte";
  import { t } from "../../../../l10n/l10n";

  /** TODO Refactor this. We should not have components merely for functions. */

  /** The meeting, with the participants whose availability to load */
  export let event: Event;
  export let from: Date;
  export let to: Date;
  /** out */
  export let freeBusy: FreeBusy | null = null;

  let error: Error | null = null;
  let loadCount = 0;

  $: participants = event.participants;
  /** Changes only when the availability to load changes, not when the event changes otherwise */
  $: loadKey = [from.getTime(), to.getTime(), ...$participants.contents.map(participant => participant.emailAddress)].join(" ");
  $: loadKey, load();
  async function load() {
    let count = ++loadCount;
    try {
      let result = await FreeBusy.load(event.calendar, participants.contents, from, to);
      if (count == loadCount) {
        freeBusy = result.withMyEvents(event, appGlobal.calendarEvents, from, to);
        error = null;
      }
    } catch (ex) {
      if (count == loadCount) {
        error = ex;
      }
    }
  }
</script>

<style>
  .checking,
  .error {
    margin: 12px;
  }
  .checking {
    opacity: 50%;
  }
</style>
