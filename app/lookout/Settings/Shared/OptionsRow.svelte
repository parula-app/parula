<hbox class="options-row">
  <hbox class="row-icon">
    {#if icon}
      <svelte:component this={icon} size={28} strokeWidth={1.25} />
    {/if}
  </hbox>
  <vbox flex class="row-content">
    <slot />
  </vbox>
  {#if $$slots.button}
    <hbox class="row-button">
      <slot name="button" />
    </hbox>
  {/if}
</hbox>

<script lang="ts">
  export let icon: ConstructorOfATypedSvelteComponent = null;
</script>

<style>
  .options-row {
    align-items: start;
    gap: 12px;
  }
  .row-icon {
    flex-shrink: 0;
    width: 32px;
    justify-content: center;
    color: var(--lo-fg-secondary);
  }
  .row-content {
    min-width: 0;
    gap: 6px;
  }
  .row-content :global(label) {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row-content :global(input[type="checkbox"]),
  .row-content :global(input[type="radio"]) {
    margin: 0;
  }
  .row-content :global(.indented) {
    padding-inline-start: 24px;
  }
  .row-content :global(.field-row) {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row-content :global(.field-label) {
    flex-shrink: 0;
    width: 136px;
  }
  .row-content :global(select.lo-text-field) {
    height: 28px;
    min-width: 200px;
  }
  .row-content :global(.hint) {
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .row-button {
    flex-shrink: 0;
  }
  .options-row .row-button :global(.dialog-button) {
    min-width: 168px;
  }
</style>
