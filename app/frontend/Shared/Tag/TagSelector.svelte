<vbox>
  <hbox class="tag-list">
    {#each $tags.each as tag}
      <TagBubble {tag}
        selected={$partialTags?.contains(tag) ? null : $selectedTags?.contains(tag)}
        on:click={() => catchErrors(() => onSelectToggle(tag))}
        >
        <slot name="tag-button" slot="tag-button" {tag} />
      </TagBubble>
    {/each}

    {#if canAdd && !isAdding}
      <vbox class="buttons">
        <RoundButton
          label={$t`Add`}
          onClick={onAddNew}
          icon={AddIcon}
          classes="small plain"
          iconSize="12px"
          padding="2px"
          />
      </vbox>
    {/if}
  </hbox>
  {#if isAdding}
    <TagAdd
      on:add={(event) => catchErrors(() => onAdd(event.detail))}
      on:cancel={onAddCancel}
      />
  {/if}
</vbox>

<script lang="ts">
  import { saveTagsList, type Tag, type TaggableObject } from "../../../logic/Abstract/Tag";
  import TagBubble from "./TagBubble.svelte";
  import TagAdd from "./TagAdd.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import AddIcon from "lucide-svelte/icons/plus";
  import { catchErrors } from "../../Util/error";
  import type { SetColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";
  import { createEventDispatcher } from "svelte";
  const dispatch = createEventDispatcher<{ select: Tag, unselect: Tag }>();

  export let tags: SetColl<Tag>;
  export let selectedTags: SetColl<Tag> = undefined;
  /** The tags that only some of the objects have, when several objects are being tagged */
  export let partialTags: SetColl<Tag> = undefined;
  export let object: TaggableObject | undefined = undefined;
  export let canAdd = true;

  async function onSelectToggle(tag: Tag) {
    if (!selectedTags) {
      return;
    }
    if (selectedTags.contains(tag)) {
      if (object) {
        await object.removeTag(tag);
      } else {
        selectedTags.remove(tag);
      }
      dispatch("unselect", tag);
    } else {
      if (object) {
        await object.addTag(tag);
      } else {
        selectedTags.add(tag);
      }
      dispatch("select", tag);
    }
  }

  let isAdding = false;
  function onAddNew() {
    isAdding = true;
  }
  function onAddCancel() {
    isAdding = false;
  }
  async function onAdd(tag: Tag) {
    tags.add(tag);
    await saveTagsList();
    await onSelectToggle(tag);
    isAdding = false;
  }
</script>

<style>
  .tag-list {
    flex-wrap: wrap;
  }
  .buttons {
    margin-inline-start: 6px;
    justify-content: center;
  }
</style>
