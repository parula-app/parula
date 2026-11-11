<vbox class="tags-rule-actions" flex>
  <h2>{$t`Rules *=> Criteria after which emails should be sorted`}</h2>
  <hbox class="subtitle">{$t`Perform routine actions once messages arrive`}</hbox>

  <Splitter name="settings-mail-folders" initialRightRatio={4}>
    <FastList items={rules} bind:selectedItem={rule} slot="left">
      <hbox class="header font-small" slot="header">
        {$t`Rules *=> Criteria after which emails should be sorted`}
        <!--{" (" + $rules.length + ")"}-->
        <hbox flex />
        <hbox class="buttons">
          <RoundButton
            label={$t`Add new rule`}
            icon={AddIcon}
            iconSize="10px"
            padding="3px"
            classes="small"
            onClick={onAdd}
            />
        </hbox>
      </hbox>
      <svelte:fragment slot="row" let:item={ruleRow}>
        <RulesListItem rule={ruleRow} />
      </svelte:fragment>
    </FastList>
    <vbox class="right" slot="right">
      {#if rule}
        <Scroll>
          <vbox class="rule-details">
            <HeaderGroupBox>
              <hbox slot="header">{rule.name}</hbox>
              <hbox slot="buttons-top-right" class="buttons">
                <RoundButton
                  label={$t`Delete rule`}
                  icon={DeleteIcon}
                  onClick={onDelete}
                  disabled={readOnlyReason}
                  />
              </hbox>
              <vbox class="content">
                <grid class="name-grid">
                  <label for="name">{$t`Rule name`}</label>
                  <input type="text" bind:value={rule.name} name="name" autofocus inert={!!readOnlyReason} />

                  <label for="when">{$t`When`}</label>
                  <select bind:value={rule.when} inert={!!readOnlyReason}>
                    <option value={FilterMoment.IncomingBeforeSpam}>{$t`New mail arrives`}</option>
                    <option value={FilterMoment.IncomingAfterSpam}>{$t`New mail arrives, after spam filtering`}</option>
                    <option value={FilterMoment.Outgoing}>{$t`I send mail`}</option>
                  </select>

                  {#if account.canServerFilterRules}
                    <label>{$t`Run by *=> Who runs the rule: this app, or the mail server`}</label>
                    <hbox class="run-by">
                      <label class="radio" title={cannotRunHere || null}>
                        <input type="radio" value={false} bind:group={rule.server} disabled={!!cannotRunHere} />
                        {appName}
                      </label>
                      <label class="radio" title={cannotRunOnServer || null}>
                        <input type="radio" value={true} bind:group={rule.server} disabled={!!cannotRunOnServer} />
                        {$t`The mail server`}
                      </label>
                    </hbox>
                  {/if}
                </grid>
                {#if readOnlyReason || notice || unknownParts.length}
                  <vbox class="server-notes">
                    {#if readOnlyReason}
                      <hbox>{readOnlyReason}</hbox>
                    {:else if notice}
                      <hbox>{notice}</hbox>
                    {/if}
                    {#if unknownParts.length}
                      <hbox>{$t`Parts of this rule that ${appName} cannot show or change`}</hbox>
                      <ul>
                        {#each unknownParts as part}
                          <li>{part}</li>
                        {/each}
                      </ul>
                    {/if}
                  </vbox>
                {/if}
              </vbox>
            </HeaderGroupBox>

            <HeaderGroupBox>
              <hbox slot="header">{$t`Criteria`}</hbox>
              <vbox class="content" inert={!!readOnlyReason}>
                <SearchCriteria search={rule.criteria} showAccount={false} />
              </vbox>
            </HeaderGroupBox>

            <HeaderGroupBox>
              <hbox slot="header">{$t`Action`}</hbox>
              <vbox class="content" inert={!!readOnlyReason}>
                <RuleActions {rule} />
              </vbox>
            </HeaderGroupBox>
          </vbox>
        </Scroll>
        <hbox class="buttons bottom">
          <Button
            icon={SaveIcon}
            label={$t`Save`}
            onClick={onSave}
            disabled={readOnlyReason}
          />
        </hbox>
      {/if}
    </vbox>
  </Splitter>
</vbox>

<script lang="ts">
  import { MailAccount } from "../../../logic/Mail/MailAccount";
  import { FilterRuleAction } from "../../../logic/Mail/FilterRules/FilterRuleAction";
  import { FilterMoment } from "../../../logic/Mail/FilterRules/FilterMoments";
  import SearchCriteria from "../../Mail/Search/SearchCriteria.svelte";
  import RuleActions from "../../Mail/Search/RuleActions.svelte";
  import RulesListItem from "./RulesListItem.svelte";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import FastList from "../../Shared/FastList.svelte";
  import Splitter from "../../Shared/Splitter.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Button from "../../Shared/Button.svelte";
  import AddIcon from "lucide-svelte/icons/plus";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import SaveIcon from "lucide-svelte/icons/save";
  import { appName } from "../../../logic/build";
  import { catchErrors } from "../../Util/error";
  import { t } from "../../../l10n/l10n";

  export let account: MailAccount;

  $: rules = account.filterRuleActions;
  /** selected rule */
  let rule: FilterRuleAction;

  $: account, defaultSelect()
  function defaultSelect() {
    rule = account.filterRuleActions.first;
  }

  $: account, catchErrors(() => account.refreshServerFilterRules());
  $: readOnlyReason = $account && $rule ? rule.readOnlyReason : null;
  $: unknownParts = $rule?.server ? rule.serverRule?.unknownParts ?? [] : [];
  $: notice = $rule?.server ? $account.serverFilterRulesNotice : null;
  $: cannotRunHere = readOnlyReason ?? (unknownParts.length ? $t`${appName} cannot run all parts of this rule` : null);
  $: cannotRunOnServer = readOnlyReason ?? ($rule?.server ? null : $account.serverFilterRulesReadOnlyReason);

  function onAdd() {
    rule = new FilterRuleAction(account);
    rule.name = "-";
  }

  async function onDelete() {
    if (rule.name && !confirm($t`Do you want to delete the rule '${rule.name}'?`)) {
      return;
    }

    account.filterRuleActions.remove(rule);
    await account.save();
    rule = null;
    await account.saveServerFilterRules();
  }

  async function onSave() {
    if (!rule.account.filterRuleActions.contains(rule)) {
      rule.account.filterRuleActions.add(rule);
    }
    await rule.account.save();
    await rule.account.saveServerFilterRules();
  }
</script>

<style>
  h2 {
    margin-block-start: -8px;
    margin-block-end: 8px;
  }
  .subtitle {
    margin-block-end: 24px;
    margin-inline-start: 1px;
  }
  .header {
  }
  .rule-details {
    margin-block-start: -24px;
    margin-inline-start: 24px;
    margin-inline-end: 16px;
  }
  .name-grid {
    grid-template-columns: max-content auto;
    gap: 8px 24px;
  }
  .run-by {
    gap: 24px;
  }
  .server-notes {
    gap: 4px;
    margin-block-start: 16px;
  }
  .server-notes ul {
    margin: 0;
    padding-inline-start: 20px;
  }
  .radio {
    align-items: center;
  }
  .buttons {
    justify-content: end;
    align-items: center;
  }
  .buttons.bottom {
    margin-block-start: 16px;
  }
  .buttons.bottom :global(button) {
    margin-inline-start: 8px;
  }
</style>
