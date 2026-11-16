<!-- Minimize, maximize and close. Not on macOS, which has its traffic lights. -->
<hbox class="buttons">
  <Button label={$t`Minimize`}
    icon={MinimizeIcon} iconSize="16px" plain iconOnly classes="minimize"
    onClick={onMinimize}
    />
  <Button label={$t`Maximize`} tooltip={canMaximize ? $t`Maximize` : $t`Restore window`}
    icon={canMaximize ? MaximizeIcon : UnmaximizeIcon}
    iconSize="12px" plain iconOnly classes="restore-window"
    onClick={onMaximizeOrRestore}
    />
  <Button label={isFirstWindow ? $t`Close entire app` : $t`Close window`}
    icon={XIcon} iconSize="16px" plain iconOnly classes="close"
    onClick={onClose}
    />
</hbox>

<script lang="ts">
  import Button from "../Shared/Button.svelte";
  import MinimizeIcon from 'lucide-svelte/icons/minus';
  import MaximizeIcon from 'lucide-svelte/icons/square';
  import UnmaximizeIcon from 'lucide-svelte/icons/copy';
  import XIcon from 'lucide-svelte/icons/x';
  import { AppWindow } from "./AppWindow";
  import { t } from "../../l10n/l10n";

  const appWindow = AppWindow.current();
  const isFirstWindow = appWindow == AppWindow.main;

  async function onMinimize() {
    await appWindow.minimize();
  }

  let canMaximize = true;
  async function onMaximizeOrRestore() {
    if (canMaximize) {
      await appWindow.maximize();
    } else {
      await appWindow.restore();
    }
    canMaximize = !canMaximize;
  }

  function onClose() {
    appWindow.close();
  }
</script>

<style>
  .buttons :global(.minimize svg) {
    margin-block-start: 8px; /* Find better icon */
  }
</style>
