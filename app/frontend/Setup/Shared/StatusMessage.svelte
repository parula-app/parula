<hbox flex class="status {status}">
  {#if status == "processing"}
    <hbox class="spinner">
      <Spinner size="24px" />
    </hbox>
  {/if}
  <hbox flex class="box">
    <hbox class="icon">
      <slot name="icon" />
    </hbox>
    {#if message}
      <hbox class="message value">
        {message}
      </hbox>
    {/if}
    <slot />
  </hbox>
</hbox>

<script lang="ts">
  import Spinner from "../../Shared/Spinner.svelte";

  export let message: string = null;
  export let status: "success" | "processing" | "error" | "warning" | "" = "";
</script>

<style>
  .status {
    margin-block-start: 8px;
    margin-block-end: 8px;
  }
  .box {
    border-radius: 8px;
    justify-content: start;
    margin-inline-start: 8px;
    margin-inline-end: 24px;
    padding: 6px 16px 6px 12px;
  }
  .spinner {
    margin: 4px;
  }
  .message {
    overflow-wrap: anywhere;
  }
  .success .box {
    background-color: #E7F9EC;
    color: #044f1a;
    border: 1px solid #0BC24180;
  }
  .processing .box {
    background-color: #F0F9F8;
    color: #455468;
    margin-inline-start: 16px;
  }
  .warning .box,
  .error .box {
    background-color: #F8FFD2;
    color: #DD0000;
    border: 1px solid #FFC83A;
    max-width: 40em;
  }
  .error .box :global(.button) {
    color: #AA0000;
  }
  @media (prefers-color-scheme: dark) {
    .success .box,
    .processing .box,
    .warning .box,
    .error .box {
      background-color: unset;
    }
    .warning .box,
    .error .box {
      color: #FF3333;
    }
    .error .box :global(.button) {
      color: #FFC83A;
    }
  }
  .icon {
    margin-inline-end: 6px;
  }
</style>
