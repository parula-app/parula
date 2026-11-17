<hbox class="card-field">
  <hbox class="icon">
    <svelte:component this={icon} size={16} />
  </hbox>
  <vbox class="content">
    {#if label}
      <hbox class="label">{label}</hbox>
    {/if}
    <hbox class="value">
      <slot />
    </hbox>
  </vbox>
  {#if copyValue}
    <button class="copy"
      on:click={() => catchErrors(copy)}
      title={copied ? $t`✓ Copied to clipboard` : $t`Copy info to clipboard`}>
      {#if copied}
        <CheckIcon size={14} />
      {:else}
        <CopyIcon size={14} />
      {/if}
    </button>
  {/if}
</hbox>

<script lang="ts">
  import CopyIcon from "lucide-svelte/icons/copy";
  import CheckIcon from "lucide-svelte/icons/check";
  import { catchErrors } from "../../../frontend/Util/error";
  import { sleep } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";

  export let icon: ConstructorOfATypedSvelteComponent;
  export let label: string = null;
  export let copyValue: string = null;

  let copied = false;

  async function copy() {
    await navigator.clipboard.writeText(copyValue);
    copied = true;
    await sleep(2);
    copied = false;
  }
</script>

<style>
  .card-field {
    align-items: start;
    gap: 12px;
    min-width: 0;
    padding: 6px 8px;
    border-radius: var(--lo-radius-small);
  }
  .card-field:hover {
    background-color: var(--lo-hover-bg);
  }
  .icon {
    flex-shrink: 0;
    margin-block-start: 2px;
    color: var(--lo-fg-secondary);
  }
  .content {
    flex: 1;
    min-width: 0;
  }
  .label {
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
  }
  .value {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .value :global(a) {
    color: var(--lo-accent-text);
    text-decoration: none;
  }
  .value :global(a:hover) {
    text-decoration: underline;
  }
  .copy {
    flex-shrink: 0;
    visibility: hidden;
    padding: 4px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
    cursor: pointer;
  }
  .card-field:hover .copy,
  .copy:focus-visible {
    visibility: visible;
  }
  .copy:hover {
    background-color: var(--lo-pressed-bg);
    color: var(--lo-fg);
  }
</style>
