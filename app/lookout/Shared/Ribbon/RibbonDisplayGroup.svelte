<RibbonGroup label={$t`Ribbon *=> Ribbon group with settings for how the ribbon is shown`}>
  <RibbonToggleButton label={$t`Simplified Ribbon`} shortLabel={$t`Simplified *=> Short for: Simplified Ribbon, show the commands in one row`} icon={SimplifiedIcon}
    tooltip={$t`Show the commands in one row`}
    selected={$layout.value == "simplified"}
    onClick={() => { $layout.value = $layout.value == "simplified" ? "classic" : "simplified"; }} />
  <RibbonToggleButton label={$t`Show Tabs Only`} icon={TabsOnlyIcon} size="small"
    tooltip={$t`Show only the tab names. Click a tab to see its commands.`}
    shortCutInfo={$t`Ctrl+F1 *=> Keyboard shortcut`}
    selected={!!$collapsed.value}
    onClick={() => { $collapsed.value = !$collapsed.value; }} />
  <RibbonToggleButton label={$t`Quick Access Toolbar`} icon={QuickAccessIcon} size="small"
    tooltip={$t`Show the Quick Access Toolbar`}
    selected={$qatShown.value}
    onClick={() => { $qatShown.value = !$qatShown.value; }} />
  <RibbonButton label={$t`Customize Ribbon…`} icon={CustomizeIcon} size="small"
    tooltip={$t`Choose which tabs and groups the ribbon shows`}
    onClick={() => { $isCustomizing = true; }} />
</RibbonGroup>

<script lang="ts">
  import type { RibbonLayout } from "./RibbonGroup";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import RibbonGroup from "./RibbonGroup.svelte";
  import RibbonButton from "./RibbonButton.svelte";
  import RibbonToggleButton from "./RibbonToggleButton.svelte";
  import SimplifiedIcon from "lucide-svelte/icons/panel-top";
  import TabsOnlyIcon from "lucide-svelte/icons/panel-top-close";
  import QuickAccessIcon from "lucide-svelte/icons/app-window";
  import CustomizeIcon from "lucide-svelte/icons/settings-2";
  import { getContext } from "svelte";
  import type { Writable } from "svelte/store";
  import { t } from "../../../l10n/l10n";

  const isCustomizing = getContext<Writable<boolean>>("ribbonIsCustomizing");
  const layout = getLocalStorage<RibbonLayout>("lookout.ribbon.layout", "classic");
  const collapsed = getLocalStorage<boolean>("lookout.ribbon.collapsed", false);
  const qatShown = getLocalStorage<boolean>("lookout.quickaction.shown", false);
</script>
