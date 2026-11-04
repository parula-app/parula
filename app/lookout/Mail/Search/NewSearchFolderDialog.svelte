<Dialog title={$t`New Search Folder`}
  okLabel={$t`OK`}
  okDisabled={selected.missingValue(values)}
  onOK={onCreate}
  width="480px"
  on:close>
  <vbox class="new-search-folder">
    <span>{$t`Select a Search Folder`}</span>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <vbox class="templates" role="listbox" tabindex="0" aria-label={$t`Select a Search Folder`}
      on:keydown={onKeyDown}>
      {#each templates as template (template.id)}
        {#if template.section}
          <hbox class="section" role="presentation">{template.section}</hbox>
        {/if}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <hbox class="template" class:selected={selected == template}
          role="option" aria-selected={selected == template}
          on:click={() => select(template)}
          on:dblclick={() => template.canChoose && choose()}>
          {template.label}
        </hbox>
      {/each}
    </vbox>
    <GroupBox label={$t`Customize Search Folder`}>
      <hbox class="customize">
        <span class="description" title={selected.description(values)}>{selected.description(values)}</span>
        <DialogButton label={$t`Choose… *=> Choose the value for the selected search folder template`} disabled={!selected.canChoose && $t`This Search Folder needs no choice`}
          onClick={choose} />
      </hbox>
    </GroupBox>
    <hbox class="search-in">
      <span>{$t`Search mail in`}</span>
      <ComboBox label={$t`Search mail in`} options={accountOptions} bind:value={account} width="100%" />
    </hbox>
  </vbox>
</Dialog>
{#if choosing == SearchFolderTemplateID.Person}
  <SearchPersonDialog fieldLabel={$t`From`} person={values.person}
    on:pick={event => { values.person = event.detail; }} on:close={closeChooser} />
{:else if choosing == SearchFolderTemplateID.Categorized}
  <ColorCategoriesDialog isChooseMode chosen={values.tags}
    on:choose={event => { values.tags = event.detail; }} on:close={closeChooser} />
{:else if choosing == SearchFolderTemplateID.Large}
  <MessageSizeDialog sizeMin={values.sizeMin} sizeMax={values.sizeMax}
    on:choose={event => { values.sizeMin = event.detail.sizeMin; values.sizeMax = event.detail.sizeMax; }} on:close={closeChooser} />
{:else if choosing == SearchFolderTemplateID.Words}
  <SearchTextDialog text={values.words}
    on:choose={event => { values.words = event.detail; }} on:close={closeChooser} />
{:else if choosing == SearchFolderTemplateID.Custom}
  <CustomizeSearchFolderDialog title={$t`Custom Search Folder`}
    name={values.customName ?? ""} search={values.customSearch ?? newSearchEMail()}
    onOK={(name, search) => { values.customName = name; values.customSearch = search; account = search.account; }}
    on:close={closeChooser} />
{/if}

<script lang="ts" context="module">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { writable } from "svelte/store";

  export const openNewSearchFolder = writable<{ account: MailAccount | null } | null>(null);
</script>

<script lang="ts">
  import { SavedSearchFolder } from "../../../logic/Mail/Virtual/SavedSearchFolder";
  import { newSearchEMail } from "../../../logic/Mail/Store/setStorage";
  import { allAccountsAccount } from "../../../logic/Mail/AccountsList/ShowAccounts";
  import { appGlobal } from "../../../logic/app";
  import { selectedAccount, selectedFolder } from "../../../frontend/Mail/Selected";
  import { SearchFolderTemplate, SearchFolderTemplateID } from "./SearchFolderTemplates";
  import SearchPersonDialog from "./SearchPersonDialog.svelte";
  import CustomizeSearchFolderDialog from "./CustomizeSearchFolderDialog.svelte";
  import ColorCategoriesDialog from "../../Shared/Tag/ColorCategoriesDialog.svelte";
  import MessageSizeDialog from "../Rules/MessageSizeDialog.svelte";
  import SearchTextDialog from "../Rules/SearchTextDialog.svelte";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import GroupBox from "../../Shared/Form/GroupBox.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import type { ComboOption } from "../../Shared/Form/ComboOption";
  import { t } from "../../../l10n/l10n";

  export let defaultAccount: MailAccount | null = null;

  const templates = SearchFolderTemplate.all();
  const accountOptions: ComboOption<MailAccount | null>[] = [
    { value: null, label: $t`All accounts` },
    ...appGlobal.emailAccounts.contents.map(mailAccount => ({ value: mailAccount, label: mailAccount.name })),
  ];
  let selected = templates[0];
  let values = SearchFolderTemplate.emptyValues();
  let account: MailAccount | null = defaultAccount && appGlobal.emailAccounts.contains(defaultAccount) ? defaultAccount : null;
  let choosing: SearchFolderTemplateID | null = null;

  function select(template: SearchFolderTemplate) {
    selected = template;
  }

  function choose() {
    if (selected.canChoose) {
      choosing = selected.id;
    }
  }

  function closeChooser() {
    choosing = null;
    values = values;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key != "ArrowDown" && event.key != "ArrowUp") {
      return;
    }
    event.preventDefault();
    let pos = templates.indexOf(selected) + (event.key == "ArrowDown" ? 1 : -1);
    selected = templates[Math.max(0, Math.min(templates.length - 1, pos))];
  }

  async function onCreate() {
    let search = newSearchEMail();
    selected.apply(search, values);
    search.account = account;
    let folder = new SavedSearchFolder(search);
    folder.name = selected.name(values);
    await folder.save();
    $selectedAccount = allAccountsAccount;
    $selectedFolder = folder;
  }
</script>

<style>
  .new-search-folder {
    gap: 8px;
  }
  .templates {
    height: 240px;
    padding: 2px 0;
    overflow-y: auto;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
    outline: none;
  }
  .templates:focus-visible {
    box-shadow: inset 0 0 0 2px var(--lo-focus-ring);
  }
  .section {
    flex-shrink: 0;
    padding: 6px 8px 2px 8px;
    font-weight: 600;
  }
  .template {
    flex-shrink: 0;
    align-items: center;
    min-height: 26px;
    padding: 0 8px 0 24px;
    cursor: default;
  }
  .template:hover {
    background-color: var(--lo-hover-bg);
  }
  .template.selected {
    background-color: var(--lo-selected-bg);
    color: var(--lo-selected-fg);
  }
  .customize {
    align-items: center;
    gap: 8px;
    min-height: 32px;
  }
  .description {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .search-in {
    align-items: center;
    gap: 12px;
    margin-top: 4px;
    white-space: nowrap;
  }
</style>
