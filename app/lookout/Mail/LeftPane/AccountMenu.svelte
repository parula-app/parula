<MenuItem label={$t`New Folder…`} icon={NewFolderIcon}
  onClick={() => { $openNewFolder = { account, parent: null }; }} />
<MenuDivider />
<MenuItem label={$t`Update Folder`} icon={UpdateIcon}
  tooltip={$t`Get new mail for this account`}
  onClick={onGetNewMail} />
{#if (!!account && account.canShareWithPersons() && !account.isDependentAccount)}
  <MenuItem label={$t`Open Shared Folder…`} icon={SharedFolderIcon}
    tooltip={$t`Open the folders that colleagues shared with you`}
    onClick={() => { $openSharedFolder = account; }} />
{/if}
<MenuItem label={$t`Manage Rules & Alerts…`} icon={RulesIcon}
  onClick={() => goTo("/mail/rules", { account })} />
<MenuDivider />
<MenuItem label={$t`Account Properties…`} icon={SettingsIcon}
  onClick={() => openAccountSettings(account)} />
{#if account.mainAccount}
  <MenuItem label={$t`Close "${$account.name}"`} icon={CloseIcon}
    tooltip={$t`Remove your colleague's shared folders from the folder pane`}
    onClick={onClose} />
{/if}
{#if $account.isLoggedIn}
  <MenuItem label={$t`Disconnect *=> Log out of this account`} icon={DisconnectIcon}
    tooltip={$t`Log out of this account`}
    onClick={() => account.logout()} />
{:else}
  <MenuItem label={$t`Connect *=> Log in to this account`} icon={ConnectIcon}
    onClick={() => account.loginAndStartup(true)} />
{/if}

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { selectedAccount, selectedFolder } from "../../../frontend/Mail/Selected";
  import { openAccountSettings } from "../../Settings/SettingsDialogs";
  import { askYesNo } from "../../Shared/Dialog/MessageBox";
  import { openNewFolder, openSharedFolder } from "../Selected";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import UpdateIcon from "lucide-svelte/icons/refresh-cw";
  import NewFolderIcon from "lucide-svelte/icons/folder-plus";
  import RulesIcon from "lucide-svelte/icons/list-filter";
  import SharedFolderIcon from "lucide-svelte/icons/folder-open-dot";
  import SettingsIcon from "lucide-svelte/icons/settings";
  import DisconnectIcon from "lucide-svelte/icons/unplug";
  import ConnectIcon from "lucide-svelte/icons/plug";
  import CloseIcon from "lucide-svelte/icons/folder-x";
  import { appName } from "../../../logic/build";
  import { t } from "../../../l10n/l10n";
  import { goTo } from "../../../frontend/AppsBar/selectedApp";

  export let account: MailAccount;

  async function onClose() {
    if (!await askYesNo($t`Close "${account.name}"`, $t`Are you sure that you want to delete the account ${account.name} and all related data from ${appName}?`)) {
      return;
    }
    await account.deleteIt();
  }

  async function onGetNewMail() {
    // <copied from="../../../frontend/Mail/LeftPane/AccountMenu.svelte">
    if (!account.isLoggedIn) {
      await account.loginAndStartup(true);
    }
    await account.inbox.getNewMessages();

    $selectedAccount = account;
    if ($selectedFolder?.account != account) {
      $selectedFolder = account.inbox;
    }
    // </copied>
  }
</script>
