<hbox class="rule-action-icons">
  {#if $rule.markAsRead === true}
    <span title={$t`Mark as read`}><ReadIcon size={14} /></span>
  {:else if $rule.markAsRead === false}
    <span title={$t`Mark as unread`}><UnreadIcon size={14} /></span>
  {/if}
  {#if $rule.markAsStarred}
    <span title={$t`Flag *=> Rule action: flag the email`}><FlagIcon size={14} /></span>
  {/if}
  {#if $addTags.hasItems}
    <span title={$t`Categorize *=> Rule action: assign a category`}><CategoryIcon size={14} /></span>
  {/if}
  {#if $rule.markAsSpam === true}
    <span title={$t`Junk *=> Rule action: mark as junk`}><JunkIcon size={14} /></span>
  {/if}
  {#if $rule.deleteImmediately}
    <span title={$t`Permanently delete`}><PermanentDeleteIcon size={14} /></span>
  {:else if $rule.deleteTrash}
    <span title={$t`Delete`}><DeleteIcon size={14} /></span>
  {:else if $rule.toFolderID && $rule.copy}
    <span title={$t`Copy to folder *=> Rule action: copy the email to a folder`}><CopyIcon size={14} /></span>
  {:else if $rule.toFolderID}
    <span title={$t`Move to folder *=> Rule action: move the email to a folder`}><MoveIcon size={14} /></span>
  {/if}
</hbox>

<script lang="ts">
  import type { FilterRuleAction } from "../../../logic/Mail/FilterRules/FilterRuleAction";
  import ReadIcon from "lucide-svelte/icons/mail-open";
  import UnreadIcon from "lucide-svelte/icons/mail";
  import FlagIcon from "lucide-svelte/icons/flag";
  import CategoryIcon from "lucide-svelte/icons/tag";
  import JunkIcon from "lucide-svelte/icons/shield-x";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import PermanentDeleteIcon from "lucide-svelte/icons/circle-x";
  import CopyIcon from "lucide-svelte/icons/copy";
  import MoveIcon from "lucide-svelte/icons/folder-input";
  import { t } from "../../../l10n/l10n";

  export let rule: FilterRuleAction;

  $: addTags = rule.addTags;
</script>

<style>
  .rule-action-icons {
    align-items: center;
    gap: 6px;
    color: var(--lo-accent-text);
  }
  span {
    display: flex;
  }
</style>
