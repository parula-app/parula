{#if wizardRule}
  <RulesWizard rule={wizardRule} on:finish={event => catchErrors(() => onWizardFinish(event.detail))} on:close={onClose} />
{:else if createdRule}
  <RuleMessageBox title={$t`Success *=> The rule has been created`} message={$t`The rule "${createdRule.name}" has been created`}
    on:answer={onClose} />
{:else}
  <Dialog title={$t`Create Rule`} on:close={onClose} width="540px">
    <GroupBox label={$t`When I get email with all of the selected conditions`} classes="rule-box">
      <grid class="fields">
        <Checkbox label={$t`From ${quickRule.senderName}`} bind:checked={quickRule.fromSender}
          disabled={!quickRule.sender && $t`The sender is not in your address book`} classes="check from" />
        <Checkbox label={$t`Subject or body contains`} bind:checked={quickRule.hasText} classes="check" />
        <input type="text" class="value lo-text-field" bind:value={quickRule.text}
          aria-label={$t`Subject or body contains`}
          on:input={() => quickRule.hasText = !!quickRule.text} />
      </grid>
    </GroupBox>
    <GroupBox label={$t`Do the following`} classes="rule-box">
      <grid class="fields">
        <Checkbox label={$t`Move the item to folder`} bind:checked={quickRule.moveToFolder} classes="check" />
        <hbox class="folder-row">
          <input type="text" class="value folder lo-text-field" readonly value={quickRule.folder?.name ?? ""}
            aria-label={$t`Folder`} />
          <DialogButton label={$t`Select Folder…`} onClick={() => { isChoosingFolder = true; }} />
        </hbox>
        <Checkbox label={$t`Mark it as read`} bind:checked={quickRule.markAsRead} classes="check wide" />
        <Checkbox label={$t`Flag message for follow up`} bind:checked={quickRule.flag} classes="check wide" />
      </grid>
    </GroupBox>
    <svelte:fragment slot="footer">
      <DialogButton label={$t`OK`} primary onClick={onOK} disabled={quickRule.disabledReason ?? false} />
      <DialogButton label={$t`Cancel`} onClick={onClose} />
      <DialogButton label={$t`Advanced Options…`} onClick={onAdvanced}
        tooltip={$t`Choose more conditions and actions in the Rules Wizard`} />
    </svelte:fragment>
  </Dialog>
  {#if isChoosingFolder}
    <RuleFolderDialog account={quickRule.account} folder={quickRule.folder}
      onChosen={onFolderChosen}
      on:close={() => isChoosingFolder = false} />
  {/if}
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { FilterRuleAction } from "../../../logic/Mail/FilterRules/FilterRuleAction";
  import { UserError } from "../../../logic/util/util";
  import { QuickRule } from "./QuickRule";
  import { catchErrors } from "../../../frontend/Util/error";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import GroupBox from "../../Shared/Form/GroupBox.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import RulesWizard from "./RulesWizard.svelte";
  import RuleFolderDialog from "./RuleFolderDialog.svelte";
  import RuleMessageBox from "./RuleMessageBox.svelte";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;
  const dispatch = createEventDispatcher<{ close: void }>();

  let quickRule = new QuickRule(message);
  let isChoosingFolder = false;
  let wizardRule: FilterRuleAction | null = null;
  let createdRule: FilterRuleAction | null = null;

  function onFolderChosen(folder: Folder) {
    quickRule.folder = folder;
    quickRule.moveToFolder = true;
    isChoosingFolder = false;
  }

  async function onOK() {
    if (quickRule.disabledReason) {
      throw new UserError(quickRule.disabledReason);
    }
    createdRule = await quickRule.save();
  }

  function onAdvanced() {
    wizardRule = quickRule.createRule();
  }

  async function onWizardFinish(rule: FilterRuleAction) {
    // <copied from="../../../frontend/Settings/Mail/Rules.svelte" onSave()>
    rule.account.filterRuleActions.add(rule);
    await rule.account.save();
    // </copied>
    onClose();
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  :global(.rule-box) {
    margin-bottom: 12px;
  }
  .fields {
    grid-template-columns: max-content 1fr;
    align-items: center;
    gap: 8px 12px;
  }
  .fields :global(.check) {
    white-space: nowrap;
  }
  .fields :global(.check.from),
  .fields :global(.check.wide) {
    grid-column: 1 / -1;
  }
  .value {
    min-width: 0;
  }
  .folder-row {
    align-items: center;
    gap: 8px;
  }
  .folder-row .value {
    flex: 1 1 0;
  }
  .value.folder {
    background-color: var(--lo-pane-alt-bg);
  }
</style>
