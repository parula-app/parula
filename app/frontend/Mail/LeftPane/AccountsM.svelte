<vbox flex class="accounts-pane">
  <FolderList {folders} bind:selectedFolder bind:selectedFolders on:click={() => catchErrors(onFolderSelected)} />

  <header class="accounts-header font-small">
    {$t`Accounts`}
  </header>
  {#if accounts.hasItems}
    <vbox class="accounts">
      <AccountSelectorRound {accounts} bind:selectedAccount iconDefault={AccountIcon} iconSize="32px" />
    </vbox>
  {:else if $selectedWorkspace}
    <div class="warning no-accounts font-small">
      {$t`No accounts in workspace ${$selectedWorkspace.name}`}
    </div>
  {/if}

  <AccountsBarM {selectedAccount} {selectedFolder} />
</vbox>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { type Folder } from "../../../logic/Mail/Folder";
  import { selectedWorkspace } from "../../MainWindow/Selected";
  import { goTo } from "../../AppsBar/selectedApp";
  import AccountSelectorRound from "../../Shared/AccountSelectorRound.svelte";
  import FolderList from "./FolderList.svelte";
  import AccountsBarM from "./AccountsBarM.svelte";
  import AccountIcon from "lucide-svelte/icons/mail";
  import { URLPart } from "../../../logic/util/blob";
  import { catchErrors } from "../../Util/error";
  import { sleep, assert } from "../../../logic/util/util";
  import type { ArrayColl, Collection } from 'svelte-collections';
  import { t } from "../../../l10n/l10n";

  export let accounts: Collection<MailAccount>; /** in */
  export let folders: Collection<Folder>; /** in */
  export let selectedAccount: MailAccount; /** in/out */
  export let selectedFolder: Folder; /** in/out */
  let selectedFolders: ArrayColl<Folder>; /** in/out */

  async function onFolderSelected() {
    await sleep(0.1); // wait for `<FolderList>` to set `selectedFolder`
    assert(selectedFolder, "Need folder");
    goTo(URLPart`/mail/folder/${selectedFolder.account.id}/${selectedFolder.id ?? "noid"}/message-list`, {
      account: selectedFolder.account,
      folder: selectedFolder,
     });
  }
</script>

<style>
  .accounts-pane {
    box-shadow: 2px 0px 6px 0px rgba(0, 0, 0, 10%); /* Also on MessageList */
    z-index: 2;
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
  }

  .accounts-pane :global(.account-list) {
    margin-block-start: -4px;
  }

  header {
    margin-inline-start: 18px;
    color: grey;
  }
  .accounts-header {
    margin-block-start: 6px;
  }

  .accounts {
    align-items: center;
    margin-block: 20px;
  }
  .accounts :global(.account) {
    padding-inline: 16px;
  }

  .warning.no-accounts {
    text-align: center;
    color: grey;
    height: 110px;
  }
</style>
