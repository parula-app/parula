<Dialog title={$t`Rename`} on:close={onClose} width="400px"
  okLabel={$t`OK`}
  okDisabled={!name.trim() && $t`Please enter a name`}
  onOK={onOK}>
  <vbox class="content">
    <label for="rename-rule-name">{$t`New name of rule`}</label>
    <input id="rename-rule-name" class="lo-text-field" type="text" bind:value={name} autofocus />
  </vbox>
</Dialog>

<script lang="ts">
  import type { FilterRuleAction } from "../../../logic/Mail/FilterRules/FilterRuleAction";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let rule: FilterRuleAction;
  const dispatch = createEventDispatcher<{ close: void }>();

  let name = rule.name;

  function onOK() {
    rule.name = name.trim();
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .content {
    gap: 6px;
    padding-block: 4px;
  }
</style>
