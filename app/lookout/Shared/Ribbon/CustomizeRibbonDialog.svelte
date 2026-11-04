<Dialog title={$t`Customize the Ribbon`} okLabel={$t`OK`} width="480px" onOK={save} on:close={onClose}>
  <vbox class="customize">
    <span class="intro">{$t`Choose the tabs and groups that the ribbon shows`}</span>
    <hbox class="list-header">
      <span>{$t`Customize the Ribbon`}</span>
      <span class="list-kind">{$t`Main Tabs`}</span>
    </hbox>
    <vbox class="tree" role="tree" aria-label={$t`Main Tabs`}>
      {#each mainTabs as tab (tab)}
        <hbox class="tree-row tab-row" role="treeitem" aria-expanded={!collapsedTabs.has(tab.label)} aria-selected="false">
          <button type="button" class="expander" tabindex="-1"
            title={collapsedTabs.has(tab.label) ? $t`Expand` : $t`Collapse`}
            aria-label={collapsedTabs.has(tab.label) ? $t`Expand` : $t`Collapse`}
            on:click={() => toggleExpanded(tab.label)}>
            <svelte:component this={collapsedTabs.has(tab.label) ? ExpandIcon : CollapseIcon} size={14} />
          </button>
          <Checkbox label={tab.label} checked={!hiddenTabs.has(tab.label)}
            on:change={event => setTabShown(tab.label, event.detail)} />
        </hbox>
        {#if !collapsedTabs.has(tab.label)}
          {#each groupLabels(tab) as groupLabel}
            <hbox class="tree-row group-row" role="treeitem" aria-selected="false">
              <Checkbox label={groupLabel} checked={!hiddenGroups.has(tab.label + "/" + groupLabel)}
                disabled={hiddenTabs.has(tab.label)}
                on:change={event => setGroupShown(tab.label, groupLabel, event.detail)} />
            </hbox>
          {/each}
        {/if}
      {/each}
    </vbox>
  </vbox>
  <svelte:fragment slot="buttons-start">
    <DialogButton label={$t`Reset *=> Show all ribbon tabs and groups again`} tooltip={$t`Show all tabs and groups again`} onClick={reset} />
  </svelte:fragment>
</Dialog>

<script lang="ts">
  import type { RibbonTabInfo } from "./RibbonGroup";
  import { withHiddenRibbonParts, type RibbonHiddenParts } from "./RibbonCustomization";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import Dialog from "../Dialog/Dialog.svelte";
  import DialogButton from "../Dialog/DialogButton.svelte";
  import Checkbox from "../Form/Checkbox.svelte";
  import ExpandIcon from "lucide-svelte/icons/chevron-right";
  import CollapseIcon from "lucide-svelte/icons/chevron-down";
  import { createEventDispatcher, onMount, tick } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let tabs: RibbonTabInfo[];
  export let ribbonID: string;
  const dispatch = createEventDispatcher<{ close: void }>();

  const customization = getLocalStorage<Record<string, RibbonHiddenParts>>("lookout.ribbon.customization", {});
  let hiddenTabs = new Set(customization.value?.[ribbonID]?.tabs ?? []);
  let hiddenGroups = new Set(customization.value?.[ribbonID]?.groups ?? []);
  let collapsedTabs = new Set<string>();
  let isReady = false;

  $: mainTabs = isReady ? tabs.filter(tab => !tab.isContextual) : [];

  onMount(async () => {
    await tick();
    isReady = true;
  });

  function groupLabels(tab: RibbonTabInfo): string[] {
    return [...new Set(tab.groups.map(group => group.label).filter(label => label))];
  }

  function toggleExpanded(tabLabel: string) {
    if (collapsedTabs.has(tabLabel)) {
      collapsedTabs.delete(tabLabel);
    } else {
      collapsedTabs.add(tabLabel);
    }
    collapsedTabs = collapsedTabs;
  }

  function setTabShown(tabLabel: string, shown: boolean) {
    if (shown) {
      hiddenTabs.delete(tabLabel);
    } else {
      hiddenTabs.add(tabLabel);
    }
    hiddenTabs = hiddenTabs;
  }

  function setGroupShown(tabLabel: string, groupLabel: string, shown: boolean) {
    let key = tabLabel + "/" + groupLabel;
    if (shown) {
      hiddenGroups.delete(key);
    } else {
      hiddenGroups.add(key);
    }
    hiddenGroups = hiddenGroups;
  }

  function reset() {
    hiddenTabs = new Set();
    hiddenGroups = new Set();
  }

  function save() {
    let shownTabs = mainTabs.filter(tab => !hiddenTabs.has(tab.label));
    if (!shownTabs.length && mainTabs.length) {
      hiddenTabs.delete(mainTabs[0].label);
    }
    customization.value = withHiddenRibbonParts(customization.value, ribbonID, { tabs: [...hiddenTabs], groups: [...hiddenGroups] });
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .customize {
    gap: 8px;
  }
  .intro {
    color: var(--lo-fg-secondary);
  }
  .list-header {
    align-items: baseline;
    gap: 8px;
    margin-top: 4px;
  }
  .list-kind {
    font-weight: 600;
  }
  .tree {
    height: 360px;
    padding: 4px 0;
    overflow-y: auto;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
  }
  .tree-row {
    flex-shrink: 0;
    align-items: center;
    min-height: 26px;
    padding-inline-end: 8px;
  }
  .tab-row {
    padding-inline-start: 4px;
    font-weight: 600;
  }
  .group-row {
    padding-inline-start: 52px;
  }
  .expander {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    margin-inline-end: 4px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
  }
  .expander:hover {
    background-color: var(--lo-hover-bg);
  }
</style>
