<vbox class="open-source">
  <span>
    <T msg={$t`You can find the source code of ${appName} core at # under an #`}>
      <a href="https://github.com/mustang-im/mustang" target="_blank">GitHub</a>
      <a href="https://raw.githubusercontent.com/mustang-im/mustang/master/LICENSE" target="_blank" slot="2">{$t`Open-Source license`}</a>
    </T>
  </span>
  <span class="lo-secondary">{$t`${appName} is built using the following Open-Source components. We sincerely thank those authors and contributors.`}</span>
  <iframe src={attributionURL} title={$t`Open-Source components`} sandbox="" bind:this={iframeEl} />
</vbox>

<script lang="ts">
  import attributionURL from "../../../public/attribution.txt.gz?url";
  import { appName } from "../../../logic/build";
  import { fetchGzip } from "../../../frontend/Util/util";
  import { catchErrors } from "../../../frontend/Util/error";
  import T from "../../../l10n/T.svelte";
  import { onMount } from "svelte";
  import { t } from "../../../l10n/l10n";

  let iframeEl: HTMLIFrameElement;

  // <copied from="../../../frontend/Settings/About/OpenSource.svelte">
  onMount(() => catchErrors(async () => {
    iframeEl.src = await fetchGzip(iframeEl.src);
  }));
  // </copied>
</script>

<style>
  .open-source {
    gap: 8px;
  }
  a {
    color: var(--lo-accent-text);
  }
  iframe {
    height: 220px;
    margin-block-start: 4px;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-bg);
    color-scheme: light dark;
  }
</style>
