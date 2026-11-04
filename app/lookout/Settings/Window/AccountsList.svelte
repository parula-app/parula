{#if $accounts.hasItems || category.newAccountURL}
  <vbox class="accounts" app={category.id}>
    {#each $accounts.each as account (account.id)}
      <AccountItem {account} {category} />
    {/each}
    {#if category.newAccountURL}
      <button class="nav-entry add" on:click={onNewAccount}>
        <AddIcon size={14} />
        {$t`Add account…`}
      </button>
    {/if}
  </vbox>
{/if}

<script lang="ts">
  import type { SettingsCategory } from "../../../frontend/Settings/SettingsCategory";
  import { openSetup } from "../SettingsDialogs";
  import AccountItem from "./AccountItem.svelte";
  import AddIcon from "lucide-svelte/icons/plus";
  import { t } from "../../../l10n/l10n";

  export let category: SettingsCategory;

  $: accounts = category.accounts;

  function onNewAccount() {
    openSetup(category.newAccountURL, { kind: "options", categoryID: category.id });
  }
</script>

<style>
  .accounts {
    flex-shrink: 0;
  }
  .nav-entry.add {
    height: 28px;
    padding-inline-start: 36px;
    color: var(--lo-accent-text);
    font-size: var(--lo-font-size-small);
  }
</style>
