<Dialog {title} width="420px" on:close={() => dispatch("answer", false)}>
  <hbox class="message-box">
    <hbox class="icon" class:question={isQuestion}>
      {#if isQuestion}
        <QuestionIcon size={28} />
      {:else}
        <InfoIcon size={28} />
      {/if}
    </hbox>
    <span class="text">{message}</span>
  </hbox>
  <svelte:fragment slot="footer">
    {#if isQuestion}
      <DialogButton label={$t`Yes`} primary onClick={() => { dispatch("answer", true); }} />
      <DialogButton label={$t`No`} onClick={() => { dispatch("answer", false); }} />
    {:else}
      <DialogButton label={$t`OK`} primary onClick={() => { dispatch("answer", true); }} />
    {/if}
  </svelte:fragment>
</Dialog>

<script lang="ts">
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import QuestionIcon from "lucide-svelte/icons/circle-help";
  import InfoIcon from "lucide-svelte/icons/info";
  import { t } from "../../../l10n/l10n";
  import { createEventDispatcher } from "svelte";

  export let title: string;
  export let message: string;
  export let isQuestion = false;

  const dispatch = createEventDispatcher<{ answer: boolean }>();
</script>

<style>
  .message-box {
    align-items: start;
    gap: 16px;
    padding-block: 8px;
  }
  .icon {
    flex-shrink: 0;
    color: var(--lo-accent-text);
  }
  .text {
    padding-block-start: 4px;
    line-height: 1.45;
  }
</style>
