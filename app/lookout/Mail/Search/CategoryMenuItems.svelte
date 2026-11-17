{#each $tags.each as tag (tag)}
  <MenuItem label={tag.name} checkable checked={selected.includes(tag)} {keepOpen} onClick={() => toggle(tag)}>
    <CategorySquare slot="icon" {tag} state={selected.includes(tag) ? TagState.All : TagState.None} />
  </MenuItem>
{:else}
  <MenuLabel label={$t`No categories yet`} />
{/each}

<script lang="ts">
  import { availableTags, type Tag } from "../../../logic/Abstract/Tag";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuLabel from "../../Shared/Menu/MenuLabel.svelte";
  import CategorySquare, { TagState } from "../../Shared/Tag/CategorySquare.svelte";
  import { t } from "../../../l10n/l10n";
  import { createEventDispatcher } from "svelte";

  export let selected: Tag[];
  export let keepOpen = false;

  const dispatch = createEventDispatcher<{ select: Tag, unselect: Tag }>();
  const tags = availableTags;

  function toggle(tag: Tag) {
    if (selected.includes(tag)) {
      selected = selected.filter(existing => existing != tag);
      dispatch("unselect", tag);
    } else {
      selected = [...selected, tag];
      dispatch("select", tag);
    }
  }
</script>
