<vbox class="action-card" class:wide role="group" aria-label={title}>
  <hbox class="card-header">
    <span class="card-icon"><svelte:component this={icon} size={20} /></span>
    <vbox flex class="card-titles">
      <span class="card-title">{title}</span>
      {#if subtitle}
        <span class="card-subtitle">{subtitle}</span>
      {/if}
    </vbox>
    <hbox class="card-actions">
      <slot name="actions" />
    </hbox>
  </hbox>
  <vbox class="card-body">
    <slot />
  </vbox>
  {#if $$slots.footer}
    <hbox class="card-footer">
      <slot name="footer" />
    </hbox>
  {/if}
</vbox>

<script lang="ts">
  export let title: string;
  export let subtitle: string = null;
  export let icon: ConstructorOfATypedSvelteComponent;
  export let wide = false;
</script>

<style>
  .action-card {
    flex-shrink: 0;
    max-width: 640px;
    border: 1px solid var(--lo-border);
    border-inline-start: 3px solid var(--lo-accent);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-bg);
    box-shadow: var(--lo-shadow-card);
  }
  .action-card.wide {
    max-width: none;
  }
  .card-header {
    align-items: center;
    gap: 10px;
    padding: 10px 12px 6px 12px;
  }
  .card-icon {
    display: flex;
    color: var(--lo-accent-text);
  }
  .card-titles {
    min-width: 0;
  }
  .card-title {
    font-weight: 600;
  }
  .card-subtitle {
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .card-actions {
    align-items: center;
    gap: 4px;
  }
  .card-body {
    padding: 4px 12px 12px 42px;
  }
  .card-footer {
    gap: 8px;
    padding: 8px 12px 12px 42px;
    border-top: 1px solid var(--lo-divider);
  }
</style>
