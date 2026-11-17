<vbox class="booking">
  {#if state == TSMLBookMeState.Select}
    <span class="intro">
      {isOrganizer ? $t`You proposed these meeting times` : $t`Choose a time to book a meeting with ${organizerName}`}
    </span>
    <DisplayList {options} duration={bookMe.duration} let:time>
      <DialogButton label={$t`Book *=> Confirm an appointmnet`} icon={BookIcon}
        disabled={isOrganizer ? $t`You proposed this time` : false}
        onClick={() => select(time)} />
    </DisplayList>
  {:else if state == TSMLBookMeState.UserConfirm}
    <vbox class="summary">
      <span class="summary-label">{$t`Request meeting`}</span>
      <span class="summary-time">{pollDayLabel(time)}</span>
      <span class="summary-time">{timeOfDayLabel(time)} – {timeOfDayLabel(pollOptionEnd(time, bookMe.duration))}</span>
      <span class="summary-duration">{durationLabel(bookMe.duration)}</span>
    </vbox>
    <hbox class="buttons">
      <DialogButton label={$t`Send Request`} icon={SendIcon} primary
        disabled={isOrganizer ? $t`You proposed this time` : false}
        onClick={confirm} />
      <DialogButton label={$t`Cancel Request`} onClick={cancel} />
    </hbox>
  {:else if state == TSMLBookMeState.UserConfirmed || state == TSMLBookMeState.BothConfirmed}
    <hbox class="booked">
      <span class="booked-icon">
        {#if state == TSMLBookMeState.BothConfirmed}
          <ConfirmedIcon size={16} />
        {:else}
          <SendIcon size={16} />
        {/if}
      </span>
      <vbox>
        <span class="booked-label">
          {state == TSMLBookMeState.BothConfirmed ? $t`Confirmed meeting` : $t`Requested meeting`}
        </span>
        {#if bookMe.name}
          <span class="booked-title">{bookMe.name}</span>
        {/if}
        {#if time}
          <span>{pollDayLabel(time)}, {timeOfDayLabel(time)} – {timeOfDayLabel(pollOptionEnd(time, bookMe.duration))}</span>
        {/if}
      </vbox>
    </hbox>
  {:else}
    <span class="empty">{$t`This booking is in a state that ${appName} doesn't know`}</span>
  {/if}
</vbox>

<script lang="ts">
  import type { SMLData } from "../../../../logic/Mail/SML/SMLData";
  import { TSMLBookMeState, type TSMLAction, type TSMLBookMe } from "../../../../logic/Mail/SML/TSML";
  import { pollDayLabel, pollOptionEnd } from "../Shared/SMLTimeOptions";
  import { timeOfDayLabel, durationLabel } from "../../EditEvent/TimeOptions";
  import DisplayList from "../Shared/DisplayList.svelte";
  import DialogButton from "../../../Shared/Dialog/DialogButton.svelte";
  import BookIcon from "lucide-svelte/icons/calendar-check";
  import SendIcon from "lucide-svelte/icons/send";
  import ConfirmedIcon from "lucide-svelte/icons/check-check";
  import { ensureArray } from "../../../../logic/util/util";
  import { ArrayColl } from "svelte-collections";
  import { appName } from "../../../../logic/build";
  import { t } from "../../../../l10n/l10n";

  type BookingReaction = TSMLAction & { state?: TSMLBookMeState };

  export let sml: SMLData;
  export let myReaction: BookingReaction;

  $: bookMe = $sml.sml as TSMLBookMe;
  $: options = new ArrayColl(ensureArray(bookMe.options));
  $: isOrganizer = !!myReaction?.agent?.email && myReaction.agent.email == bookMe.organizer?.email;
  $: state = myReaction.state ?? bookMe.state;
  $: time = myReaction.object as any as Date;
  $: organizerName = bookMe.organizer?.name || bookMe.organizer?.email || "";

  // <copied from="../../../../frontend/Calendar/SML/BookMe/BookSelectButtons.svelte" onSelect()>
  function select(selected: Date) {
    bookMe.state = TSMLBookMeState.UserConfirm;
    myReaction.state = bookMe.state;
    myReaction.object = selected as any;
  }
  // </copied>

  // <copied from="../../../../frontend/Calendar/SML/BookMe/BookConfirm.svelte" onConfirm() onCancel()>
  function confirm() {
    bookMe.state = TSMLBookMeState.UserConfirmed;
    myReaction.state = bookMe.state;
  }

  function cancel() {
    bookMe.state = TSMLBookMeState.Select;
    myReaction.state = bookMe.state;
  }
  // </copied>
</script>

<style>
  .booking {
    gap: 6px;
  }
  .intro {
    color: var(--lo-fg-secondary);
  }
  .summary {
    gap: 2px;
    padding: 4px 0 8px 0;
  }
  .summary-label,
  .summary-duration {
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .summary-time {
    font-size: 16px;
    font-weight: 600;
  }
  .buttons {
    gap: 8px;
  }
  .booked {
    align-items: start;
    gap: 8px;
  }
  .booked-icon {
    display: flex;
    padding-top: 2px;
    color: var(--lo-success);
  }
  .booked-label {
    font-weight: 600;
  }
  .empty {
    color: var(--lo-fg-secondary);
  }
</style>
