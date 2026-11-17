{#if $selectedPerson}
  <CombinedButton
    icon1={mailMustangApp.icon}
    icon2={$selectedPerson.picture ?? PersonIcon}
    onClick={() => searchPersonMails($selectedPerson)} />
{:else}
  <hbox class="empty" />
{/if}
<BasicButton
  icon={FolderIcon}
  label={$t`Folders`}
  onClick={() => goTo("/mail", {})} />
<AppButton
  app={mailMustangApp}
  page={URLPart`/mail/folder/${allAccountsAccount.id}/${allAccountsAccount.inbox.id ?? "noid"}/message-list`}
  params={{
    messages: allAccountsAccount.inbox.messages,
    folder: allAccountsAccount.inbox,
    account: allAccountsAccount,
  }}
  />
<BasicButton icon={SearchIcon} page="/mail/search" />
<BasicButton icon={PencilIcon} page="/mail/compose" />

<script lang="ts">
  import { EMail } from "../../../../logic/Mail/EMail";
  import { MailAccount } from "../../../../logic/Mail/MailAccount";
  import { mailMustangApp } from "../../../Mail/MailMustangApp";
  import { Person } from "../../../../logic/Abstract/Person";
  import { newSearchEMail } from "../../../../logic/Mail/Store/setStorage";
  import { selectedAccount, selectedFolder } from "../../../Mail/Selected";
  import { selectedWorkspace } from "../../../MainWindow/Selected";
  import { selectedPerson } from "../../../Contacts/Person/Selected";
  import { allAccountsAccount } from "../../../../logic/Mail/AccountsList/ShowAccounts";
  import { goTo } from "../../selectedApp";
  import AppButton from "../AppButton.svelte";
  import CombinedButton from "../CombinedButton.svelte";
  import BasicButton from "../BasicButton.svelte";
  import SearchIcon from "lucide-svelte/icons/search";
  import PersonIcon from "lucide-svelte/icons/user";
  import PencilIcon from "lucide-svelte/icons/pencil";
  import FolderIcon from "lucide-svelte/icons/folder-open";
  import { URLPart } from "../../../../logic/util/blob";
  import { ArrayColl, mergeColl } from "svelte-collections";
  import { t } from "../../../../l10n/l10n";

  function goToAccount(account: MailAccount) {
    $selectedAccount = account;
    $selectedFolder = account.inbox;
    goTo(URLPart`/mail/folder/${account.id}/${account.inbox.id ?? "noid"}/message-list`, {
      account,
      folder: account.inbox,
    });
  }

  async function searchPersonMails(person: Person) {
    let searchMessages = mergeColl(new ArrayColl<EMail>());
    goTo("/mail/person", { searchMessages });

    let search = newSearchEMail();
    search.workspace = $selectedWorkspace;
    search.includesPerson = person;
    let result = await search.startSearch();
    searchMessages.addColl(result);
  }
</script>
