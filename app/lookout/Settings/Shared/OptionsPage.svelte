<vbox class="options-page">
  <hbox class="page-header">
    <hbox class="page-icon">
      {#if typeof icon == "string"}
        <AppIcon {icon} size="32px" />
      {:else}
        <svelte:component this={icon} size={32} strokeWidth={1.25} />
      {/if}
    </hbox>
    <hbox class="description">{description}</hbox>
  </hbox>
  <slot />
</vbox>

<script lang="ts">
  import AppIcon from "../../../frontend/AppsBar/AppIcon.svelte";

  export let icon: string | ConstructorOfATypedSvelteComponent;
  export let description: string;
</script>

<style>
  .options-page {
    padding: 4px 16px 16px 4px;
  }
  .page-header {
    align-items: center;
    gap: 12px;
    margin-block-end: 12px;
  }
  .page-icon {
    color: var(--lo-accent-text);
  }
  .description {
    font-size: 15px;
  }
</style>
