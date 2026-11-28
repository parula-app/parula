{#if rule}
  <vbox class="create-rule">
    <hbox class="account font-small">
      <label for="rule-account-name">{$t`Runs in account`}</label>
      <hbox id="rule-account-name">{rule.account.name}</hbox>
    </hbox>
    <input type="text" bind:value={rule.name} placeholder={$t`Name of the rule`} class="font-normal" />

    <RuleActions {rule} />

    <hbox class="buttons">
      <Button
        icon={SaveIcon}
        label={$t`Create rule`}
        onClick={onSave}
      />
    </hbox>
  </vbox>
{/if}

<script lang="ts">
  import type { SearchEMail } from "../../../logic/Mail/Store/SearchEMail";
  import { selectedAccount } from "../Selected";
  import Button from "../../Shared/Button.svelte";
  import SaveIcon from "lucide-svelte/icons/save";
  import { createEventDispatcher, onMount } from 'svelte';
  import { t } from "../../../l10n/l10n";
  import RuleActions from "./RuleActions.svelte";
  import { catchErrors } from "../../Util/error";
  import { FilterRuleAction, LocalFilterRule } from "../../../logic/Mail/FilterRules/FilterRuleAction";
  const dispatchEvent = createEventDispatcher();

  /** in */
  export let search: SearchEMail;

  let rule: FilterRuleAction;

  onMount(() => catchErrors(onCreate));
  async function onCreate() {
    rule = new LocalFilterRule($selectedAccount, search);
  }

  async function onSave() {
    rule.account.filterRuleActions.add(rule);
    await rule.account.save();
    dispatchEvent("close");
  }
</script>

<style>
  .account {
    opacity: 80%;
  }
  label {
    margin-inline-end: 8px;
  }
  input {
    margin: 12px;
    padding: 2px 4px;
  }
  .buttons {
    margin: 12px;
    justify-content: end;
  }
</style>
