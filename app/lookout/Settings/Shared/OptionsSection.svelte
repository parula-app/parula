<vbox class="options-section">
  <h3>{title}</h3>
  <vbox class="section-content">
    <slot />
  </vbox>
</vbox>

<script lang="ts">
  export let title: string;
</script>

<style>
  .options-section {
    margin-block-start: 8px;
  }
  h3 {
    margin: 0 0 8px 0;
    padding-block-end: 4px;
    border-block-end: 1px solid var(--lo-divider);
    font-size: var(--lo-font-size);
    font-weight: 600;
  }
  .section-content {
    gap: 12px;
    padding-block-end: 8px;
  }
</style>
