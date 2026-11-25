<vbox class="show-event" flex>
  <DialogHeader {event} />
  <vbox class="content">
    <InvitationDisplay {event} />

    <hbox class="tags">
      <ExpanderButton bind:expanded={showTags} label={$t`Tags`} icon={TagIcon} />
      {#if showTags}
        <TagSelector tags={availableTags} selectedTags={event.tags} object={event} />
      {/if}
    </hbox>

    {#if $attachments.hasItems}
      <vbox class="attachments">
        <Attachments {attachments} />
      </vbox>
    {/if}

    {#if $event.isCancelled }
      <hbox class="cancelled-text">
        {$t`This meeting has been cancelled by the organizer. You may delete it.`}
      </hbox>
    {:else}
      {#if $event.isMoved}
        <hbox class="moved-text">
          {$t`The organizer changed the time or place of this meeting. Please respond again.`}
        </hbox>
      {/if}
      <InvitationButtons invitation={event} myParticipation={$event.myParticipation} />
    {/if}
  </vbox>
  {#if $event.hasDescription}
    <Paper>
      <WebView html={$event.descriptionHTML} title="" {headHTML} />
    </Paper>
  {/if}
</vbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { availableTags } from "../../../logic/Abstract/Tag";
  import InvitationDisplay from "./InvitationDisplay.svelte";
  import InvitationButtons from "./InvitationButtons.svelte";
  import Attachments from "../../Mail/Message/AttachmentsUI.svelte";
  import DialogHeader from "../DisplayEvent/DialogHeader.svelte";
  import TagSelector from "../../Shared/Tag/TagSelector.svelte";
  import ExpanderButton from "../../Shared/ExpanderButton.svelte";
  import TagIcon from "lucide-svelte/icons/tag";
  import WebView from "../../Shared/WebView.svelte";
  import Paper from "../../Shared/Paper.svelte";
  import cssContent from "../../Mail/Message/content.css?inline";
  import cssBody from "../../Mail/Message/content-body.css?inline";
  import { t } from "../../../l10n/l10n";

  export let event: Event;

  $: attachments = $event.attachments;
  $: showTags = event.tags.hasItems; // On Event change, but keep section after removing last tag

  let headHTML = `<style>\n${cssBody}\n${cssContent}\n</style>`;
</script>

<style>
  .show-event {
    container-type: inline-size;
  }
  .content {
    padding: 24px 32px;
    margin-block-end: 32px;
  }
  .attachments,
  .tags {
    margin-block-end: 16px;
  }
  .cancelled-text,
  .moved-text {
    flex-wrap: wrap;
    background-color: rgba(255, 98, 0, 0.443);
    padding: 8px 12px;
    border-radius: 3px;
    margin: 8px;
  }
</style>
