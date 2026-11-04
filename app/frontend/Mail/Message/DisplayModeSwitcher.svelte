<IslandSwitcher border={false}>
  <Button
    label={$t`Thread`}
    icon={ThreadIcon}
    iconOnly
    iconSize="16px"
    onClick={() => switchTo(DisplayMode.Thread)}
    selected={mode == DisplayMode.Thread}
    />
  <Button
    label={$t`Formatted`}
    icon={HTMLIcon}
    iconOnly
    iconSize="16px"
    onClick={() => switchTo(DisplayMode.HTML)}
    selected={mode == DisplayMode.HTML}
    />
  <Button
    label={$t`With external content (allows sender to track you)`}
    icon={WithExternalIcon}
    iconOnly
    iconSize="16px"
    onClick={() => switchTo(DisplayMode.HTMLWithExternal)}
    selected={mode == DisplayMode.HTMLWithExternal}
    />
  <Button
    label={$t`Plaintext`}
    icon={PlaintextIcon}
    iconOnly
    iconSize="16px"
    onClick={() => switchTo(DisplayMode.Plaintext)}
    selected={mode == DisplayMode.Plaintext}
    />
  {#if mode == DisplayMode.Source}
    <Button
      label={$t`Source`}
      icon={SourceIcon}
      iconOnly
      iconSize="16px"
      onClick={() => switchTo(DisplayMode.Source)}
      selected={mode == DisplayMode.Source}
      />
  {/if}
</IslandSwitcher>

<script lang="ts">
  import { getLocalStorage } from "../../Util/LocalStorage";
  import { selectedMessage } from "../Selected";
  import { DisplayMode } from "./MessageBody.svelte";
  import IslandSwitcher from "../../Shared/IslandSwitcher.svelte";
  import Button from "../../Shared/Button.svelte";
  import ThreadIcon from "lucide-svelte/icons/message-square-text";
  import HTMLIcon from "lucide-svelte/icons/mail";
  import WithExternalIcon from "lucide-svelte/icons/image";
  import PlaintextIcon from "lucide-svelte/icons/type";
  import SourceIcon from "lucide-svelte/icons/code-xml";
  import { catchErrors } from "../../Util/error";
  import { t } from "../../../l10n/l10n";

  export let mode: DisplayMode = DisplayMode.HTML;

  let modeSetting = getLocalStorage("mail.contentRendering", "html");
  $: $selectedMessage && catchErrors(onMessageChanged);
  function onMessageChanged() {
    if (modeSetting.value == DisplayMode.HTMLWithExternal) {
      modeSetting.value = DisplayMode.HTML;
    }
  }
  // After onMessageChanged(), so that it reads the reset setting
  // <copied to="MessageBody.svelte">
  $: mode = $modeSetting.value == DisplayMode.HTML && $selectedMessage?.loadExternalImagesFromSender() ? DisplayMode.HTMLWithExternal : $modeSetting.value as DisplayMode;
  // </copied>

  function switchTo(newMode: DisplayMode) {
    mode = newMode;
    modeSetting.value = newMode;
    if (newMode == DisplayMode.HTML || newMode == DisplayMode.HTMLWithExternal) {
      $selectedMessage?.setLoadExternalImagesFromSender(newMode == DisplayMode.HTMLWithExternal);
    }
  }
</script>
