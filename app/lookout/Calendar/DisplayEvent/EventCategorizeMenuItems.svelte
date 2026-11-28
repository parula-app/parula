<!-- <copied from="../../Mail/Message/CategorizeMenuItems.svelte"> for one event -->
<MenuItem label={$t`Clear All Categories`} icon={ClearIcon}
  disabled={$eventTags.isEmpty && $t`The event has no categories`}
  onClick={clearTags} />
<MenuDivider />
{#each $tags.each as tag (tag)}
  <MenuItem label={tag.name} selected={$eventTags.contains(tag)}
    onClick={() => toggleTag(tag)}>
    <CategorySquare slot="icon" {tag} state={$eventTags.contains(tag) ? TagState.All : TagState.None} />
  </MenuItem>
{:else}
  <MenuLabel label={$t`No categories yet`} />
{/each}
<MenuDivider />
<MenuItem label={$t`All Categories…`} icon={AllCategoriesIcon}
  onClick={onAllCategories} />
<!-- </copied> -->

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { availableTags, type Tag } from "../../../logic/Abstract/Tag";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuLabel from "../../Shared/Menu/MenuLabel.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import CategorySquare, { TagState } from "../../Shared/Tag/CategorySquare.svelte";
  import ClearIcon from "lucide-svelte/icons/eraser";
  import AllCategoriesIcon from "lucide-svelte/icons/tags";
  import { t } from "../../../l10n/l10n";

  export let event: Event;
  export let onAllCategories: () => void;

  const tags = availableTags;
  $: eventTags = event.tags;

  async function toggleTag(tag: Tag) {
    if (event.tags.contains(tag)) {
      await event.removeTag(tag);
    } else {
      await event.addTag(tag);
    }
  }

  async function clearTags() {
    for (let tag of event.tags.contents) {
      await event.removeTag(tag);
    }
  }
</script>
