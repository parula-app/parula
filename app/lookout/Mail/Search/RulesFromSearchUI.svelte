<RulesWizard {rule} on:finish={event => catchErrors(() => onFinish(event.detail))} on:close={onClose} />

<script lang="ts">
  import { SearchEMail } from "../../../logic/Mail/Store/SearchEMail";
  import { FilterRuleAction } from "../../../logic/Mail/FilterRules/FilterRuleAction";
  import { selectedAccount, selectedFolder } from "../../../frontend/Mail/Selected";
  import { isRealFolder, isRealAccount } from "./MailSearch";
  import { catchErrors } from "../../../frontend/Util/error";
  import RulesWizard from "../Rules/RulesWizard.svelte";
  import { createEventDispatcher } from "svelte";

  export let search: SearchEMail;

  const dispatch = createEventDispatcher<{ close: void }>();
  const account = search.account ??
    (isRealFolder($selectedFolder) ? $selectedFolder.account : isRealAccount($selectedAccount) ? $selectedAccount : null);
  const criteria = new SearchEMail();
  criteria.copyFrom(search);
  const rule = new FilterRuleAction(account, criteria);

  async function onFinish(rule: FilterRuleAction) {
    // <copied from="../../../frontend/Mail/Search/RulesFromSearchUI.svelte">
    rule.account.filterRuleActions.add(rule);
    await rule.account.save();
    // </copied>
    onClose();
  }

  function onClose() {
    dispatch("close");
  }
</script>
