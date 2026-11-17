<vbox flex class="rule-action">
  <Checkbox bind:checked={rule.markAsRead} allowIndetermined={true}
    label={rule.markAsRead === false ? $t`Mark as unread` : $t`Mark as read`}
    classes="read {rule.markAsRead == false ?  "is-unread" : ""}">
    <CircleIcon size="16px" slot="icon" />
  </Checkbox>
  <Checkbox bind:checked={rule.markAsStarred} allowFalse={false} allowIndetermined={true}
    on:change={updateStar}
    label={$t`Add star`}
    classes="star {rule.markAsStarred ? "starred" : ""}">
    <StarIcon size="16px" slot="icon" />
  </Checkbox>
  <Checkbox bind:checked={hasAddTag} allowFalse={false} allowIndetermined={true}
    on:change={updateTag}
    label={$t`Tags`}>
    <TagIcon size="16px" slot="icon" />
  </Checkbox>
  {#if hasAddTag}
    <vbox class="tags">
      <TagSelector tags={availableTags} selectedTags={rule.addTags} />
    </vbox>
  {/if}
  <Checkbox bind:checked={hasFolder} allowFalse={false} allowIndetermined={true}
    on:change={updateFolder}
    label={rule.copy ? $t`Copy to folder ${rule.toFolder?.name}` : $t`Move to folder ${rule.toFolder?.name}`}>
    <FolderIcon size="16px" slot="icon" />
  </Checkbox>
  {#if hasFolder}
    <vbox flex class="listbox">
      <FolderList folders={rule.account.rootFolders} bind:selectedFolder={rule.toFolder} bind:selectedFolders />
    </vbox>
    <vbox class="indented">
      <Checkbox bind:checked={rule.copy} allowIndetermined={false}
        label={$t`Copy`}>
        <CopyIcon size="16px" slot="icon" />
      </Checkbox>
    </vbox>
  {/if}
  <Checkbox bind:checked={rule.markAsSpam} allowIndetermined={true}
    label={rule.markAsSpam === false ? $t`Mark as not spam` : $t`Mark as spam`}
    classes="star">
    <SpamIcon size="16px" slot="icon" />
  </Checkbox>
  <Checkbox bind:checked={rule.deleteTrash} allowFalse={false} allowIndetermined={true}
    on:change={updateDelete}
    label={$t`Delete`}
    classes="delete">
    <TrashIcon size="16px" slot="icon" />
  </Checkbox>
</vbox>

<script lang="ts">
  import { FilterRuleAction } from "../../../logic/Mail/FilterRules/FilterRuleAction";
  import { Folder } from "../../../logic/Mail/Folder";
  import { availableTags } from "../../../logic/Abstract/Tag";
  import FolderList from "../LeftPane/FolderList.svelte";
  import TagSelector from "../../Shared/Tag/TagSelector.svelte";
  import Checkbox from "../../Shared/Checkbox.svelte";
  import StarIcon from "lucide-svelte/icons/star";
  import CircleIcon from "lucide-svelte/icons/circle";
  import FolderIcon from "lucide-svelte/icons/folder";
  import CopyIcon from "lucide-svelte/icons/copy";
  import TagIcon from "lucide-svelte/icons/tag";
  import SpamIcon from "lucide-svelte/icons/shield-x";
  import TrashIcon from "lucide-svelte/icons/trash-2";
  import { ArrayColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  /** The actions
   * in/out */
  export let rule: FilterRuleAction;

  let hasAddTag: boolean | null = null;
  let hasFolder: boolean | null = null;
  let shownRule: FilterRuleAction = null;
  $: $rule, load()
  function load() {
    if (rule == shownRule) {
      /** hasAddTag and hasFolder have no property in the rule.
       * Deriving them again would reset them while the user is still picking. */
      return;
    }
    shownRule = rule;
    hasAddTag = rule.addTags.hasItems ? true : undefined;
    hasFolder = rule.toFolder ? true : undefined;
  }
  let selectedFolders: ArrayColl<Folder>; // unused

  function updateTag() {
    if (!hasAddTag) {
      rule.addTags.clear();
    } else {
      removeDelete();
    }
  }
  function updateFolder() {
    if (!hasFolder) {
      rule.toFolder = null;
    } else {
      removeDelete();
    }
  }
  function updateDelete() {
    if (rule.deleteTrash === true || rule.deleteImmediately === true) {
      rule.markAsSpam = rule.markAsSpam ? true : null;
      rule.markAsStarred = null;
      rule.copy = null;
      rule.toFolder = null;
      rule.addTags.clear();
      hasFolder = undefined;
      hasAddTag = undefined;
    }
  }
  function updateStar() {
    removeDelete();
  }
  function removeDelete() {
    rule.deleteTrash = null;
    rule.deleteImmediately = null;
    rule.markAsSpam = false;
  }
</script>

<style>
  .rule-action :global(.star.starred svg) {
    fill: orange;
  }
  .rule-action :global(.read.is-unread svg) {
    fill: green;
  }
  .listbox {
    margin-block-start: 4px;
    margin-block-end: 16px;
    min-height: 300px;
  }
  .tags {
    margin-block-start: 8px;
    margin-block-end: 16px;
    margin-inline-start: 8px;
  }
  .indented {
    margin-inline-start: 28px;
  }
  /*
  grid.size {
    margin: 4px 0px 8px 32px;
    grid-template-columns: max-content max-content max-content;
  }
  input {
    text-align: center;
    width: unset;
    margin: 0px 8px;
  }
  input[disabled] {
    background-color: unset;
    border-bottom: unset;
  }
  */
</style>
