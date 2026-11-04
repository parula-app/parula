<vbox class="info-page">
  <h1>{$t`Account Information`}</h1>

  <vbox class="account-list" role="listbox" aria-label={$t`Email accounts`}>
    {#each $emailAccounts.each as mailAccount (mailAccount.id)}
      <InfoAccountRow account={mailAccount} isSelected={mailAccount == account} on:click={() => chosenAccount = mailAccount} />
    {:else}
      <span class="lo-secondary empty">{$t`No email account`}</span>
    {/each}
  </vbox>

  <hbox class="add-row">
    <button class="add-account" on:click={() => catchErrors(onAddAccount)}>
      <AddIcon size={16} />
      {$t`Add Account`}
    </button>
  </hbox>

  <vbox class="tiles">
    <BackstageTile icon={AccountSettingsIcon} label={$t`Account Settings`}
      title={$t`Account Settings`}
      description={account
        ? $t`Change the settings of ${$account.name}, its server and logon information, or add and remove accounts`
        : $t`Add and remove accounts or change existing connection settings`}
      onClick={() => account ? openAccountSettings(account) : openOptions("mail")} />

    <BackstageTile icon={RulesIcon} label={$t`Manage Rules & Alerts`}
      title={$t`Rules and Alerts`}
      description={$t`Use Rules and Alerts to help organize your incoming email messages, and receive updates when items are added, changed, or removed`}
      disabled={!account && $t`Add an email account first`}
      onClick={() => goTo("/mail/rules", { account })} />
  </vbox>
</vbox>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { appGlobal } from "../../../logic/app";
  import { openOptions, openAccountSettings, openSetup } from "../SettingsDialogs";
  import { isBackstageOpen } from "./selected";
  import { goTo } from "../../../frontend/AppsBar/selectedApp";
  import { selectedAccount } from "../../../frontend/Mail/Selected";
  import { catchErrors } from "../../../frontend/Util/error";
  import BackstageTile from "./BackstageTile.svelte";
  import InfoAccountRow from "./InfoAccountRow.svelte";
  import AddIcon from "lucide-svelte/icons/plus";
  import AccountSettingsIcon from "lucide-svelte/icons/user-cog";
  import RulesIcon from "lucide-svelte/icons/list-filter";
  import { t } from "../../../l10n/l10n";

  const emailAccounts = appGlobal.emailAccounts;

  let chosenAccount: MailAccount = null;
  $: account = chosenAccount && $emailAccounts.contains(chosenAccount)
    ? chosenAccount
    : $selectedAccount && $emailAccounts.contains($selectedAccount)
      ? $selectedAccount
      : $emailAccounts.first;

  function onAddAccount() {
    $isBackstageOpen = false;
    openSetup("/setup/mail");
  }
</script>

<style>
  .info-page {
    max-width: 760px;
    padding: 24px 40px;
  }
  h1 {
    margin: 0 0 16px 0;
    font-size: 28px;
    font-weight: 300;
  }
  .account-list {
    max-width: 560px;
    padding: 4px;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-bg);
  }
  .empty {
    padding: 12px;
  }
  .add-row {
    margin-block: 8px 12px;
  }
  .add-account {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-bg);
    color: var(--lo-fg);
    font: inherit;
    cursor: pointer;
  }
  .add-account :global(svg) {
    color: var(--lo-accent-text);
  }
  .add-account:hover {
    background-color: var(--lo-hover-bg);
  }
</style>
