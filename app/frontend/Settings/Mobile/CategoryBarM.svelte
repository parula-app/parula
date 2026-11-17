<hbox class="buttons">
  <AppBarM>
    <!-- left -->
    {#if category && parentCategory}
      <hbox class="back">
        <Button
          icon={parentCategory.icon ?? settingsMustangApp.icon}
          iconSize="24px"
          iconOnly
          label={parentCategory.name}
          onClick={goToParentCategory}
          plain
          />
      </hbox>
    {:else if category}
      <hbox class="back">
        <Button
          icon={settingsMustangApp.icon}
          iconSize="24px"
          iconOnly
          label={$t`All settings`}
          onClick={goToAllSettings}
          plain
          />
      </hbox>
    {:else}
      <hbox class="empty" />
    {/if}

    <!-- left middle -->
    <hbox class="empty" />

    <AppMenuButton />

    <!-- right middle -->
    <hbox class="empty" />

    <!-- right -->
    <hbox class="empty" />
  </AppBarM>
</hbox>

<script lang="ts">
  import { settingsCategories, type SettingsCategory } from "../SettingsCategory";
  import { settingsMustangApp } from "../Window/SettingsMustangApp";
  import { goTo } from "../../AppsBar/selectedApp";
  import { URLPart } from "../../../logic/util/blob";
  import AppBarM from "../../AppsBar/AppBarM.svelte";
  import AppMenuButton from "../../AppsBar/AppMenuM/AppMenuButton.svelte";
  import Button from "../../Shared/Button.svelte";
  import { t } from "../../../l10n/l10n";

  export let category: SettingsCategory | null;

  $: parentCategory = category && settingsCategories.find(cat => cat.subCategories.contains(category));

  function goToParentCategory() {
    goTo(URLPart`/settings/category/${parentCategory.id}`, { category: parentCategory });
  }
  function goToAllSettings() {
    goTo(`/settings`, {});
  }
</script>
