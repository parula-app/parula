{#if typeof (icon) == "string"}
  <Icon data={icon} {size} />
{:else if icon instanceof URL}
  <img src={icon.href} alt="" class="image-icon" style:width={size} style:height={size} draggable="false" />
{:else if icon}
  <svelte:component this={icon} {size} />
{:else}
  <MissingIcon size={parseInt(size)} />
{/if}

<script lang="ts">
  import Icon from 'svelte-icon/Icon.svelte';
  import MissingIcon from "lucide-svelte/icons/dot";

  /** App icon, either as SVG string, as image URL, or as Svelte component */
  export let icon: string | URL | ConstructorOfATypedSvelteComponent;
  /** CSS size, e.g. "24px" */
  export let size: string;
</script>

<style>
  .image-icon {
    object-fit: contain;
  }
</style>
