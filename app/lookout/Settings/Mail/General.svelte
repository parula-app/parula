<OptionsPage icon={MailIcon} description={$t`Change the settings for messages you create and receive`}>
  <OptionsSection title={$t`Compose messages`}>
    <OptionsRow icon={ComposeIcon}>
      <hbox class="field-row">
        <label for="options-compose-format">{$t`Compose messages in this format`}</label>
        <ComboBox options={[ { value: "html", label: $t`HTML *=> Email format with formatted text` }, { value: "plaintext", label: $t`Plain Text` } ]}
          bind:value={$formatSetting.value} label={$t`Compose messages in this format`} width="200px" />
      </hbox>
    </OptionsRow>
    <OptionsRow icon={SpellingIcon}>
      <Checkbox label={$t`Check spelling as you type`} bind:checked={$spellcheckSetting.value} />
    </OptionsRow>
  </OptionsSection>

  <OptionsSection title={$t`${appName} panes`}>
    <OptionsRow icon={ReadingPaneIcon}>
      <hbox class="field-row">
        <label for="options-reading-pane">{$t`Reading Pane`}</label>
        <ComboBox options={[
            { value: "right", label: $t`Right *=> Reading pane on the right side` },
            { value: "bottom", label: $t`Bottom *=> Reading pane at the bottom` },
            { value: "off", label: $t`Off *=> The pane is hidden` },
          ]}
          bind:value={$readingPaneSetting.value} label={$t`Reading Pane`} width="160px" />
      </hbox>
      <Checkbox label={$t`Mark items as read when viewed in the Reading Pane`} bind:checked={isMarkingRead}
        on:change={onSaveReadAfter} />
      <hbox class="delay indented" class:disabled={!isMarkingRead}>
        <span>{$t`Wait *=> as in: Wait 5 seconds before marking item as read`}</span>
        <SpinBox label={$t`Seconds *=> Number of seconds to wait`} bind:value={delay} min={0} max={20} width="72px" disabled={!isMarkingRead}
          on:change={onSaveReadAfter} />
        <span>{$t`seconds before marking item as read *=> as in: Wait 5 seconds before marking item as read`}</span>
      </hbox>
    </OptionsRow>
    <OptionsRow icon={AccountListIcon}>
      <Checkbox label={$t`Show a separate account list, with the folders of the selected account below it`}
        bind:checked={$separateAccountListSetting.value} />
    </OptionsRow>
  </OptionsSection>

  <OptionsSection title={$t`Message arrival`}>
    <OptionsRow icon={ArrivalIcon}>
      <hbox>{$t`When new messages arrive`}</hbox>
      <Checkbox label={$t`Play a sound`} checked={$notificationsSetting.value.includes("sound")}
        on:change={event => onNotification("sound", event.detail)} />
      <Checkbox label={$t`Display a Desktop Alert`} checked={$notificationsSetting.value.includes("popup")}
        on:change={event => onNotification("popup", event.detail)} />
      <Checkbox label={$t`Only for messages from people in my contacts`} bind:checked={$onlyFromContactsSetting.value}
        disabled={!$notificationsSetting.value.length} />
    </OptionsRow>
  </OptionsSection>

  <OptionsSection title={$t`Replies and forwards`}>
    <OptionsRow icon={ReplyIcon}>
      <Checkbox label={$t`Open replies and forwards in a new window`} bind:checked={$repliesInNewWindowSetting.value} />
      <grid class="replies">
        <label for="options-reply">{$t`When replying to a message`}</label>
        <ComboBox options={[
            { value: "below", label: $t`Include original message text` },
            { value: "above", label: $t`Include original message text, reply below it` },
            { value: "none", label: $t`Do not include original message` },
          ]}
          bind:value={$quoteSetting.value} label={$t`When replying to a message`} width="320px" />
        <label for="options-forward">{$t`When forwarding a message`}</label>
        <ComboBox options={[ { value: "inline", label: $t`Include original message text` }, { value: "attachment", label: $t`Attach original message` } ]}
          bind:value={$forwardSetting.value} label={$t`When forwarding a message`} width="320px" />
      </grid>
    </OptionsRow>
  </OptionsSection>

  <OptionsSection title={$t`Categories *=> Colored labels to organize emails and other items`}>
    <OptionsRow icon={CategoriesIcon}>
      <hbox>{$t`Mark your messages with categories, to organize them`}</hbox>
      <vbox class="categories">
        {#each $availableTags.each as tag (tag.name)}
          <hbox class="category">
            <CategorySquare {tag} />
            <span class="category-name">{tag.name}</span>
            <ComboBox label={$t`Color of ${tag.name}`} options={colorOptions} value={tag.color}
              on:change={event => catchErrors(async () => { tag.color = event.detail; await saveTagsList(); })} width="160px" swatchColumns={5} />
            <DialogButton label={$t`Delete`} icon={DeleteIcon} classes="plain" onClick={() => onDeleteCategory(tag)} />
          </hbox>
        {/each}
        <hbox class="category new">
          <TextField label={$t`New category`} placeholder={$t`New category`} bind:value={newCategoryName} width="220px" />
          <ComboBox label={$t`Color of the new category`} options={colorOptions} bind:value={newCategoryColor} width="160px" swatchColumns={5} />
          <DialogButton label={$t`Add`} icon={AddIcon} disabled={!newCategoryName.trim() && $t`Please enter a name for the category`} onClick={onAddCategory} />
        </hbox>
      </vbox>
    </OptionsRow>
  </OptionsSection>
</OptionsPage>

<script lang="ts">
  import type { Tag } from "../../../logic/Abstract/Tag";
  import { availableTags, saveTagsList } from "../../../logic/Abstract/Tag";
  import { catchErrors } from "../../../frontend/Util/error";
  import type { ReadingPanePosition } from "../../Mail/3pane/3Pane.svelte";
  import { CategoryChoice } from "../../Shared/Tag/CategoryChoice";
  import { categoryColors } from "../../Shared/Tag/CategoryColors";
  import { askYesNo } from "../../Shared/Dialog/MessageBox";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import { appName } from "../../../logic/build";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import SpinBox from "../../Shared/Form/SpinBox.svelte";
  import TextField from "../../Shared/Form/TextField.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import CategorySquare from "../../Shared/Tag/CategorySquare.svelte";
  import OptionsPage from "../Shared/OptionsPage.svelte";
  import OptionsSection from "../Shared/OptionsSection.svelte";
  import OptionsRow from "../Shared/OptionsRow.svelte";
  import MailIcon from "lucide-svelte/icons/mail";
  import ComposeIcon from "lucide-svelte/icons/file-pen-line";
  import SpellingIcon from "lucide-svelte/icons/spell-check";
  import ReadingPaneIcon from "lucide-svelte/icons/panel-right";
  import AccountListIcon from "lucide-svelte/icons/list-tree";
  import ArrivalIcon from "lucide-svelte/icons/bell";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import CategoriesIcon from "lucide-svelte/icons/tags";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import AddIcon from "lucide-svelte/icons/plus";
  import { t } from "../../../l10n/l10n";

  const formatSetting = getLocalStorage<string>("mail.send.format", "html");
  const spellcheckSetting = getLocalStorage<boolean>("mail.send.spellcheck.enabled", false);
  const quoteSetting = getLocalStorage<string>("mail.send.quote", "below");
  const forwardSetting = getLocalStorage<string>("mail.send.forward", "inline");
  const repliesInNewWindowSetting = getLocalStorage<boolean>("lookout.mail.compose.repliesInNewWindow", false);
  const notificationsSetting = getLocalStorage<string[]>("notifications.mail", ["popup"]);
  const onlyFromContactsSetting = getLocalStorage<boolean>("notifications.mail.only.addressbook", true);
  const readingPaneSetting = getLocalStorage<ReadingPanePosition>("lookout.mail.readingPane", "right");
  const separateAccountListSetting = getLocalStorage<boolean>("lookout.mail.separateAccountList", true);
  const readAfterSetting = getLocalStorage<number>("mail.read.after", 0);

  let isMarkingRead = readAfterSetting.value >= 0;
  let delay = Math.max(readAfterSetting.value, 0);

  function onSaveReadAfter() {
    if (!Number.isInteger(delay) || delay < 0 || delay > 20) {
      return;
    }
    readAfterSetting.value = isMarkingRead ? delay : -1;
  }

  function onNotification(kind: string, isOn: boolean) {
    let kinds = notificationsSetting.value.filter(entry => entry != kind);
    notificationsSetting.value = isOn ? [ ...kinds, kind ] : kinds;
  }

  const colorOptions = categoryColors()
    .map(entry => ({ value: entry.color, label: entry.name, color: entry.color }));
  let newCategoryName = "";
  let newCategoryColor = colorOptions[0].value;

  async function onAddCategory() {
    await CategoryChoice.addCategory(newCategoryName.trim(), newCategoryColor);
    newCategoryName = "";
  }

  async function onDeleteCategory(tag: Tag) {
    if (!await askYesNo($t`Categories *=> Colored labels to organize emails and other items`, $t`Are you sure that you want to delete the category ${tag.name}? This removes it from the list of categories, but not from the items that have it.`)) {
      return;
    }
    availableTags.remove(tag);
    await saveTagsList();
  }
</script>

<style>
  grid.replies {
    display: grid;
    grid-template-columns: max-content minmax(200px, 320px);
    align-items: center;
    gap: 8px 12px;
  }
  .delay {
    align-items: center;
    gap: 8px;
  }
  .delay.disabled {
    color: var(--lo-fg-disabled);
  }
  .categories {
    gap: 4px;
  }
  .category {
    align-items: center;
    gap: 8px;
  }
  .category-name {
    width: 180px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .category.new {
    margin-block-start: 4px;
  }
</style>
