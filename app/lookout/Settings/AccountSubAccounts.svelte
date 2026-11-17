{#if $subAccounts.hasItems || account.mayHaveSubAccounts}
  <OptionsSection title={$t`Sub-Accounts`}>
    <OptionsRow icon={SubAccountsIcon}>
      {#if $subAccounts.hasItems}
        <vbox class="accounts">
          {#each $subAccounts.each as subAccount}
            <hbox class="account">
              <button class="name" on:click={() => onOpen(subAccount)}>
                <AppIcon icon={getAccountIcon(subAccount)} size="16px" />
                <span>{subAccount.name}</span>
              </button>
              <span class="type">{getAccountMainTypeLabel(subAccount)}</span>
              <hbox class="color" style:background-color={subAccount.color} />
            </hbox>
          {/each}
        </vbox>
      {/if}
      {#if $newAccounts?.hasItems}
        <span>{$t`Add Sub-Accounts`}</span>
        <vbox class="accounts">
          {#each $newAccounts.each as subAccount}
            <hbox class="account">
              <DialogButton label={$t`Add`} icon={PlusIcon} onClick={() => onAddAccount(subAccount)} />
              <span class="name">{subAccount.name}</span>
              <span class="type">{getAccountMainTypeLabel(subAccount)}</span>
              <hbox class="color" style:background-color={account.color} />
            </hbox>
          {/each}
        </vbox>
      {:else if noneFound}
        <span class="hint">{$t`No additional sub-accounts found`}</span>
      {/if}
      <hbox>
        <DialogButton label={$t`List other available sub-accounts`} icon={$newAccounts?.hasItems ? RefreshIcon : PlusIcon}
          onClick={onList} />
      </hbox>
    </OptionsRow>
  </OptionsSection>
{/if}

<script lang="ts">
  import type { Account } from "../../logic/Abstract/Account";
  import { accountSettings } from "./SettingsCategories";
  import { selectedCategory, selectedAccount } from "./Window/selected";
  import { getAccountIcon, getAccountMainTypeLabel, getAppGlobalListForAccount } from "../../frontend/Settings/Shared/accountUIHelper";
  import OptionsSection from "./Shared/OptionsSection.svelte";
  import OptionsRow from "./Shared/OptionsRow.svelte";
  import DialogButton from "../Shared/Dialog/DialogButton.svelte";
  import AppIcon from "../../frontend/AppsBar/AppIcon.svelte";
  import SubAccountsIcon from "lucide-svelte/icons/network";
  import PlusIcon from "lucide-svelte/icons/plus";
  import RefreshIcon from "lucide-svelte/icons/refresh-cw";
  import type { Collection } from "svelte-collections";
  import { t } from "../../l10n/l10n";

  export let account: Account;

  // <copied from="../../frontend/Settings/AccountSubAccounts.svelte">
  $: subAccounts = account.dependentAccounts()
    .filterObservable(acc => acc.protocol != "smtp");
  $: account, reset();

  let newAccounts: Collection<Account> | null = null;
  let noneFound = false;

  function reset() {
    newAccounts = null;
    noneFound = false;
  }

  async function onList() {
    newAccounts = await account.listPossibleSubAccounts();

    if (!newAccounts?.hasItems) {
      noneFound = true;
      setTimeout(() => noneFound = false, 3000);
    }
  }

  async function onAddAccount(newAccount: Account) {
    newAccounts.remove(newAccount);
    subAccounts.add(newAccount);
    newAccount.mainAccount = account;
    getAppGlobalListForAccount(newAccount).add(newAccount);
    await newAccount.save();
    await newAccount.syncOnStartup();
  }
  // </copied>

  function onOpen(subAccount: Account) {
    $selectedAccount = subAccount;
    $selectedCategory = accountSettings.find(cat => subAccount instanceof cat.type && cat.isMain);
  }
</script>

<style>
  .accounts {
    gap: 2px;
  }
  .account {
    align-items: center;
    gap: 12px;
    min-height: 28px;
  }
  .name {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: 320px;
    padding: 2px 6px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
  }
  button.name {
    cursor: pointer;
  }
  button.name:hover {
    background-color: var(--lo-hover-bg);
  }
  .type {
    width: 96px;
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .color {
    width: 16px;
    height: 16px;
    border: 1px solid var(--lo-border);
    border-radius: 2px;
  }
</style>
