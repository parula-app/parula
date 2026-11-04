<Splitter name="settings-categories" initialRightRatio={4}>
  <SettingsCategoriesPane {categories} slot="left" />
  <vbox flex class="page-pane" slot="right">
    <Scroll>
      <hbox class="settings-title-bar">
        <hbox flex class="spacer" />
        <hbox class="buttons">
          <RoundButton
            label={$t`Close settings`}
            icon={CloseIcon}
            iconSize="16px"
            padding="6px"
            onClick={onClose}
            />
        </hbox>
      </hbox>
      <vbox flex class="right-page">
        <MainContent category={$selectedCategory} />
      </vbox>
    </Scroll>
  </vbox>
</Splitter>

<script lang="ts">
  import { settingsCategories } from "../SettingsCategory";
  import { globalSearchTerm, mustangApps, openApp } from "../../AppsBar/selectedApp";
  import { selectedCategory } from "./selected";
  import { openSettingsCategory } from "./CategoriesUtils";
  import { mailMustangApp } from "../../Mail/MailMustangApp";
  import SettingsCategoriesPane from "./CategoriesPane.svelte";
  import MainContent from "./MainContent.svelte";
  import Splitter from "../../Shared/Splitter.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import CloseIcon from "lucide-svelte/icons/x";
  import { t } from "../../../l10n/l10n";

  let categories = settingsCategories.filterObservable(cat => !cat.forApp || mustangApps.includes(cat.forApp));

  $: onSearch($globalSearchTerm)
  function onSearch(searchTerm: string) {
    for (let cat of categories) {
      if (cat.searchMatchesDirect(searchTerm)) {
        openSettingsCategory(cat);
        return;
      }
      for (let subCat of cat.subCategories) {
        if (subCat.searchMatchesDirect(searchTerm)) {
          openSettingsCategory(subCat);
          return;
        }
      }
    }
  }

  function onClose() {
    openApp($selectedCategory?.forApp ?? mailMustangApp, {});
  }
</script>

<style>
  .page-pane {
    background-color: var(--pane-bg);
    margin: var(--pane-margin);
    border-radius: var(--pane-radius);
    box-shadow: var(--pane-shadow, none);
  }
  .right-page {
    margin: 0px 32px 32px 32px;
  }
  .settings-title-bar {
    margin: 16px 16px 0px 16px;
  }
  .right-page :global(input) {
    font-size: 16px;
  }
</style>
