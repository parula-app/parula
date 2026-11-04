<vbox flex class="form lo-card">
  <hbox class="form-title">
    <h1>{title}<span class="kind">– {kind}</span></h1>
    <hbox flex />
    <hbox class="title-end">
      <slot name="title-end" />
    </hbox>
  </hbox>
  <slot />
</vbox>

<script lang="ts">
  export let title: string;
  export let kind: string;
</script>

<style>
  .form {
    min-height: 0;
    margin: 0 8px 8px 8px;
    overflow: hidden;
  }
  .form-title {
    flex-shrink: 0;
    align-items: center;
    gap: 12px;
    padding: 14px 24px 12px 24px;
    border-block-end: 1px solid var(--lo-divider);
  }
  h1 {
    margin: 0;
    min-width: 0;
    font-size: var(--lo-font-size-large);
    font-weight: 600;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  h1 .kind {
    margin-inline-start: 8px;
    font-weight: normal;
    color: var(--lo-fg-secondary);
  }
  .title-end {
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
  }
  .form :global(input[type]),
  .form :global(select),
  .form :global(textarea) {
    box-sizing: border-box;
    min-height: 30px;
    padding: 4px 8px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
    color: var(--lo-fg);
    font: inherit;
  }
  .form :global(input[type]:hover),
  .form :global(select:hover),
  .form :global(textarea:hover) {
    border-color: var(--lo-border-strong);
  }
  .form :global(input[type]:focus),
  .form :global(select:focus),
  .form :global(textarea:focus) {
    outline: none;
    border-color: var(--lo-accent);
    box-shadow: inset 0 -1px 0 var(--lo-accent);
  }
  .form :global(input::placeholder),
  .form :global(textarea::placeholder) {
    color: var(--lo-fg-disabled);
  }
</style>
