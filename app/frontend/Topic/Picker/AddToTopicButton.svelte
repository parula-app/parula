<hbox class="add-to-topic" bind:this={anchorEl}>
  <Button plain
    icon={TopicIcon}
    {iconSize}
    iconOnly
    label={$t`Add to topic`}
    onClick={() => { popupOpen = !popupOpen; }}
    />
</hbox>
<Popup bind:popupOpen popupAnchor={anchorEl} {placement} boundaryElSel="body">
  <TopicPicker {target} on:close={() => popupOpen = false} />
</Popup>

<script lang="ts">
  import type { LinkTarget } from "../../../logic/Topic/Topic";
  import TopicPicker from "./TopicPicker.svelte";
  import Popup from "../../Shared/Popup.svelte";
  import Button from "../../Shared/Button.svelte";
  import TopicIcon from "lucide-svelte/icons/notebook-tabs";
  import type { Placement } from "@popperjs/core";
  import { t } from "../../../l10n/l10n";

  /** The email, contact etc. to add to a topic */
  export let target: LinkTarget;
  export let iconSize = "16px";
  export let placement: Placement = "bottom-end";

  let anchorEl: HTMLElement;
  let popupOpen = false;
</script>
