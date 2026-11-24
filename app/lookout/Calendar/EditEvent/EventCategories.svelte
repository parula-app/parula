<!-- <copied from="../../Mail/Message/MessageHeader.svelte"> -->
{#if $tags.hasItems}
  <hbox class="categories">
    {#each $tags.each as tag (tag)}
      <span class="category" style="--category-color: {tag.color};">
        {tag.name}
        <button class="remove-category" on:click={() => catchErrors(() => event.removeTag(tag))}
          title={$t`Remove category ${tag.name}`} aria-label={$t`Remove category ${tag.name}`}>
          <RemoveIcon size={12} />
        </button>
      </span>
    {/each}
  </hbox>
{/if}

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import RemoveIcon from "lucide-svelte/icons/x";
  import { catchErrors } from "../../../frontend/Util/error";
  import { t } from "../../../l10n/l10n";

  export let event: Event;

  $: tags = event.tags;
</script>

<style>
  .categories {
    flex-shrink: 0;
    flex-wrap: wrap;
    gap: 6px;
    margin: 4px 24px;
  }
  .category {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 2px 0 8px;
    border: 1px solid color-mix(in srgb, var(--category-color) 70%, var(--lo-fg));
    border-radius: 3px;
    background-color: color-mix(in srgb, var(--category-color) 22%, var(--lo-pane-bg));
    font-size: 12px;
    line-height: 20px;
  }
  .remove-category {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 2px;
    background: none;
    color: var(--lo-fg-secondary);
    cursor: pointer;
  }
  .remove-category:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
</style>
<!-- </copied> -->
