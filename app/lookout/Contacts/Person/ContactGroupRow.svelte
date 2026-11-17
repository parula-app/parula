<hbox class="group-row" on:dblclick={() => dispatch("toggle")}>
  <button class="expander" aria-expanded={!group.isCollapsed}
    title={group.isCollapsed ? $t`Expand this group` : $t`Collapse this group`}
    on:click|stopPropagation={() => dispatch("toggle")}>
    <ChevronIcon size="14" class="chevron {group.isCollapsed ? 'collapsed' : ''}" />
  </button>
  <span class="label">{group.label}</span>
  <span class="count">{$t`${group.contacts.length} item(s)`}</span>
</hbox>

<script lang="ts">
  import type { ContactGroupHeader } from "./ContactGrouping";
  import ChevronIcon from "lucide-svelte/icons/chevron-down";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let group: ContactGroupHeader;

  const dispatch = createEventDispatcher<{ toggle: void }>();
</script>

<style>
  .group-row {
    grid-column: 1 / -1;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 8px;
    border-block-end: 1px solid var(--lo-divider);
    color: var(--lo-fg);
    cursor: default;
  }
  .expander {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .expander:hover {
    background-color: var(--lo-hover-bg);
  }
  .expander :global(.chevron) {
    transition: transform 0.1s;
  }
  .expander :global(.chevron.collapsed) {
    transform: rotate(-90deg);
  }
  .label {
    font-weight: 600;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .count {
    flex-shrink: 0;
    color: var(--lo-fg-secondary);
  }
</style>
