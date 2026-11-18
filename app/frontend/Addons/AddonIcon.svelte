{#if url}
  <img src={url} alt="" class="addon-icon" style:width={size} style:height={size} draggable="false" />
{:else}
  <FallbackIcon {size} />
{/if}

<script lang="ts">
  import type { Addon } from "../../logic/Addons/Addon";
  import type { URLString } from "../../logic/util/util";
  import FallbackIcon from "lucide-svelte/icons/puzzle";
  import { catchErrors, minorError } from "../Util/error";
  import { onDestroy } from "svelte";

  export let addon: Addon;
  /** Path of an SVG file in the addon package. Default: the icon of the addon */
  export let path: string | null = null;
  /** CSS size, e.g. "24px" */
  export let size = "16px";

  let url: URLString | null = null;
  let isDestroyed = false;

  $: iconPath = path ?? $addon.manifest.icon;
  $: iconKey = $addon.id + " " + $addon.manifest.version + " " + iconPath;
  $: iconKey, catchErrors(loadIcon, minorError);

  async function loadIcon() {
    let loadingKey = iconKey;
    revoke();
    if (!iconPath) {
      return;
    }
    let newURL = await addon.iconURL(iconPath);
    if (loadingKey != iconKey || isDestroyed) {
      URL.revokeObjectURL(newURL);
      return;
    }
    url = newURL;
  }

  function revoke() {
    if (url) {
      URL.revokeObjectURL(url);
    }
    url = null;
  }

  onDestroy(() => {
    isDestroyed = true;
    revoke();
  });
</script>

<style>
  .addon-icon {
    object-fit: contain;
  }
</style>
