{#if sml && isKnownType}
  <ActionCard title={title} subtitle={subtitle} icon={icon(type)} wide={useCalendar && type != "SimplePoll"}>
    <svelte:fragment slot="actions">
      {#if type != "SimplePoll"}
        <DialogButton label={$t`Use calendar`} icon={CalendarIcon} classes="plain" pressed={useCalendar}
          onClick={() => { useCalendar = !useCalendar; }} />
      {/if}
      <slot name="actions" />
    </svelte:fragment>
    {#if type == "SimplePoll"}
      <Poll {sml} {myReaction} />
    {:else if useCalendar}
      <SMLCalendar>
        {#if type == "MeetingTimePoll"}
          <CalendarMeetingTimePoll {sml} {myReaction} />
        {:else if type == "BookMe"}
          <CalendarBook {sml} {myReaction} />
        {/if}
      </SMLCalendar>
    {:else if type == "MeetingTimePoll"}
      <MeetingTimePoll {sml} {myReaction} />
    {:else if type == "BookMe"}
      <Book {sml} {myReaction} />
    {/if}
  </ActionCard>
{/if}

<script lang="ts">
  import type { SMLData } from "../../../logic/Mail/SML/SMLData";
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { TSMLRequest, TSMLSimplePoll, TSMLThing } from "../../../logic/Mail/SML/TSML";
  import PollIcon from "lucide-svelte/icons/list-checks";
  import SchedulingPollIcon from "lucide-svelte/icons/calendar-clock";
  import BookingsIcon from "lucide-svelte/icons/calendar-check";
  import ActionCard from "./ActionCard.svelte";
  import Poll from "./Poll.svelte";
  import MeetingTimePoll from "../../Calendar/SML/MeetingTimePoll/Poll.svelte";
  import Book from "../../Calendar/SML/BookMe/Book.svelte";
  import SMLCalendar from "../../Calendar/SML/Shared/SMLCalendar.svelte";
  import CalendarMeetingTimePoll from "../../../frontend/Calendar/SML/MeetingTimePoll/Poll.svelte";
  import CalendarBook from "../../../frontend/Calendar/SML/BookMe/Book.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import CalendarIcon from "lucide-svelte/icons/calendar";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  export let sml: SMLData;
  export let message: EMail;

  let useCalendar = false;
  $: type = sml?.type ?? sml?.sml?.["@type"];
  $: isKnownType = ["SimplePoll", "MeetingTimePoll", "BookMe"].includes(type);
  $: request = $sml?.sml as TSMLRequest & Partial<TSMLSimplePoll<TSMLThing>>;
  $: myReaction = isKnownType ? sml.getMyReaction(message) : null;
  $: isOrganizer = !!myReaction?.agent?.email && myReaction.agent.email == request?.organizer?.email;
  $: title = cardTitle(type);
  $: subtitle = cardSubtitle(request, isOrganizer);

  function cardTitle(type: string): string {
    switch (type) {
      case "SimplePoll": return $t`Poll`;
      case "MeetingTimePoll": return $t`Scheduling poll: Vote for the meeting time`;
      case "BookMe": return $t`Book a meeting`;
      default: return "";
    }
  }

  /* <copied to="../Composer/SMLComposer.svelte, ../Composer/PollsGroup.svelte"> */
  function icon(type: string): ConstructorOfATypedSvelteComponent {
    switch (type) {
      case "MeetingTimePoll": return SchedulingPollIcon;
      case "BookMe": return BookingsIcon;
      default: return PollIcon;
    }
  }
  /* </copied> */

  function cardSubtitle(request: TSMLRequest & Partial<TSMLSimplePoll<TSMLThing>>, isOrganizer: boolean): string {
    let parts: string[] = [];
    let organizer = request?.organizer?.name || request?.organizer?.email;
    if (organizer && !isOrganizer) {
      parts.push($t`From ${organizer}`);
    }
    if (request?.ends instanceof Date && !isNaN(request.ends.getTime())) {
      let ends = request.ends.toLocaleDateString(getDateTimeLocale(), { weekday: "short", month: "short", day: "numeric" });
      parts.push($t`Closes on ${ends}`);
    }
    return parts.join(" · ");
  }
</script>
