<OptionsPage {icon} description={$t`Change the settings of ${$account.name}`}>
  <OptionsSection title={$t`Account`}>
    <OptionsRow icon={AccountIcon}>
      <grid class="fields">
        <label for="account-name">{$t`Account name`}</label>
        <hbox class="name-row">
          <input id="account-name" class="lo-text-field" type="text" bind:value={account.name} on:input={onChange} required />
          <input type="color" class="color" bind:value={account.color} on:change={onChange} list="proposed-colors"
            title={$t`Color *=> Color of the account`} aria-label={$t`Color *=> Color of the account`} />
        </hbox>
        {#if account instanceof MailAccount || account instanceof ChatAccount || account instanceof MeetAccount}
          <label for="account-realname" title={$t`Your real name, as shown to other people when you are sending messages`}>{$t`Your name`}</label>
          <input id="account-realname" class="lo-text-field" type="text" bind:value={account.realname} on:input={onChange}
            title={$t`Your real name, as shown to other people when you are sending messages`} />
        {/if}
        <label for="account-workspace">{$t`Workspace`}</label>
        <select id="account-workspace" class="lo-text-field" bind:value={account.workspace} on:change={onChange}>
          {#each $workspaces.each as workspace}
            <option value={workspace}>{workspace.name}</option>
          {/each}
        </select>
        <span>{$t`Account type`}</span>
        <span class="value">{getAccountTypeLabel(account)}</span>
      </grid>
    </OptionsRow>
  </OptionsSection>

  {#if mainAccount}
    <OptionsSection title={$t`Part of an account`}>
      <OptionsRow icon={MainAccountIcon}>
        <span>{$t`This is part of the account ${$mainAccount.name}, which has the server and logon settings`}</span>
        <hbox>
          <DialogButton label={$t`Go to ${$mainAccount.name}`} onClick={onOpenMainAccount} />
        </hbox>
      </OptionsRow>
    </OptionsSection>
  {/if}

  <vbox class="extra-settings">
    {#each $extraSettings.each as category}
      <svelte:component this={category.windowContent} {account} />
    {/each}
  </vbox>

  <OptionsSection title={$t`Remove account`}>
    <OptionsRow icon={RemoveIcon}>
      <span>{$t`Remove this account from ${appName}. Its content on this computer is deleted. The content on the server is not affected.`}</span>
      <hbox>
        <DialogButton label={$t`Remove Account…`} onClick={onRemove} />
      </hbox>
    </OptionsRow>
  </OptionsSection>
</OptionsPage>

<!-- <copied from="../../frontend/Settings/AccountGeneral.svelte"> -->
<datalist id="proposed-colors">
  {#each accountColors as color}
    <option value={color}></option>
  {/each}
</datalist>
<!-- </copied> -->

<script lang="ts">
  import type { Account } from "../../logic/Abstract/Account";
  import { accountSettings, settingsCategories } from "./SettingsCategories";
  import { selectedCategory, selectedAccount as selectedSettingsAccount } from "../../frontend/Settings/Window/selected";
  import { selectedAccount, selectedFolder, selectedMessage, selectedMessages } from "../../frontend/Mail/Selected";
  import { getAccountIcon } from "../../frontend/Settings/Shared/accountUIHelper";
  import { getAccountTypeLabel } from "./Shared/AccountLabels";
  import { askYesNo } from "../Shared/Dialog/MessageBox";
  import { accountColors } from "../../logic/Abstract/Workspace";
  import { MailAccount } from "../../logic/Mail/MailAccount";
  import { ChatAccount } from "../../logic/Chat/ChatAccount";
  import { MeetAccount } from "../../logic/Meet/MeetAccount";
  import { appGlobal } from "../../logic/app";
  import { appName } from "../../logic/build";
  import { catchErrors } from "../../frontend/Util/error";
  import { AppWindow } from "../../frontend/MainWindow/AppWindow";
  import OptionsPage from "./Shared/OptionsPage.svelte";
  import OptionsSection from "./Shared/OptionsSection.svelte";
  import OptionsRow from "./Shared/OptionsRow.svelte";
  import DialogButton from "../Shared/Dialog/DialogButton.svelte";
  import AccountIcon from "lucide-svelte/icons/id-card";
  import MainAccountIcon from "lucide-svelte/icons/link";
  import RemoveIcon from "lucide-svelte/icons/user-x";
  import debounce from "lodash/debounce";
  import { get } from "svelte/store";
  import { t } from "../../l10n/l10n";

  export let account: Account;

  const appWindow = AppWindow.current();
  const workspaces = appGlobal.workspaces;

  $: icon = getAccountIcon(account);
  $: mainAccount = $account.isDependentAccount ? $account.mainAccount : null;
  $: extraSettings = accountSettings.filterObservable(cat => account instanceof cat.type && cat.isMain && cat.id != "acc-general");

  // <copied from="../../frontend/Settings/AccountGeneral.svelte">
  const onChange = debounce(() => catchErrors(onSave), 500);
  async function onSave() {
    await account.save();
  }
  // </copied>

  function onOpenMainAccount() {
    $selectedSettingsAccount = mainAccount;
    $selectedCategory = accountSettings.find(cat => mainAccount instanceof cat.type && cat.isMain);
  }

  async function onRemove() {
    if (!await askYesNo($t`Remove account`, $t`Are you sure that you want to remove the account ${account.name} from ${appName}? All its content on this computer will be deleted. Content stored on the server will not be affected.`)) {
      return;
    }
    let appCategory = settingsCategories.find(cat => cat.accounts.contains(account));
    await account.deleteIt();
    for (let eachWindow of AppWindow.all) {
      if (get(eachWindow.uiState(selectedAccount)) == account) {
        let firstAccount = appGlobal.emailAccounts.first;
        eachWindow.uiState(selectedAccount).set(firstAccount);
        eachWindow.uiState(selectedFolder).set(firstAccount?.inbox);
        eachWindow.uiState(selectedMessage).set(null);
        get(eachWindow.uiState(selectedMessages))?.clear();
      }
    }
    appWindow.uiState(selectedSettingsAccount).set(null);
    appWindow.uiState(selectedCategory).set(appCategory ?? settingsCategories.first);
  }
</script>

<style>
  .fields {
    grid-template-columns: 160px minmax(200px, 360px);
    align-items: center;
    gap: 8px 12px;
  }
  .name-row {
    align-items: center;
    gap: 8px;
  }
  .name-row input[type="text"] {
    flex: 1;
    min-width: 0;
  }
  .color {
    width: 32px;
    height: 28px;
    padding: 2px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background: none;
  }
  .value {
    color: var(--lo-fg-secondary);
  }
  .extra-settings {
    gap: 8px;
  }
</style>
