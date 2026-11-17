{#if withLabel}
  <MenuLabel label={$t`Arrange by`} />
{/if}
{#each arrangements as arrangement}
  <MenuItem label={arrangement.label} checked={$settings.arrangeBy == arrangement.id}
    onClick={() => arrangeFolderBy(folder, arrangement.id)} />
{/each}
{#if withSortOrder}
  <MenuLabel label={$t`Sort order`} />
  {#each sortOrders as order}
    <MenuItem label={order.label} checked={!!$settings.reverseSort == order.reversed}
      onClick={() => changeViewSettings(folder, { reverseSort: order.reversed })} />
  {/each}
{/if}
<MenuDivider />
{#if !withSortOrder}
  <MenuItem label={$t`Reverse Sort`} checked={$settings.reverseSort} checkable
    onClick={() => changeViewSettings(folder, { reverseSort: !$settings.reverseSort })} />
{/if}
<MenuItem label={$t`Show in Groups`} checked={$settings.showInGroups} checkable
  onClick={() => changeViewSettings(folder, { showInGroups: !$settings.showInGroups })} />
<MenuDivider />
<MenuItem label={$t`View Settings…`} onClick={() => { $openViewSettings = { folder }; }} />

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import { arrangeFields, viewSettingsStore, changeViewSettings } from "./ViewSettings";
  import { arrangeFolderBy } from "./ViewCommands";
  import { openViewSettings } from "./ViewSettingsDialog.svelte";
  import { MessageGrouping } from "../3pane/MessageGrouping";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuLabel from "../../Shared/Menu/MenuLabel.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import { t } from "../../../l10n/l10n";

  export let folder: Folder | null;
  export let withLabel = false;
  export let withSortOrder = false;

  $: settings = viewSettingsStore(folder);
  $: sortOrders = MessageGrouping.sortOrders($settings.arrangeBy);

  const arrangements = arrangeFields();
</script>
