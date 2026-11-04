{#each displayModes as mode}
  <MenuItem label={mode.label} tooltip={mode.tooltip}
    checked={isCurrent(mode.id, $contentRendering.value)}
    onClick={() => { $contentRendering.value = mode.id; }} />
{/each}

<script lang="ts">
  import { DisplayMode } from "../../../frontend/Mail/Message/MessageBody.svelte";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import { t } from "../../../l10n/l10n";

  const contentRendering = getLocalStorage<string>("mail.contentRendering", "html");

  const displayModes = [
    { id: DisplayMode.HTML, label: $t`Display as HTML`, tooltip: $t`Show the message as the sender formatted it` },
    { id: DisplayMode.Plaintext, label: $t`Display as Plain Text`, tooltip: $t`Show only the text of the message` },
    { id: DisplayMode.Source, label: $t`View Message Source`, tooltip: $t`Show the on-the-wire format of the message` },
  ];

  function isCurrent(mode: string, current: string): boolean {
    return mode == current || mode == DisplayMode.HTML && current == DisplayMode.HTMLWithExternal;
  }
</script>
