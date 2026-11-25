<RibbonButtonBase
  label={$t`Add to Topic`}
  icon={TopicIcon}
  tooltip={$t`Add to a topic, or remove from it`}
  {size}
  {disabled}
  hasMenu
  pressed={popupOpen}
  onClick={() => { popupOpen = !popupOpen; }}
  bind:buttonEl
  />
<!-- Not a `Menu`, because it would take the focus from the search field -->
<Popup bind:popupOpen popupAnchor={buttonEl} placement="bottom-start" boundaryElSel="body">
  <TopicPicker {target} on:close={() => popupOpen = false} />
</Popup>

<script lang="ts">
  import type { LinkTarget } from "../../logic/Topic/Topic";
  import TopicPicker from "../../frontend/Topic/Picker/TopicPicker.svelte";
  import Popup from "../../frontend/Shared/Popup.svelte";
  import RibbonButtonBase from "../Shared/Ribbon/RibbonButtonBase.svelte";
  import type { RibbonItemSize } from "../Shared/Ribbon/RibbonGroup";
  import TopicIcon from "lucide-svelte/icons/notebook-tabs";
  import { t } from "../../l10n/l10n";

  /** The email, contact etc. to add to a topic */
  export let target: LinkTarget | null;
  export let size: RibbonItemSize = "small";
  export let disabled: boolean | string = false;

  let buttonEl: HTMLButtonElement;
  let popupOpen = false;
</script>
