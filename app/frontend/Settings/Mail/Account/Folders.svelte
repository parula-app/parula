<vbox flex>
  <h2>{$t`Folders`}</h2>
  <hbox class="subtitle">{$t`Rename folders, set special folders, share them with others`}</hbox>

  {#if $mailAccount?.isLoggedIn && $mailAccount.rootFolders.hasItems}
    <Splitter name="settings-mail-folders" initialRightRatio={4}>
      <FolderList folders={mailAccount.rootFolders} bind:selectedFolder={folder} bind:selectedFolders slot="left">
        <hbox class="header" slot="header">
          {$t`Folders`}
          <hbox flex />
          <hbox class="buttons">
            <RoundButton
              icon={AddIcon}
              iconSize="10px"
              padding="3px"
              classes="small"
              label={$t`Create folder`}
              onClick={() => isCreating = "toplevel"}
              />
          </hbox>
        </hbox>
      </FolderList>
      <vbox class="right" slot="right">
        {#if isCreating && folder}
          <CreateFolder parentFolder={folder} location={isCreating} on:close={() => isCreating = false} />
        {:else if folder}
          <FolderProperties {folder} on:createFolder={() => isCreating = "subfolder"} />
        {/if}
      </vbox>
    </Splitter>
  {:else if !$mailAccount?.isLoggedIn}
    <vbox class="login">
      <hbox class="label">{$t`Please log in to account ${mailAccount?.name} first`}</hbox>
      <Button label={$t`Login`} onClick={async () => await mailAccount.loginAndStartup(true)} />
    </vbox>
  {/if}
</vbox>


<script lang="ts">
  import type { Account } from "../../../../logic/Abstract/Account";
  import type { Folder } from "../../../../logic/Mail/Folder";
  import type { MailAccount } from "../../../../logic/Mail/MailAccount";
  import { selectedFolder } from "../../../Mail/Selected";
  import FolderProperties from "../../../Mail/FolderProperties.svelte";
  import FolderList from "../../../Mail/LeftPane/FolderList.svelte";
  import CreateFolder from "./CreateFolder.svelte";
  import Splitter from "../../../Shared/Splitter.svelte";
  import RoundButton from "../../../Shared/RoundButton.svelte";
  import Button from "../../../Shared/Button.svelte";
  import AddIcon from "lucide-svelte/icons/plus";
  import type { ArrayColl } from "svelte-collections";
  import { t } from "../../../../l10n/l10n";

  export let folder: Folder = $selectedFolder;
  export let account: Account = folder?.account;

  $: mailAccount = account as MailAccount;
  let selectedFolders: ArrayColl<Folder>;
  let isCreating: "toplevel" | "subfolder" | false = false;
</script>

<style>
  h2 {
    margin-block-start: 0px;
    margin-block-end: 0px;
  }
  .subtitle {
    margin-block-end: 16px;
  }
  .right {
    margin: 0px 32px;
    max-width: 55em;
  }
  .buttons {
    align-items: center;
  }
  .login {
    align-items: start;
  }
  .login .label {
    margin-block-start: 16px;
    margin-block-end: 8px;
  }
</style>
