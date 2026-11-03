<Dialog title={$t`Rules and Alerts`} on:close={onClose} width="720px" height="720px">
  <DialogTabs tabs={[{ id: "email-rules", label: $t`Email Rules` }]} selected="email-rules" />
  <hbox class="folder-row">
    <span>{$t`Apply changes to this folder`}</span>
    <ComboBox label={$t`Apply changes to this folder`} options={accountOptions($accounts.contents)} bind:value={account} width="320px" />
  </hbox>
  <hbox class="toolbar">
    <DialogButton label={$t`New Rule…`} icon={NewIcon} classes="plain" onClick={onNew} />
    <DialogButton label={$t`Change Rule`} icon={EditIcon} classes="plain" hasMenu
      disabled={!selected ? noSelection : readOnlyReason ?? false}
      onClick={() => { isChangeMenuOpen = !isChangeMenuOpen; }}
      bind:buttonEl={changeButton} />
    <Menu bind:isMenuOpen={isChangeMenuOpen} anchor={changeButton} placement="bottom-start">
      <MenuItem label={$t`Edit Rule Settings…`} icon={EditIcon} onClick={onEdit} />
      <MenuItem label={$t`Rename Rule`} icon={RenameIcon} onClick={() => renaming = selected} />
      <MenuDivider />
      <MenuItem label={$t`Move to Folder… *=> Change the rule so that it moves the emails to a folder`} icon={MoveIcon} onClick={() => folderAction = "move"} />
      <MenuItem label={$t`Copy to Folder… *=> Change the rule so that it copies the emails to a folder`} icon={CopyToFolderIcon} onClick={() => folderAction = "copy"} />
      <MenuItem label={$t`Delete Message *=> Change the rule so that it deletes the emails`} icon={DeleteMessageIcon} onClick={onDeleteMessage} />
    </Menu>
    <DialogButton label={$t`Copy… *=> Copy the selected rule to another account`} icon={CopyIcon} classes="plain"
      disabled={!selected ? noSelection : readOnlyReason ?? false} onClick={() => { isCopying = true; }} />
    <DialogButton label={$t`Delete`} icon={DeleteIcon} classes="plain"
      disabled={!selected ? noSelection : readOnlyReason ?? false} onClick={onDelete} />
    <hbox class="separator" />
    <DialogButton label="" icon={MoveUpIcon} classes="plain"
      tooltip={$t`Move Up *=> Move the selected rule up in the list`}
      disabled={readOnlyReason ?? (!canMoveUp && $t`This rule runs first`)}
      onClick={() => onMove(-1)} />
    <DialogButton label="" icon={MoveDownIcon} classes="plain"
      tooltip={$t`Move Down *=> Move the selected rule down in the list`}
      disabled={readOnlyReason ?? (!canMoveDown && $t`This rule runs last`)}
      onClick={() => onMove(1)} />
  </hbox>
  <vbox flex class="list">
    <FastList items={rules} bind:selectedItem={selected} columns="minmax(0, 1fr) 120px">
      <svelte:fragment slot="header">
        <hbox class="column-header">{$t`Rule (applied in the order shown)`}</hbox>
        <hbox class="column-header">{$t`Actions`}</hbox>
      </svelte:fragment>
      <svelte:fragment slot="row" let:item={rule}>
        <RulesListItem {rule} on:edit={onEdit} />
      </svelte:fragment>
    </FastList>
    {#if $rules.isEmpty}
      <hbox class="empty lo-secondary">{$t`There are no rules. Click New Rule… to create one.`}</hbox>
    {/if}
  </vbox>
  <span class="description-label">{$t`Rule description (click an underlined value to edit)`}</span>
  <RuleDescriptionBox lines={descriptionLines} readOnly={!!readOnlyReason} on:edit={event => onValueClick(event.detail)} />
  {#if account.canServerFilterRules && selected}
    <hbox class="run-by">
      <span>{$t`Run by *=> Who runs the rule: this app, or the mail server`}</span>
      <Radio label={appName} name="run-by" value={false} group={selected.server} on:change={() => onRunBy(false)}
        disabled={cannotRunHere ?? false} />
      <Radio label={$t`The mail server`} name="run-by" value={true} group={selected.server} on:change={() => onRunBy(true)}
        disabled={cannotRunOnServer ?? false} />
    </hbox>
  {/if}
  {#if readOnlyReason || unknownParts.length}
    <vbox class="server-notes lo-secondary">
      {#if readOnlyReason}
        <span>{readOnlyReason}</span>
      {/if}
      {#if unknownParts.length}
        <span>{$t`Parts of this rule that ${appName} cannot show or change`}</span>
        <ul>
          {#each unknownParts as part}
            <li>{part}</li>
          {/each}
        </ul>
      {/if}
    </vbox>
  {/if}
  <hbox class="hint lo-secondary">
    <InfoIcon size={14} />
    {#if selected?.server}
      {$t`The mail server runs this rule, also while ${appName} is not running`}
    {:else}
      {$t`Rules run in ${appName} when it downloads new messages`}
    {/if}
  </hbox>
  <svelte:fragment slot="footer">
    <DialogButton label={$t`OK`} primary onClick={onOK} />
    <DialogButton label={$t`Cancel`} onClick={onClose} />
    <DialogButton label={$t`Apply *=> Save the changes and keep the dialog open`} onClick={onApply} disabled={!isChanged && $t`There are no changes to apply`} />
  </svelte:fragment>
</Dialog>
{#if isWizardOpen}
  <RulesWizard rule={editedRule} {account} on:finish={event => onWizardFinish(event.detail)} on:close={() => isWizardOpen = false} />
{/if}
{#if renaming}
  <RenameRuleDialog rule={renaming} on:close={() => { renaming = null; changed(); }} />
{/if}
{#if folderAction && selected}
  <RuleFolderDialog account={selected.account} folder={selected.toFolder}
    onChosen={onFolderChosen}
    on:close={() => folderAction = null} />
{/if}
{#if pickerItem && selected}
  <RuleValuePicker rule={selected} item={pickerItem} on:change={changed} on:close={() => pickerItem = null} />
{/if}
{#if isCopying && selected}
  <CopyRulesDialog rule={selected} on:copy={event => onCopyTo(event.detail)} on:close={() => isCopying = false} />
{/if}
{#if deleting}
  <RuleMessageBox title={$t`Rules and Alerts`} isQuestion
    message={$t`Do you want to delete the rule "${deleting.name}"?`}
    on:answer={event => onDeleteAnswer(event.detail)} />
{/if}

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { FilterRuleAction } from "../../../logic/Mail/FilterRules/FilterRuleAction";
  import { appGlobal } from "../../../logic/app";
  import { appName } from "../../../logic/build";
  import { RuleListActions } from "./RuleListActions";
  import { ruleDescriptionLines } from "./RuleDescription";
  import { RulesWorkingList } from "./RulesWorkingList";
  import { RuleWizardModel } from "./RuleWizardModel";
  import type { RuleItem } from "./RuleItems";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import DialogTabs from "../../Shared/Dialog/DialogTabs.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import Radio from "../../Shared/Form/Radio.svelte";
  import type { ComboOption } from "../../Shared/Form/ComboOption";
  import RulesListItem from "./RulesListItem.svelte";
  import RuleDescriptionBox from "./RuleDescriptionBox.svelte";
  import RulesWizard from "./RulesWizard.svelte";
  import RenameRuleDialog from "./RenameRuleDialog.svelte";
  import RuleFolderDialog from "./RuleFolderDialog.svelte";
  import RuleMessageBox from "./RuleMessageBox.svelte";
  import CopyRulesDialog from "./CopyRulesDialog.svelte";
  import RuleValuePicker from "./RuleValuePicker.svelte";
  import FastList from "../../../frontend/Shared/FastList.svelte";
  import Menu from "../../Shared/Menu/Menu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import NewIcon from "lucide-svelte/icons/list-plus";
  import EditIcon from "lucide-svelte/icons/pencil";
  import RenameIcon from "lucide-svelte/icons/text-cursor-input";
  import MoveIcon from "lucide-svelte/icons/folder-input";
  import CopyToFolderIcon from "lucide-svelte/icons/folders";
  import DeleteMessageIcon from "lucide-svelte/icons/mail-x";
  import CopyIcon from "lucide-svelte/icons/copy";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import MoveUpIcon from "lucide-svelte/icons/arrow-up";
  import MoveDownIcon from "lucide-svelte/icons/arrow-down";
  import InfoIcon from "lucide-svelte/icons/info";
  import { catchErrors } from "../../../frontend/Util/error";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let account: MailAccount;
  const dispatch = createEventDispatcher<{ close: void }>();

  const accounts = appGlobal.emailAccounts;

  function accountOptions(mailAccounts: MailAccount[]): ComboOption<MailAccount>[] {
    return mailAccounts.map(mailAccount => ({ value: mailAccount, label: `${mailAccount.inbox?.name || $t`Inbox`} [${mailAccount.emailAddress || mailAccount.name}]` }));
  }
  if (!accounts.contains(account)) {
    account = accounts.first;
  }
  const workingLists = new Map<MailAccount, RulesWorkingList>();
  let selected: FilterRuleAction | null = null;
  let isChangeMenuOpen = false;
  let changeButton: HTMLButtonElement;
  let renaming: FilterRuleAction | null = null;
  let folderAction: "move" | "copy" | null = null;
  let isWizardOpen = false;
  let editedRule: FilterRuleAction | null = null;
  let pickerItem: RuleItem | null = null;
  let isCopying = false;
  let deleting: FilterRuleAction | null = null;
  let isChanged = false;
  let version = 0;

  $: list = workingList(account);
  $: rules = list.rules;
  let shownAccount: MailAccount | null = null;
  $: if (account != shownAccount) {
    shownAccount = account;
    selected = rules.first ?? null;
  }
  $: account, catchErrors(() => refreshServerRules(account));
  $: noSelection = $t`Select a rule first`;
  $: canMoveUp = !!selected && $rules && rules.indexOf(selected) > 0;
  $: canMoveDown = !!selected && $rules && rules.indexOf(selected) >= 0 && rules.indexOf(selected) < rules.length - 1;
  $: descriptionLines = selected && version >= 0 ? ruleDescriptionLines(selected) : [];
  $: readOnlyReason = selected && version >= 0 && $account ? selected.readOnlyReason : null;
  $: unknownParts = selected?.server && version >= 0 ? selected.serverRule?.unknownParts ?? [] : [];
  $: cannotRunHere = readOnlyReason ?? (unknownParts.length ? $t`${appName} cannot run all parts of this rule` : null);
  $: cannotRunOnServer = readOnlyReason ?? (selected?.server ? null : $account.serverFilterRulesReadOnlyReason);

  function workingList(mailAccount: MailAccount): RulesWorkingList {
    let existing = workingLists.get(mailAccount);
    if (existing) {
      return existing;
    }
    let created = new RulesWorkingList(mailAccount);
    workingLists.set(mailAccount, created);
    return created;
  }

  function changed() {
    version++;
    isChanged = [...workingLists.values()].some(working => working.isChanged);
  }

  async function refreshServerRules(mailAccount: MailAccount) {
    await mailAccount.refreshServerFilterRules();
    let working = workingList(mailAccount);
    if (working.isChanged) {
      return;
    }
    working.reload();
    if (working == list && !rules.contains(selected)) {
      selected = rules.first ?? null;
    }
    changed();
  }

  function onRunBy(server: boolean) {
    selected.server = server;
    changed();
  }

  function onNew() {
    editedRule = null;
    isWizardOpen = true;
  }

  function onEdit() {
    if (!selected || readOnlyReason) {
      return;
    }
    editedRule = selected;
    isWizardOpen = true;
  }

  function onWizardFinish(rule: FilterRuleAction) {
    let target = editedRule;
    isWizardOpen = false;
    if (target) {
      RuleWizardModel.copyInto(rule, target);
    } else {
      rules.add(rule);
      selected = rule;
    }
    changed();
  }

  function onValueClick(item: RuleItem) {
    pickerItem = item;
  }

  function onCopyTo(target: MailAccount) {
    let copy = RuleListActions.copyToAccount(selected, target, workingList(target).rules);
    if (target == account) {
      selected = copy;
    }
    changed();
  }

  function onDelete() {
    deleting = selected;
  }

  function onDeleteAnswer(yes: boolean) {
    if (yes && deleting) {
      rules.remove(deleting);
      selected = rules.first ?? null;
      changed();
    }
    deleting = null;
  }

  function onMove(offset: number) {
    RuleListActions.move(rules, selected, offset);
    changed();
  }

  function onFolderChosen(folder: Folder) {
    RuleListActions.moveToFolder(selected, folder, folderAction == "copy");
    folderAction = null;
    changed();
  }

  function onDeleteMessage() {
    RuleListActions.deleteMessage(selected);
    changed();
  }

  async function onApply() {
    for (let working of workingLists.values()) {
      await working.apply();
    }
    changed();
  }

  async function onOK() {
    await onApply();
    onClose();
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .folder-row {
    flex-shrink: 0;
    align-items: center;
    gap: 12px;
    margin-block: 12px 8px;
  }
  .toolbar {
    flex-shrink: 0;
    align-items: center;
    gap: 2px;
    margin-block-end: 6px;
    margin-inline-start: -8px;
  }
  .toolbar :global(.dialog-button) {
    padding: 0 8px;
  }
  .separator {
    width: 1px;
    height: 20px;
    margin: 0 6px;
    background-color: var(--lo-divider);
  }
  .list {
    position: relative;
    min-height: 120px;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
    overflow: hidden;
  }
  /* <copied from="../Composer/SelectNamesDialog.svelte"> */
  .list :global(.fast-list .header > *) {
    padding: 4px 8px;
    border-block-end: 1px solid var(--lo-divider);
    border-inline-end: 1px solid var(--lo-divider);
    background-color: var(--lo-pane-alt-bg);
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
    white-space: nowrap;
    overflow: hidden;
    position: sticky;
    top: 0;
  }
  /* </copied> */
  .empty {
    position: absolute;
    inset: 48px 16px auto 16px;
    justify-content: center;
    text-align: center;
  }
  .description-label {
    flex-shrink: 0;
    margin-block: 10px 4px;
  }
  .run-by {
    flex-shrink: 0;
    align-items: center;
    gap: 16px;
    margin-block-start: 10px;
  }
  .server-notes {
    min-height: 0;
    overflow-y: auto;
    gap: 2px;
    margin-block-start: 8px;
    font-size: var(--lo-font-size-small);
  }
  .server-notes ul {
    margin: 0;
    padding-inline-start: 20px;
  }
  .hint {
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    margin-block-start: 10px;
    font-size: var(--lo-font-size-small);
  }
</style>
