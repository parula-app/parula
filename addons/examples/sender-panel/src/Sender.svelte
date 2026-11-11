{#if $from}
  <div class="sender" class:dark={$context.theme.dark}>
    <div class="initial">{initial}</div>
    <div class="names">
      <div class="name">{$from.name || $from.emailAddress}</div>
      <div class="address">{$from.emailAddress}</div>
    </div>
  </div>
{/if}

<script lang="ts">
  export let context: typeof mustang.ui.context;

  // The app sends the next message when the user reads another one
  $: from = $context.message?.from;
  $: initial = ($from?.name || $from?.emailAddress || "?").substring(0, 1).toUpperCase();
</script>

<style>
  .sender {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border: 1px solid var(--border, #E1E2E5);
    border-radius: var(--border-radius, 5px);
    color: var(--fg);
  }
  .initial {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background-color: var(--selected-bg, #4A7BC4);
    color: var(--selected-fg, white);
    font-weight: bold;
  }
  .sender.dark .initial {
    opacity: 0.85;
  }
  .address {
    opacity: 0.7;
    font-size: 90%;
  }
</style>
