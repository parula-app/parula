<Browser
  title={$t`Authentication`}
  url={startURL}
  autofill={autoFillLoginPage(dialog.oAuth2.account)}
  stopAtURL={startURL && dialog.oAuth2.authDoneURL}
  on:page-change={onPageChange}
  on:close={onClose}
  sessionID={dialog.oAuth2.account?.webSessionID}
  {withURLbar}
  >
  <hbox class="account" slot="urlbar-left">
    {dialog.oAuth2.account?.name}
  </hbox>
</Browser>

<script lang="ts">
  import type { OAuth2Tab } from "../../../logic/Auth/UI/OAuth2Tab";
  import { OAuth2Embed } from "../../../logic/Auth/UI/OAuth2Embed";
  import Browser from "../Browser.svelte";
  import { autoFillLoginPage } from "../../../logic/Auth/LoginAutoFill";
  import { UserCancelled, type URLString } from "../../../logic/util/util";
  import { catchErrors } from "../../Util/error";
  import { onMount, onDestroy } from "svelte";
  import { t } from "../../../l10n/l10n";
  import { k1MinuteMS } from "../../../logic/util/date";

  export let dialog: OAuth2Tab | OAuth2Embed;
  export let withURLbar = true;

  let startURL: URLString;

  async function onPageChange(event: CustomEvent<URLString>) {
    let url = event.detail;
    await dialog.urlChanged(url);
  }

  function onClose() {
    dialog.failed(new UserCancelled($t`Login dialog was closed`));
  }

  let inactivityTimeout: NodeJS.Timeout;
  let unsubscribe: () => void;

  onMount(() => catchErrors(async () => {
    unsubscribe = dialog.subscribe(() => {
      if (!startURL && dialog.startURL) {
        startURL = dialog.startURL;
      }
    });
    inactivityTimeout = setTimeout(() => catchErrors(onInactive), 15 * k1MinuteMS);
  }));

  onDestroy(() => {
    clearTimeout(inactivityTimeout);
    unsubscribe?.();
  });

  function onInactive() {
    dialog.failed(new UserCancelled($t`Login dialog was closed due to inaction`));
  }
</script>

<style>
</style>
