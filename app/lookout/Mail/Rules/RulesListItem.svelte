<hbox class="cell name" class:broken={isBroken} on:dblclick={() => dispatch("edit")}>
  <span class="text">{$rule.name}</span>
  {#if $rule.when == FilterMoment.Outgoing}
    <span class="suffix lo-secondary">{$t`(outgoing) *=> The rule applies to emails that you send`}</span>
  {/if}
  {#if isBroken}
    <span class="suffix" title={$t`The target folder does not exist anymore`}>{$t`(Error) *=> The rule has an error`}</span>
  {/if}
</hbox>
<hbox class="cell actions" on:dblclick={() => dispatch("edit")}>
  <RuleActionIcons {rule} />
</hbox>

<script lang="ts">
  import type { FilterRuleAction } from "../../../logic/Mail/FilterRules/FilterRuleAction";
  import { FilterMoment } from "../../../logic/Mail/FilterRules/FilterMoments";
  import RuleActionIcons from "./RuleActionIcons.svelte";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let rule: FilterRuleAction;

  const dispatch = createEventDispatcher<{ edit: void }>();

  $: isBroken = $rule && ((!!rule.toFolderID && !rule.toFolder) || (!!rule.criteria.folderID && !rule.criteria.folder));
</script>

<style>
  .cell {
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 8px !important;
    white-space: nowrap;
    cursor: default;
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .suffix {
    flex-shrink: 0;
  }
  .broken {
    color: var(--lo-danger);
  }
</style>
