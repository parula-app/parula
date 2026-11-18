<hbox class="tag font-smallest"
  style="--color: {$tag.color}"
  title={$tag.name}
  on:click
  class:selected={selected == true}
  class:partial={selected === null}
  class:unselected={selected == false}
  class:compact
  class:circle
  >
  {#if !circle}
    <span class="name">{$tag.name}</span>
  {/if}

  <hbox class="buttons-right">
    <slot name="tag-button" {tag} />
  </hbox>
</hbox>

<script lang="ts">
  import type { Tag } from "../../../logic/Abstract/Tag";

  export let tag: Tag;
  /** true = all objects have this tag, null = only some of them,
   * false = none of them, undefined = tags are not being set here */
  export let selected: boolean | null | undefined = undefined;
  /** For message lists: Cut off long names */
  export let compact = false;
  /** Show only the color, without the name */
  export let circle = false;
</script>

<style>
  .tag {
    min-height: 16px;
    border-radius: 8px;
    background-color: var(--color);
    color: white;
    border: 1px solid transparent;
    padding-inline-start: 8px;
    padding-inline-end: 8px;
    margin: 2px 2px;
  }
  .tag:not(:hover) :global(.button) {
    visibility: hidden;
  }
  .tag.unselected {
    background-color: color-mix(in srgb, var(--color) 30%, transparent);
    color: var(--button-fg);
  }
  .tag.selected {
    border: 1px solid var(--button-border);
  }
  .tag.partial {
    border: 1px dashed var(--button-border);
    opacity: 75%;
  }
  .tag.compact {
    min-height: unset;
    border: none;
    margin: 0 2px;
  }
  .compact .name {
    max-width: 10ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag.circle {
    width: 1lh;
    height: 1lh;
    padding: 0;
    border-radius: 50%;
  }
  .buttons-right :global(button) {
    align-self: center;
    margin-inline-start: -8px;
    margin-inline-end: -6px;
  }
</style>
