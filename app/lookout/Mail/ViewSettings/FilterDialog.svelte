<Dialog title={$t`Filter *=> Show only some of the emails in the folder`} okLabel={$t`OK`} onOK={save} width="540px" on:close>
  <DialogTabs tabs={[{ id: "messages", label: $t`Messages` }, { id: "more", label: $t`More Choices` }]}
    bind:selected={tab} />
  <vbox class="tab-page">
    {#if tab == "messages"}
      <FormGrid columns="190px minmax(0, 1fr)">
        <span class="lo-form-label">{$t`Search for the word(s)`}</span>
        <TextField label={$t`Search for the word(s)`} bind:value={words} />
        <span class="lo-form-label">{$t`In *=> as in: Search for the words in the subject field and message body`}</span>
        <ComboBox label={$t`In *=> as in: Search for the words in the subject field and message body`} options={inOptions} value="body"
          disabled={$t`The words are searched in the subject and the message text`} width="100%" />
      </FormGrid>
    {:else}
      <FormGrid columns="190px minmax(0, 1fr)">
        <Checkbox label={$t`Only items that are *=> as in: Only items that are unread`} bind:checked={isReadFiltered} />
        <ComboBox label={$t`Only items that are *=> as in: Only items that are unread`} options={readOptions} bind:value={readValue}
          disabled={!isReadFiltered} width="100%" />
        <Checkbox label={$t`Only items with *=> as in: Only items with one or more attachments`} bind:checked={isAttachmentFiltered} />
        <ComboBox label={$t`Only items with *=> as in: Only items with one or more attachments`} options={attachmentOptions} bind:value={attachmentValue}
          disabled={!isAttachmentFiltered} width="100%" />
        <Checkbox label={$t`Only items which *=> as in: Only items which are flagged`} bind:checked={isFlagFiltered} />
        <ComboBox label={$t`Only items which *=> as in: Only items which are flagged`} options={flagOptions} bind:value={flagValue}
          disabled={!isFlagFiltered} width="100%" />
      </FormGrid>
    {/if}
  </vbox>
  <svelte:fragment slot="buttons-start">
    <DialogButton label={$t`Clear All *=> Remove all criteria`} onClick={clearAll} />
  </svelte:fragment>
</Dialog>

<script lang="ts">
  import { quickSearch } from "../../../frontend/Mail/Selected";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import DialogTabs from "../../Shared/Dialog/DialogTabs.svelte";
  import FormGrid from "../../Shared/Form/FormGrid.svelte";
  import TextField from "../../Shared/Form/TextField.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import type { ComboOption } from "../../Shared/Form/ComboOption";
  import { booleanHasValue } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";

  const inOptions: ComboOption<string>[] = [{ value: "body", label: $t`subject field and message body *=> as in: Search for the words in the subject field and message body` }];
  const readOptions: ComboOption<boolean>[] = [
    { value: false, label: $t`unread` },
    { value: true, label: $t`read *=> as in: Only items that are read` },
  ];
  const attachmentOptions: ComboOption<boolean>[] = [
    { value: true, label: $t`one or more attachments *=> as in: Only items with one or more attachments` },
    { value: false, label: $t`no attachments *=> as in: Only items with no attachments` },
  ];
  const flagOptions: ComboOption<boolean>[] = [
    { value: true, label: $t`are flagged *=> as in: Only items which are flagged` },
    { value: false, label: $t`have no flag *=> as in: Only items which have no flag` },
  ];

  let tab = "messages";
  let words = quickSearch.bodyText ?? "";
  let isReadFiltered = booleanHasValue(quickSearch.isRead);
  let readValue = quickSearch.isRead ?? false;
  let isAttachmentFiltered = booleanHasValue(quickSearch.hasAttachment);
  let attachmentValue = quickSearch.hasAttachment ?? true;
  let isFlagFiltered = booleanHasValue(quickSearch.isStarred);
  let flagValue = quickSearch.isStarred ?? true;

  function clearAll() {
    words = "";
    isReadFiltered = false;
    isAttachmentFiltered = false;
    isFlagFiltered = false;
  }

  function save() {
    quickSearch.bodyText = words.trim() || null;
    quickSearch.isRead = isReadFiltered ? readValue : null;
    quickSearch.hasAttachment = isAttachmentFiltered ? attachmentValue : null;
    quickSearch.isStarred = isFlagFiltered ? flagValue : null;
  }
</script>

<style>
  .tab-page {
    min-height: 140px;
    padding-top: 16px;
  }
</style>
