{#if subAccounts.hasItems}
  <vbox class="subaccounts">
    <HeaderGroupBox>
      <hbox slot="header">{$t`Sub-Accounts`}</hbox>
      <hbox slot="buttons-top-right" class="buttons">
        <RoundButton
          label={$t`List other available sub-accounts`}
          onClick={onList}
          icon={PlusIcon}
          />
      </hbox>
      <grid class="content">
        {#each $subAccounts.each as subAccount}
          <Button
            label={subAccount.name}
            icon={getAccountIcon(subAccount)}
            onClick={() => openSettingsCategoryForAccount(subAccount)}
            plain={true}
            />
          <hbox class="type font-small">
            {getAccountMainTypeLabel(subAccount)}
          </hbox>
          <hbox class="color" style:background-color={subAccount.color} />
        {/each}
        </grid>
    </HeaderGroupBox>
  </vbox>
{:else if account.mayHaveSubAccounts}
  <hbox class="add-first">
    <RoundButton
      label={$t`List other available sub-accounts`}
      onClick={onList}
      icon={newAccounts?.hasItems ? RefreshIcon : PlusIcon}
      />
  </hbox>
{/if}

{#if $newAccounts?.hasItems}
  <vbox class="newaccounts">
    <HeaderGroupBox>
      <hbox slot="header">{$t`Add Sub-Accounts`}</hbox>
      <grid class="new">
        {#each $newAccounts.each as subAccount}
          <RoundButton
            label={$t`Add`}
            icon={PlusIcon}
            onClick={() => onAddAccount(subAccount)}
            padding="4px"
            />
          <hbox class="name">
            {subAccount.name}
          </hbox>
          <hbox class="type font-small">
            {getAccountMainTypeLabel(subAccount)}
          </hbox>
          <hbox class="color" style:background-color={account.color} />
        {/each}
        </grid>
    </HeaderGroupBox>
  </vbox>
{:else if noneFound}
  <hbox class="no-new">
    <StatusMessage status="warning" message={$t`No additional sub-accounts found`} />
  </hbox>
{/if}

<script lang="ts">
  import type { Account } from "../../logic/Abstract/Account";
  import { openSettingsCategoryForAccount } from "./Window/CategoriesUtils";
  import { getAccountIcon, getAccountMainTypeLabel, getAppGlobalListForAccount } from "./Shared/accountUIHelper";
  import HeaderGroupBox from "../Shared/HeaderGroupBox.svelte";
  import StatusMessage from "../Setup/Shared/StatusMessage.svelte";
  import Button from "../Shared/Button.svelte";
  import RoundButton from "../Shared/RoundButton.svelte";
  import PlusIcon from "lucide-svelte/icons/plus";
  import RefreshIcon from "lucide-svelte/icons/refresh-cw";
  import type { Collection } from "svelte-collections";
  import { t } from "../../l10n/l10n";

  export let account: Account;

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
    // Returns all server resources that could be accounts, but are not yet.
    // As `Account`, but not `save()`d yet.
    // Then, show them in a list, with (+) buttons, to allow the user to add them.
    // Once the user does, set their `.mainAccount`, and `save()` them.
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
    await newAccount.loginAndStartup(false);
  }
</script>

<style>
  .subaccounts {
    max-width: 40em;
  }
  grid.content {
    grid-template-columns: 1fr  auto auto;
    column-gap: 16px;
  }
  .subaccounts .content :global(.button) {
    justify-content: start;
    padding-block: 4px;
    padding-inline-start: 8px;
    margin-inline-start: -8px;
  }
  .color {
    width: 24px;
    margin-block: 4px;
    border: solid 1px black;
    align-self: stretch;
  }
  .type {
    opacity: 60%;
    align-self: center;
  }
  .add-first {
    justify-content: end;
    margin-block-start: 32px;
    margin-inline-end: 20px;
  }
  grid.new {
    grid-template-columns: auto 1fr auto auto;
    column-gap: 16px;
    align-items: center;
  }
  .no-new {
    margin-block: 16px;
  }
</style>
