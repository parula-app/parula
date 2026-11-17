<hbox class="dialog-tabs" role="tablist" on:keydown={onKeyDown} bind:this={tabsEl}>
  {#each tabs as tab (tab.id)}
    <button type="button" class="dialog-tab" class:selected={tab.id == selected}
      role="tab" aria-selected={tab.id == selected}
      tabindex={tab.id == selected ? 0 : -1}
      disabled={!!tab.disabled}
      title={typeof tab.disabled == "string" ? tab.disabled : null}
      on:click={() => select(tab.id)}>
      {tab.label}
    </button>
  {/each}
</hbox>

<script lang="ts">
  import { createEventDispatcher, onMount } from "svelte";

  /** `disabled`: true, or the reason why the tab is disabled */
  export let tabs: { id: string, label: string, disabled?: boolean | string }[];
  export let selected: string = tabs[0]?.id;

  const dispatch = createEventDispatcher<{ select: string }>();

  let tabsEl: HTMLElement;

  function select(id: string) {
    selected = id;
    dispatch("select", id);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key != "ArrowLeft" && event.key != "ArrowRight") {
      return;
    }
    let forward = (event.key == "ArrowRight") != (getComputedStyle(tabsEl).direction == "rtl");
    selectNext(forward);
    event.preventDefault();
  }

  onMount(() => {
    let dialogEl = tabsEl.closest("dialog");
    dialogEl?.addEventListener("keydown", onDialogKeyDown);
    return () => dialogEl?.removeEventListener("keydown", onDialogKeyDown);
  });

  function onDialogKeyDown(event: KeyboardEvent) {
    if (event.key != "Tab" || !event.ctrlKey || event.altKey || event.defaultPrevented) {
      return;
    }
    selectNext(!event.shiftKey);
    event.preventDefault();
  }

  function selectNext(forward: boolean) {
    let enabled = tabs.filter(tab => !tab.disabled);
    let pos = enabled.findIndex(tab => tab.id == selected);
    let next = enabled[(pos + (forward ? 1 : -1) + enabled.length) % enabled.length];
    select(next.id);
    tabsEl.querySelectorAll<HTMLElement>(".dialog-tab")[tabs.indexOf(next)]?.focus();
  }
</script>

<style>
  .dialog-tabs {
    flex-shrink: 0;
    gap: 4px;
    border-block-end: 1px solid var(--lo-border);
  }
  .dialog-tab {
    position: relative;
    height: 32px;
    padding: 0 12px;
    border: none;
    border-radius: var(--lo-radius-small) var(--lo-radius-small) 0 0;
    background: none;
    color: var(--lo-fg);
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
  }
  .dialog-tab:hover:not(:disabled) {
    background-color: var(--lo-hover-bg);
  }
  .dialog-tab:disabled {
    color: var(--lo-fg-disabled);
    cursor: default;
  }
  .dialog-tab.selected {
    font-weight: 600;
  }
  .dialog-tab.selected::after {
    content: "";
    position: absolute;
    inset-inline: 8px;
    bottom: -1px;
    height: 3px;
    border-radius: 2px;
    background-color: var(--lo-accent);
  }
  .dialog-tab:focus-visible {
    outline: 2px solid var(--lo-focus-ring);
    outline-offset: -2px;
  }
</style>
