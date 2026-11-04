<MenuItem label={$t`Clear All Categories`} icon={ClearIcon}
  disabled={!hasAnyTag && $t`The selected messages have no categories`}
  onClick={() => MessageActions.clearTags(messages)} />
<MenuDivider />
{#each $tags.each as tag (tag)}
  {@const state = tagState(messages, tag)}
  <MenuItem label={tag.name} selected={state == TagState.All}
    onClick={() => MessageActions.toggleTag(messages, tag)}>
    <CategorySquare slot="icon" {tag} {state} />
  </MenuItem>
{:else}
  <MenuLabel label={$t`No categories yet`} />
{/each}
<MenuDivider />
<MenuItem label={$t`All Categories…`} icon={AllCategoriesIcon}
  onClick={() => { $openColorCategories = messages; }} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { availableTags, type Tag } from "../../../logic/Abstract/Tag";
  import { MessageActions } from "../MessageActions";
  import { openColorCategories } from "../../Shared/Tag/ColorCategoriesDialog.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuLabel from "../../Shared/Menu/MenuLabel.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import ClearIcon from "lucide-svelte/icons/eraser";
  import AllCategoriesIcon from "lucide-svelte/icons/tags";
  import CategorySquare, { TagState } from "../../Shared/Tag/CategorySquare.svelte";
  import { t } from "../../../l10n/l10n";

  export let messages: EMail[];

  const tags = availableTags;
  $: hasAnyTag = messages.some(message => message.tags.hasItems);

  function tagState(messages: EMail[], tag: Tag): TagState {
    let count = messages.filter(message => message.tags.contains(tag)).length;
    if (count == 0) {
      return TagState.None;
    }
    return count == messages.length ? TagState.All : TagState.Some;
  }
</script>
