<Dialog title={$t`Color Categories`} okLabel={$t`OK`} onOK={onSubmit} on:close={onClose} width="560px">
  <vbox class="color-categories">
    <span class="intro">
      {#if isChooseMode}
        {$t`To choose categories, use the checkboxes next to each category. To edit a category, select the category name and use the commands to the right.`}
      {:else}
        {$t`To assign Color Categories to the currently selected items, use the checkboxes next to each category. To edit a category, select the category name and use the commands to the right.`}
      {/if}
    </span>
    <hbox class="main">
      <vbox flex class="list">
        <ListView items={$tags} columns={[{ label: $t`Name` }]} bind:selected
          label={$t`Categories *=> Colored labels to organize emails and other items`} height="240px" let:item>
          <hbox class="category">
            <Checkbox checked={stateOf(item, choiceVersion) == TagState.All}
              indeterminate={stateOf(item, choiceVersion) == TagState.Some}
              tooltip={item.name}
              on:change={() => toggle(item)} />
            <CategorySquare tag={item} />
            <span class="name">{item.name}</span>
          </hbox>
          <span slot="empty">{$t`There are no categories yet. Click New… to add one.`}</span>
        </ListView>
      </vbox>
      <vbox class="commands">
        <DialogButton label={$t`New… *=> Create a new category`} onClick={() => { isAdding = true; }} />
        <DialogButton label={$t`Delete`} disabled={!selected && $t`Select a category first`} onClick={onDelete} />
        <vbox class="color-field">
          <span>{$t`Color *=> Color of the category`}</span>
          <ComboBox label={$t`Color *=> Color of the category`} options={colorOptions(selected)} value={selected?.color ?? null}
            disabled={!selected && $t`Select a category first`}
            on:change={event => catchErrors(() => onColor(event.detail))} width="100%" swatchColumns={5} />
        </vbox>
      </vbox>
    </hbox>
  </vbox>
</Dialog>
{#if isAdding}
  <TagAdd on:add={event => onAdded(event.detail)} on:close={() => isAdding = false} />
{/if}

<script lang="ts" context="module">
  import type { Tag, TaggableObject } from "../../../logic/Abstract/Tag";
  import { derived, writable } from "svelte/store";

  export const openColorCategories = writable<TaggableObject[] | null>(null);
</script>

<script lang="ts">
  import { availableTags, saveTagsList } from "../../../logic/Abstract/Tag";
  import { askYesNo } from "../Dialog/MessageBox";
  import { catchErrors } from "../../../frontend/Util/error";
  import { CategoryChoice } from "./CategoryChoice";
  import { categoryColors } from "./CategoryColors";
  import TagAdd from "./TagAdd.svelte";
  import CategorySquare, { TagState } from "./CategorySquare.svelte";
  import Dialog from "../Dialog/Dialog.svelte";
  import DialogButton from "../Dialog/DialogButton.svelte";
  import ListView from "../Form/ListView.svelte";
  import Checkbox from "../Form/Checkbox.svelte";
  import ComboBox from "../Form/ComboBox.svelte";
  import type { ComboOption } from "../Form/ComboOption";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let items: TaggableObject[] = [];
  export let isChooseMode = false;
  export let chosen: Iterable<Tag> = [];
  const dispatch = createEventDispatcher<{ choose: Tag[], close: void }>();

  $: tags = derived($availableTags.contents, () => availableTags.contents);
  let choice = new CategoryChoice(items, chosen);
  let choiceVersion = 0;
  let selected: Tag = null;
  let isAdding = false;

  function stateOf(tag: Tag, _version: number): TagState {
    return choice.stateOf(tag);
  }

  function toggle(tag: Tag) {
    choice.toggle(tag);
    choiceVersion++;
  }

  function colorOptions(tag: Tag): ComboOption<string>[] {
    let options = categoryColors().map(entry => ({ value: entry.color, label: entry.name, color: entry.color }));
    if (tag?.color && !options.some(option => option.value.toLowerCase() == tag.color.toLowerCase())) {
      options.push({ value: tag.color, label: $t`Custom`, color: tag.color });
    }
    return options;
  }

  async function onColor(color: string) {
    selected.color = color;
    await saveTagsList();
    selected = selected;
  }

  function onAdded(tag: Tag) {
    selected = tag;
    choice.toggle(tag);
    choiceVersion++;
  }

  async function onDelete() {
    if (!await askYesNo($t`Color Categories`, $t`Are you sure that you want to delete the category ${selected.name}? This removes it from the list of categories, but not from the items that have it.`)) {
      return;
    }
    availableTags.remove(selected);
    await saveTagsList();
    selected = null;
  }

  async function onSubmit() {
    if (isChooseMode) {
      dispatch("choose", choice.chosenTags);
    } else {
      await choice.applyToItems();
    }
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .color-categories {
    gap: 12px;
  }
  .intro {
    line-height: 1.4;
  }
  .main {
    gap: 12px;
  }
  .list {
    min-width: 0;
  }
  .category {
    align-items: center;
    gap: 8px;
  }
  .category :global(.lo-checkbox) {
    min-height: 0;
  }
  .name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .commands {
    flex: 0 0 140px;
    gap: 8px;
  }
  .commands :global(button) {
    width: 100%;
  }
  .color-field {
    gap: 4px;
    margin-block-start: 8px;
  }
</style>
