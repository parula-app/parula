<vbox class="addon" class:selected={isSelected} class:failed={$addon.state == AddonState.Error}>
  <hbox class="row" on:click={onSelect}>
    <hbox class="icon">
      <AddonIcon {addon} size="32px" />
    </hbox>
    <vbox class="main">
      <hbox class="title">
        <div class="name">{$addon.name}</div>
        <div class="version font-small">{$addon.manifest.version}</div>
      </hbox>
      <div class="state font-small">{stateLabel}</div>
      {#if $addon.state == AddonState.Error && $addon.error}
        <div class="error-message font-small">{$addon.error.message ?? $addon.error}</div>
      {/if}
    </vbox>
    <hbox class="enable" on:click|stopPropagation>
      <Checkbox toggle
        checked={$addon.isEnabled}
        allowIndetermined={false}
        tooltip={$addon.isEnabled ? $t`Turn off` : $t`Turn on`}
        on:change={event => catchErrors(() => onEnable(event.detail))}
        />
    </hbox>
  </hbox>
  {#if isSelected}
    <AddonDetails {addon} />
  {/if}
</vbox>

<script lang="ts">
  import { AddonState, type Addon } from "../../../logic/Addons/Addon";
  import AddonDetails from "./AddonDetails.svelte";
  import AddonIcon from "../../Addons/AddonIcon.svelte";
  import Checkbox from "../../Shared/Checkbox.svelte";
  import { catchErrors } from "../../Util/error";
  import { t } from "../../../l10n/l10n";

  export let addon: Addon;
  export let selectedAddon: Addon | null;

  $: isSelected = selectedAddon == addon;
  $: stateLabel = describeState($addon.state, $addon.isEnabled);

  function describeState(state: AddonState, isEnabled: boolean): string {
    if (state == AddonState.Enabled) {
      return $t`Running *=> State of an addon`;
    }
    if (state == AddonState.Error) {
      return $t`Could not start *=> State of an addon`;
    }
    if (state == AddonState.Disabled && isEnabled) {
      return $t`Starting… *=> State of an addon`;
    }
    return $t`Turned off *=> State of an addon`;
  }

  function onSelect() {
    selectedAddon = isSelected ? null : addon;
  }

  async function onEnable(isEnabled: boolean) {
    if (isEnabled) {
      await addon.enable();
    } else {
      await addon.disable();
    }
  }
</script>

<style>
  .addon {
    border-block-end: 1px solid var(--border);
  }
  .row {
    align-items: center;
    padding: 8px 4px;
    gap: 12px;
    cursor: pointer;
    min-width: 0;
  }
  .row:hover {
    background-color: var(--hover-bg);
    color: var(--hover-fg);
  }
  .icon {
    flex: none;
    width: 32px;
    height: 32px;
    align-items: center;
    justify-content: center;
  }
  .main {
    flex: 1 1 0;
    min-width: 0;
  }
  .title {
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .name {
    font-weight: bold;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .version {
    flex: none;
    opacity: 70%;
  }
  .state {
    opacity: 70%;
  }
  .failed .state {
    opacity: 100%;
    font-weight: bold;
  }
  .error-message {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .enable {
    flex: none;
  }
  :global(.lookout-window) .row:hover {
    background-color: var(--lo-hover-bg);
    color: inherit;
  }
  :global(.lookout-window) .enable :global(.checkbox .knob-wrapper) {
    width: 40px;
    min-width: 40px;
    height: 20px;
    box-sizing: border-box;
    border: 1px solid var(--lo-fg-secondary);
    background-color: transparent;
  }
  :global(.lookout-window) .enable :global(.checkbox .knob) {
    top: 3px;
    width: 12px;
    height: 12px;
    box-shadow: none;
  }
  :global(.lookout-window) .enable :global(.checkbox.off .knob) {
    left: 3px;
    background-color: var(--lo-fg-secondary);
  }
  :global(.lookout-window) .enable :global(.checkbox.on .knob-wrapper) {
    border-color: var(--lo-accent);
    background-color: var(--lo-accent);
  }
  :global(.lookout-window) .enable :global(.checkbox.on .knob) {
    right: 3px;
    background-color: var(--lo-accent-fg);
  }
</style>
