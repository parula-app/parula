// #if [MOBILE]
<!-- Android and iOS: The login page is in a native WebView over our app, see `openLoginWebView()` -->
// #else
<Browser
  title={$t`Authentication`}
  url={startURL}
  autofill={autoFillLoginPage(dialog.oAuth2.account)}
  on:page-change={onPageChange}
  on:close={onClose}
  sessionID={dialog.oAuth2.account?.webSessionID}
  {withURLbar}
  >
  <hbox class="account" slot="urlbar-left">
    {dialog.oAuth2.account?.name}
  </hbox>
</Browser>
// #endif

<script lang="ts">
  import type { OAuth2Tab } from "../../../logic/Auth/UI/OAuth2Tab";
  import { OAuth2Embed } from "../../../logic/Auth/UI/OAuth2Embed";
  // #if [MOBILE]
  import { loginWebViewPlugin } from "../../../logic/util/os-integration";
  // #else
  import Browser from "../Browser.svelte";
  // #endif
  import { autoFillLoginPage } from "../../../logic/Auth/LoginAutoFill";
  import { UserCancelled, UserError, type URLString } from "../../../logic/util/util";
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
    // #if [MOBILE]
    catchErrors(closeLoginWebView);
    // #endif
  });

  function onInactive() {
    dialog.failed(new UserCancelled($t`Login dialog was closed due to inaction`));
  }

  // #if [MOBILE]
  $: startURL && catchErrors(openLoginWebView);

  /** Android and iOS: In an `<iframe>`, the login page of another site can't keep its cookies,
   * and we don't see where it goes. So it's in a native WebView, which is jailed, and has
   * the cookies and storage of this account, like `<webview partition>` on desktop. */
  async function openLoginWebView() {
    let account = dialog.oAuth2.account;
    try {
      await loginWebViewPlugin.addListener("navigate", page => catchErrors(() => dialog.urlChanged(page.url)));
      await loginWebViewPlugin.addListener("close", onClose);
      await loginWebViewPlugin.open({
        url: startURL,
        profile: account.webSessionID,
        doneURL: dialog.oAuth2.authDoneURL,
        script: autoFillLoginPage(account),
      });
    } catch (ex) {
      dialog.failed(ex.code == "UNAVAILABLE"
        ? new UserError($t`Please update Android System WebView to log in`)
        : ex);
    }
  }

  async function closeLoginWebView() {
    await loginWebViewPlugin.removeAllListeners();
    await loginWebViewPlugin.close();
  }
  // #endif
</script>

<style>
</style>
