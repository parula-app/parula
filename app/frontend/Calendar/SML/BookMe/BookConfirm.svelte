<hbox class="top buttons">
  <RoundButton
    label={$t`Cancel request`}
    icon={BackIcon}
    onClick={onCancel}
    border={false}
    classes="plain"
    />
</hbox>
<vbox class="book-confirm" flex>
  <hbox flex />
  <vbox class="center">
    <vbox class="icon">
      <SendIcon />
    </vbox>
    <vbox class="objective font-small">
      {$t`Request meeting`}
    </vbox>
    <vbox class="time font-large">
      {getDateString(time)}
    </vbox>
    <vbox class="time font-large">
      {getTimeString(time)}
    </vbox>
    <vbox class="duration font-small">
      {getDurationString(bookMe.duration * 60000)}
    </vbox>
  </vbox>
  <hbox flex />
  <hbox class="buttons">
    <Button
      label={$t`Send request`}
      icon={SendIcon}
      onClick={onConfirm}
      classes="send primary filled"
      disabled={myReaction?.agent?.email == bookMe.organizer?.email}
      />
  </hbox>
</vbox>

<script lang="ts">
  import { type TSMLBookMe, type TSMLAction, TSMLBookMeState } from "../../../../logic/Mail/SML/TSML";
  import Button from "../../../Shared/Button.svelte";
  import SendIcon from "lucide-svelte/icons/send";
  import BackIcon from "lucide-svelte/icons/chevron-left";
  import { getDateString, getDurationString, getTimeString } from "../../../../logic/util/date";
  import { t } from "../../../../l10n/l10n";
  import RoundButton from "../../../Shared/RoundButton.svelte";

  export let bookMe: TSMLBookMe;
  export let time: Date;
  export let myReaction: TSMLAction;

  async function onConfirm() {
    bookMe.state = TSMLBookMeState.UserConfirmed;
    myReaction.state = bookMe.state; // TODO
    // TODO create meeting invitation
  }

  function onCancel() {
    bookMe.state = TSMLBookMeState.Select;
    myReaction.state = bookMe.state; // TODO
  }
</script>

<style>
  .book-confirm {
    margin: 32px;
    align-items: center;
  }
  .center {
    align-items: center;
  }
  .objective {
    margin-block-start: 8px;
    margin-block-end: 32px;
  }
  .time {
    font-weight: 600;
  }
  .duration {
    margin-block-start: 16px;
  }
  .buttons.top {
    align-items: start;
  }
  .icon,
  .buttons :global(.send .icon) {
    color: var(--selected-bg);
  }
  .buttons :global(.send) {
    min-width: 15em;
  }
</style>
