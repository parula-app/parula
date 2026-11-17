<hbox class="account-selector">
  {#if icon}
    <Clickable onClick={onIconClick}>
      <hbox class="icon foop"
        style:width={iconSize} style:height={iconSize}
        style="--account-color: {$selectedAccount?.color ?? "black"}">
        {#if accountIcon && typeof(accountIcon) == "string" }
          <img src={accountIcon} width={iconSize} height={iconSize} alt="" class="logo" />
        {:else if icon}
          <svelte:component this={icon} size={iconSize} />
        {/if}
      </hbox>
    </Clickable>
  {/if}
  <select bind:value={selectedAccount}
    class:withLabel {disabled}
    bind:this={selectE}
    on:change={onSelect}>
    {#if showAllOption || typeof(showAllOption) == "string"}
      <option value={null}>
        {#if typeof(showAllOption) == "string"}
          {showAllOption}
        {:else}
          {$t`All`}
        {/if}
      </option>
    {/if}
    {#each $showAccounts.each as account }
      <option value={account}>
        {account.name}
      </option>
    {/each}
  </select>
</hbox>

<script lang="ts">
  import type { Account } from "../../logic/Abstract/Account";
  import { selectedWorkspace } from "../MainWindow/Selected";
  import { t } from "../../l10n/l10n";
  import type { Collection } from "svelte-collections";
  import { createEventDispatcher } from 'svelte';
  import Clickable from "./Clickable.svelte";
  const dispatch = createEventDispatcher<{ select: Account }>();

  export let selectedAccount: Account; /* in/out */
  export let accounts: Collection<Account>;
  export let filterByWorkspace: boolean;
  export let showAllOption: string | boolean = false;
  export let icon: ConstructorOfATypedSvelteComponent | null = null;
  export let iconSize = "18px";
  export let withLabel: boolean = true;
  export let disabled: boolean = false;

  $: accountIcon = $selectedAccount?.icon;

  $: showAccounts = filterByWorkspace && $selectedWorkspace
    ? accounts.filterObservable(acc => acc.workspace == $selectedWorkspace)
    : accounts;

  $: selectedAccount, defaultSelection();
  function defaultSelection() {
    if (!selectedAccount) {
      selectedAccount = showAllOption ? null : showAccounts.first;
    }
  }

  $: showAccounts, onAccountsListChanged();
  function onAccountsListChanged() {
    if (selectedAccount === null && showAllOption) {
      return;
    }
    if (!showAccounts.includes(selectedAccount) &&
        showAccounts.hasItems) {
      selectedAccount = null;
      defaultSelection();
    }
  }

  let selectE: HTMLSelectElement;
  function onIconClick() {
    if (disabled) {
      return;
    }
    selectE.showPicker();
  }

  function onSelect() {
    dispatch("select", selectedAccount);
  }
</script>

<style>
  .account-selector {
    align-items: center;
  }
  select {
    border: none;
    color: inherit;
    background-color: transparent;
  }
  select:not(.withLabel) {
    width: 16px;
    height: 16px;
  }
  .account-selector .icon {
    color: var(--account-color);
    margin-inline-end: 2px;
  }
  .account-selector .icon :global(svg) {
    stroke-width: 1.5;
  }
  select {
    overflow-x: hidden;
    text-overflow: ellipsis;
    max-width: 10em;
  }
</style>
