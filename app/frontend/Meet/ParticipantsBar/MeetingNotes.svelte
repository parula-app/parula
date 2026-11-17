{#if event}
  <vbox class="meeting-header font-normal" class:showDescription>
    <hbox class="title-row">
      <hbox class="title-container">
        <div class="title value font-normal">
          {event.title}
        </div>
      </hbox>
      <Button plain
        classes="description-collapse"
        label={showDescription ? $t`Collapse description` : $t`Show meeting description`}
        onClick={() => showDescription = !showDescription}
        icon={showDescription ? CollapseIcon : ExpandIcon}
        iconOnly
        iconSize="16px"
        />
    </hbox>
    {#if showDescription}
      <WebView html={event.descriptionHTML} title="" {headHTML} />
    {/if}
  </vbox>
{/if}

<script lang="ts">
  import type { VideoConfMeeting } from "../../../logic/Meet/VideoConfMeeting";
  import cssContent from "../../Mail/Message/content.css?inline";
  import cssBody from "../../Mail/Message/content-body.css?inline";
  import WebView from "../../Shared/WebView.svelte";
  import Button from "../../Shared/Button.svelte";
  import ExpandIcon from "lucide-svelte/icons/chevron-down";
  import CollapseIcon from "lucide-svelte/icons/chevron-up";
  import { t } from "../../../l10n/l10n";

  export let meeting: VideoConfMeeting;

  $: event = meeting?.event;
  let showDescription = !!meeting?.event?.descriptionHTML;

  let headHTML = `<style>\n${cssBody}\n${cssContent}\n</style>`;
</script>

<style>
  .meeting-header.showDescription {
    flex: 2 0 0;
  }
  .meeting-header {
    align-items: center;
  }
  .title-row {
    margin-block-start: 8px;
    margin-block-end: 16px;
    /*padding-inline-end: 16px;*/
  }
  .title-container {
    justify-content: center;
    width: 100%;
  }
  .title {
    font-weight: bold;
  }
</style>
