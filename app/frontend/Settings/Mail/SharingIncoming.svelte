<vbox class="sharing-incoming">
  <HeaderGroupBox>
    <hbox slot="header">{$t`Incoming`} – {$t`Your access to your colleagues' mails`}</hbox>
    <RoundButton
      label={$t`Add`}
      icon={AddIcon}
      onClick={() => showAddDialog = true}
      disabled={showAddDialog}
      slot="buttons-top-right"
      />
    {#if $sharedWith.isEmpty && $availableAccounts.isEmpty}
      <hbox class="nothing">{$t`You are not accessing other accounts`}</hbox>
    {:else}
      {#each $sharedWith.each as otherAccount}
        <hbox class="existing-person">
          <hbox class="name" flex>{otherAccount.name}</hbox>
          <!-- Show access level -->
          <RoundButton
            label={$t`Delete`}
            icon={DeleteIcon}
            onClick={() => onDelete(otherAccount)}
            border={false}
            classes="plain"
            />
        </hbox>
      {/each}
      {#each $availableAccounts.each as person}
        <hbox class="existing-person">
          <hbox class="name available" flex>{person.nameOrEMail}</hbox>
          <RoundButton
            label={$t`Add`}
            icon={AddIcon}
            onClick={() => onAddAvailableAccount(person)}
            border={false}
            classes="plain"
            />
        </hbox>
      {/each}
    {/if}
  </HeaderGroupBox>

  {#if showAddDialog}
    <HeaderGroupBox>
      <vbox slot="header">
        <hbox>{$t`Access your colleague's mails`}</hbox>
        <hbox class="subtitle font-small">{$t`Your colleague needs to have granted you access`}</hbox>
      </vbox>
      <RoundButton
        label={$t`Close`}
        icon={CloseIcon}
        onClick={onCloseAddDialog}
        slot="buttons-top-right"
        />
      <vbox>
        <hbox class="person-input">
          {#if sharedPerson}
            <hbox class="person" flex>{sharedPerson.nameOrEMail}</hbox>
          {:else}
            <PersonAutocomplete
              placeholder={$t`Mail address of your colleague`}
              onAddPerson={checkForShares}
              autofocus
              {skipPersons} />
          {/if}
          <Button
            label={$t`Add`}
            onClick={() => onAddPerson(sharedPerson)}
            disabled={!sharedPerson || errorMessage}
            classes="primary"
            />
        </hbox>
        {#if errorMessage}
          <StatusMessage message={errorMessage} status="warning" />
        {/if}
      </vbox>
    </HeaderGroupBox>
  {/if}
</vbox>

<script lang="ts">
  import { MailAccount } from "../../../logic/Mail/MailAccount";
  import type { Account } from "../../../logic/Abstract/Account";
  import { PersonUID } from "../../../logic/Abstract/PersonUID";
  import { appName } from "../../../logic/build";
  import { catchErrors } from "../../Util/error";
  import PersonAutocomplete from "../../Contacts/PersonAutocomplete/PersonAutocomplete.svelte";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import StatusMessage from "../../Setup/Shared/StatusMessage.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Button from "../../Shared/Button.svelte";
  import AddIcon from "lucide-svelte/icons/plus";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import CloseIcon from "lucide-svelte/icons/x";
  import { ArrayColl, type Collection } from "svelte-collections";
  import { gt, t } from "../../../l10n/l10n";

  export let account: MailAccount;
  let sharedWith: Collection<Account> = new ArrayColl<Account>();
  /** Offered by the server, but not set up here, e.g. deleted by the user */
  let availableAccounts = new ArrayColl<PersonUID>();
  $: account, catchErrors(() => listAccounts());
  $: skipPersons = sharedWith.map(account => new PersonUID((account as MailAccount).emailAddress));

  /** `dependentAccounts()` is a snapshot of the accounts, so re-read both lists
   * whenever we added or deleted one. */
  async function listAccounts() {
    sharedWith = account.dependentAccounts().filterObservable(dep => dep.protocol == account.protocol);
    availableAccounts = await account.availableSharedAccounts();
  }

  async function onDelete(otherAccount: Account) {
    let confirmed = confirm($t`Are you sure that you want to delete the account ${otherAccount.name} and all related data from ${appName}?`);
    if (!confirmed) {
      return;
    }
    await otherAccount.deleteIt();
    await listAccounts();
  }

  let showAddDialog = false;
  let errorMessage: string | null = null;
  let sharedPerson: PersonUID | null = null;
  let sharedFolders: string[] = [];
  const kSharedFolders = ["msgfolderroot", "inbox", "contacts", "calendar"];

  function resetAddDialog() {
    errorMessage = null;
    sharedPerson = null;
    sharedFolders = [];
  }

  async function checkForShares(person: PersonUID) {
    try {
      resetAddDialog();
      let shared = await account.findSharedFolders(person, kSharedFolders);
      if (!shared.length) {
        errorMessage = gt`You have no access to the account of ${person.name ?? ""} ${person.emailAddress}`;
        return;
      }
      sharedFolders = notYetAdded(person, shared);
      if (!sharedFolders.length) {
        errorMessage = gt`You have already added ${person.name ?? person.emailAddress}`;
        return;
      }
      sharedPerson = person;
    } catch (ex) {
      errorMessage = ex.message;
    }
  }

  /** The colleague may share their calendar only after we added their mailbox,
   * or the other way round, so add whatever is not set up here yet.
   * `addSharedAddressbook()` and `addSharedCalendar()` re-use the account that
   * we already have, but `addSharedFolders()` would create a second mail account. */
  function notYetAdded(person: PersonUID, sharedFolders: string[]): string[] {
    let haveMailAccount = account.dependentAccounts().find(other =>
      other.protocol == account.protocol && other instanceof MailAccount &&
      other.isMyEMailAddress(person.emailAddress));
    return haveMailAccount
      ? sharedFolders.filter(folder => folder != "msgfolderroot" && folder != "inbox")
      : sharedFolders;
  }

  async function onAddAvailableAccount(person: PersonUID) {
    sharedFolders = notYetAdded(person, await account.findSharedFolders(person, kSharedFolders));
    await onAddPerson(person);
  }

  async function onAddPerson(person: PersonUID) {
    sharedPerson = null;
    if (sharedFolders.includes("msgfolderroot")) {
      await account.addSharedFolders(person, "msgfolderroot");
    } else if (sharedFolders.includes("inbox")) {
      await account.addSharedFolders(person, "inbox");
    }
    if (sharedFolders.includes("contacts")) {
      await account.addSharedAddressbook(person);
    }
    if (sharedFolders.includes("calendar")) {
      await account.addSharedCalendar(person);
    }
    await listAccounts();
  }

  function onCloseAddDialog() {
    showAddDialog = false;
    resetAddDialog();
  }
</script>

<style>
  .sharing-incoming {
    max-width: 40em;
  }
  .subtitle {
    font-weight: normal;
  }
  .existing-person {
    align-items: center;
  }
  .nothing, .name.available {
    opacity: 50%;
  }
  .person-input {
    align-items: center;
    margin-block-end: 8px;
  }
  .person-input .person {
    justify-content: stretch;
    border-bottom: 1px dotted var(--border);
    margin-inline-end: 16px;
  }
</style>
