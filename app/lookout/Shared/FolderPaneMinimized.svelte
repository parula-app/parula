<vbox class="folder-pane-minimized">
  <button class="expand" on:click={() => dispatch("expand")}
    title={$t`Expand the Folder Pane`} aria-label={$t`Expand the Folder Pane`}>
    <ExpandIcon size={16} />
  </button>
  <button class="folder-name" on:click={() => dispatch("expand")} title={$t`Expand the Folder Pane`}>
    {name}
  </button>
</vbox>

<script lang="ts">
  import ExpandIcon from "lucide-svelte/icons/chevron-right";
  import { t } from "../../l10n/l10n";
  import { createEventDispatcher } from "svelte";

  export let name: string;

  const dispatch = createEventDispatcher<{ expand: void }>();
</script>

<style>
  .folder-pane-minimized {
    flex-shrink: 0;
    align-items: center;
    width: 36px;
    padding: 0 0 8px 4px;
  }
  .expand {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
    cursor: pointer;
  }
  .expand:hover,
  .folder-name:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .folder-name {
    margin-block-start: 8px;
    padding: 8px 4px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
    font: inherit;
    font-weight: 600;
    writing-mode: vertical-rl;
    white-space: nowrap;
    cursor: pointer;
  }
</style>
