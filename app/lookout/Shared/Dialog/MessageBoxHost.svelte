{#if $messageBoxQuestion}
  {#key $messageBoxQuestion}
    <Dialog title={$messageBoxQuestion.title}
      okLabel={$messageBoxQuestion.okLabel} cancelLabel={$messageBoxQuestion.cancelLabel}
      onOK={() => $messageBoxQuestion.answer(true)}
      on:close={() => $messageBoxQuestion?.answer(false)}>
      <span class="message">{$messageBoxQuestion.message}</span>
    </Dialog>
  {/key}
{/if}

<script lang="ts">
  import { messageBoxQuestion } from "./MessageBox";
  import Dialog from "./Dialog.svelte";
</script>

<style>
  .message {
    padding-block: 4px 8px;
    line-height: 1.45;
    white-space: pre-line;
  }
</style>
