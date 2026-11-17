<hbox class="online-meeting">
  {#if !$event.createOnlineMeetingWithAccount && !readOnly}
    <input class="link-field" type="url" bind:value={event.onlineMeetingURL}
      placeholder={$t`Paste the meeting link`} aria-label={$t`Meeting link`} />
  {:else if $event.onlineMeetingURL}
    <button class="link" title={$t`Open the meeting link`} on:click={() => catchErrors(onJoin)}>
      {$event.onlineMeetingURL}
    </button>
  {:else}
    <span class="pending lo-secondary">
      {$t`${$event.createOnlineMeetingWithAccount.name} creates the meeting link when you send the invitation`}
    </span>
  {/if}
  {#if hasURL}
    <button class="icon-button" title={$t`Copy Link`} aria-label={$t`Copy Link`}
      on:click={() => catchErrors(onCopy)}>
      <CopyIcon size={16} />
    </button>
  {/if}
</hbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { openExternalURL } from "../../../logic/util/os-integration";
  import { catchErrors } from "../../../frontend/Util/error";
  import CopyIcon from "lucide-svelte/icons/copy";
  import { t } from "../../../l10n/l10n";

  export let event: Event;
  export let readOnly = false;

  // <copied from="../../../frontend/Calendar/EditEvent/OnlineMeetingBox.svelte">
  $: hasURL = $event.onlineMeetingURL?.startsWith("https://");

  async function onCopy() {
    await navigator.clipboard.writeText(event.onlineMeetingURL);
  }

  async function onJoin() {
    await openExternalURL(event.onlineMeetingURL);
  }
  // </copied>
</script>

<style>
  .online-meeting {
    flex: 1 1 0;
    align-items: center;
    gap: 4px;
    min-width: 0;
    min-height: 32px;
  }
  .link-field {
    flex: 1 1 0;
    min-width: 0;
    height: 32px;
    padding: 0 4px;
    border: none;
    border-block-end: 1px solid var(--lo-input-border);
    border-radius: 0;
    background: none;
    color: var(--lo-fg);
    font: inherit;
    outline: none;
  }
  .link-field:focus {
    border-block-end-color: var(--lo-accent);
    box-shadow: 0 1px 0 0 var(--lo-accent);
  }
  .link {
    min-width: 0;
    padding: 0 4px;
    overflow: hidden;
    border: none;
    background: none;
    color: var(--lo-accent-text);
    font: inherit;
    text-decoration: underline;
    white-space: nowrap;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .pending {
    padding: 0 4px;
  }
  .icon-button {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
    cursor: pointer;
  }
  .icon-button:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
</style>
