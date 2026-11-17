{#if item.picker == RulePicker.Person}
  <RuleAddressDialog person={rule.criteria.includesPerson}
    on:choose={event => apply(() => rule.criteria.includesPerson = event.detail)}
    on:close={onClose} />
{:else if item.picker == RulePicker.Words}
  <SearchTextDialog text={rule.criteria.bodyText}
    on:choose={event => apply(() => rule.criteria.bodyText = event.detail)}
    on:close={onClose} />
{:else if item.picker == RulePicker.Category}
  <ColorCategoriesDialog isChooseMode chosen={item.isAction ? rule.addTags : rule.criteria.tags}
    on:choose={event => apply(() => (item.isAction ? rule.addTags : rule.criteria.tags).replaceAll(event.detail))}
    on:close={onClose} />
{:else if item.picker == RulePicker.Size}
  <MessageSizeDialog sizeMin={rule.criteria.sizeMin} sizeMax={rule.criteria.sizeMax}
    on:choose={event => apply(() => {
      rule.criteria.sizeMin = event.detail.sizeMin;
      rule.criteria.sizeMax = event.detail.sizeMax;
    })}
    on:close={onClose} />
{:else if item.picker == RulePicker.Date}
  <ReceivedDateDialog sentDateMin={rule.criteria.sentDateMin} sentDateMax={rule.criteria.sentDateMax}
    on:choose={event => apply(() => {
      rule.criteria.sentDateMin = event.detail.sentDateMin;
      rule.criteria.sentDateMax = event.detail.sentDateMax;
    })}
    on:close={onClose} />
{:else if item.picker == RulePicker.Folder}
  <RuleFolderDialog account={rule.account}
    folder={item.isAction ? rule.toFolder : rule.criteria.folder}
    onChosen={folder => apply(() => setFolder(folder))}
    on:close={onClose} />
{/if}

<script lang="ts">
  import type { FilterRuleAction } from "../../../logic/Mail/FilterRules/FilterRuleAction";
  import type { Folder } from "../../../logic/Mail/Folder";
  import { RulePicker, type RuleItem } from "./RuleItems";
  import RuleAddressDialog from "./RuleAddressDialog.svelte";
  import SearchTextDialog from "./SearchTextDialog.svelte";
  import ColorCategoriesDialog from "../../Shared/Tag/ColorCategoriesDialog.svelte";
  import MessageSizeDialog from "./MessageSizeDialog.svelte";
  import ReceivedDateDialog from "./ReceivedDateDialog.svelte";
  import RuleFolderDialog from "./RuleFolderDialog.svelte";
  import { createEventDispatcher } from "svelte";

  export let rule: FilterRuleAction;
  export let item: RuleItem;
  const dispatch = createEventDispatcher<{ change: void, close: void }>();

  let changed = false;

  function apply(write: () => void) {
    write();
    changed = true;
  }

  function setFolder(folder: Folder) {
    if (!item.isAction) {
      rule.criteria.folder = folder;
      return;
    }
    rule.toFolder = folder;
    rule.copy = item.id == "copy" ? true : null;
  }

  function onClose() {
    if (changed) {
      dispatch("change");
    }
    dispatch("close");
  }
</script>
