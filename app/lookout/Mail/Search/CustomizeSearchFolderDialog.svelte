<Dialog title={title} okLabel={$t`OK`} onOK={onSubmit} on:close={onClose} width="480px"
  okDisabled={!name.trim() && $t`Enter a name`}>
  <FormGrid columns="max-content minmax(0, 1fr)">
    <span class="lo-form-label">{$t`Name`}</span>
    <TextField label={$t`Name`} bind:value={name} />
    <span class="lo-form-label">{$t`Criteria`}</span>
    <hbox class="criteria">
      <span class="summary" title={summary}>{summary}</span>
      <DialogButton label={$t`Criteria… *=> Change the search criteria`} onClick={() => { isEditingCriteria = true; }} />
    </hbox>
    <span class="lo-form-label">{$t`Search mail in`}</span>
    <ComboBox label={$t`Search mail in`} options={accountOptions} bind:value={account} width="100%" />
  </FormGrid>
</Dialog>
{#if isEditingCriteria}
  <SearchFolderCriteriaDialog {search} on:change={() => { search = search; }} on:close={() => { isEditingCriteria = false; }} />
{/if}

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import type { SearchEMail } from "../../../logic/Mail/Store/SearchEMail";
  import { appGlobal } from "../../../logic/app";
  import SearchFolderCriteriaDialog from "./SearchFolderCriteriaDialog.svelte";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import FormGrid from "../../Shared/Form/FormGrid.svelte";
  import TextField from "../../Shared/Form/TextField.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import type { ComboOption } from "../../Shared/Form/ComboOption";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let title: string;
  export let name: string;
  export let search: SearchEMail;
  export let onOK: (name: string, search: SearchEMail) => void | Promise<void>;
  const dispatch = createEventDispatcher<{ close: void }>();

  let account: MailAccount | null = search.account && appGlobal.emailAccounts.contains(search.account) ? search.account : null;
  let isEditingCriteria = false;

  const accountOptions: ComboOption<MailAccount | null>[] = [
    { value: null, label: $t`All accounts` },
    ...appGlobal.emailAccounts.contents.map(mailAccount => ({ value: mailAccount, label: mailAccount.name })),
  ];
  $: summary = criteriaSummary(search);

  function criteriaSummary(_search: SearchEMail): string {
    let parts: string[] = [];
    if (search.bodyText) {
      parts.push($t`containing ${search.bodyText}`);
    }
    if (search.includesPerson && search.isOutgoing !== true) {
      parts.push($t`from ${search.includesPerson.name}`);
    }
    if (search.includesPerson && search.isOutgoing === true) {
      parts.push($t`to ${search.includesPerson.name}`);
    }
    if (search.isRead === false) {
      parts.push($t`unread`);
    }
    if (search.isStarred) {
      parts.push($t`flagged *=> Search criteria summary: only flagged emails`);
    }
    if (search.hasAttachment) {
      parts.push($t`with attachments`);
    }
    if (search.tags.hasItems) {
      parts.push(search.tags.contents.map(tag => tag.name).join(", "));
    }
    return parts.join("; ") || $t`All mail`;
  }

  async function onSubmit() {
    search.account = account;
    await onOK(name.trim(), search);
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .criteria {
    align-items: center;
    gap: 8px;
  }
  .summary {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--lo-fg-secondary);
  }
</style>
