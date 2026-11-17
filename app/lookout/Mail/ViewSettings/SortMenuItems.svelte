<MenuLabel label={$t`Sort by`} />
{#each arrangements as arrangement}
  <MenuItem label={arrangement.label} checkable checked={$settings.arrangeBy == arrangement.id}
    onClick={() => arrangeFolderBy(folder, arrangement.id)} />
{/each}
<MenuLabel label={$t`Sort order`} />
{#each sortOrders as order}
  <MenuItem label={order.label} checkable checked={!!$settings.reverseSort == order.reversed}
    onClick={() => changeViewSettings(folder, { reverseSort: order.reversed })} />
{/each}

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import { arrangeFields, viewSettingsStore, changeViewSettings } from "./ViewSettings";
  import { arrangeFolderBy } from "./ViewCommands";
  import { MessageGrouping } from "../3pane/MessageGrouping";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuLabel from "../../Shared/Menu/MenuLabel.svelte";
  import { t } from "../../../l10n/l10n";

  export let folder: Folder | null;

  const arrangements = arrangeFields();

  $: settings = viewSettingsStore(folder);
  $: sortOrders = MessageGrouping.sortOrders($settings.arrangeBy);
</script>
