<Dialog title={$t`Copy rules to`} okLabel={$t`OK`} onOK={onOK} on:close={onClose} width="460px"
  okDisabled={RuleListActions.cannotCopyTo(rule, target)}>
  <hbox class="copy-row">
    <span>{$t`Folder`}</span>
    <ComboBox label={$t`Folder`} options={accountOptions($accounts.contents)} bind:value={target} width="100%" />
  </hbox>
</Dialog>

<script lang="ts">
  import type { FilterRuleAction } from "../../../logic/Mail/FilterRules/FilterRuleAction";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { appGlobal } from "../../../logic/app";
  import { RuleListActions } from "./RuleListActions";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import type { ComboOption } from "../../Shared/Form/ComboOption";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let rule: FilterRuleAction;
  const dispatch = createEventDispatcher<{ copy: MailAccount, close: void }>();

  const accounts = appGlobal.emailAccounts;
  let target: MailAccount = rule.account;

  function accountOptions(mailAccounts: MailAccount[]): ComboOption<MailAccount>[] {
    return mailAccounts.map(account => ({
      value: account,
      label: `${account.inbox?.name || $t`Inbox`} [${account.emailAddress || account.name}]`,
      disabled: !!RuleListActions.cannotCopyTo(rule, account),
    }));
  }

  function onOK() {
    dispatch("copy", target);
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .copy-row {
    align-items: center;
    gap: 12px;
    padding-block: 4px;
  }
  select {
    flex: 1 1 0;
    min-width: 0;
  }
</style>
