<Header
  title={$t`Single sign-on`}
  subtitle={$t`Log in with your team's identity provider`}
  />

// #if [!WEBMAIL && !MOBILE]
<vbox flex class="browser">
  <webview bind:this={webviewE} src={startURL ?? "about:blank"} {partition} />
</vbox>
// #else
<vbox class="waiting">
  <Spinner size="64px" />
  <hbox class="text">{$t`Waiting for you to complete the login in your browser`}</hbox>
</vbox>
// #endif

{#if error}
  <ErrorMessageInline ex={error} />
{/if}

<ButtonsBottom
  canContinue={false}
  canCancel={true}
  onCancel={onCancel}
  />

<script lang="ts">
  // #if [MOBILE]
  import { Browser } from "@capacitor/browser";
  import { App } from "@capacitor/app";
  // #else
  import { appGlobal } from "../../../logic/app";
  // #endif
  import type { WireSession } from "../../../logic/Chat/Wire/WireSession";
  import type { Account } from "../../../logic/Abstract/Account";
  import { OAuth2Embed } from "../../../logic/Auth/UI/OAuth2Embed";
  import ButtonsBottom from "../Shared/ButtonsBottom.svelte";
  import Header from "../Shared/Header.svelte";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import Spinner from "../../Shared/Spinner.svelte";
  import { catchErrors } from "../../Util/error";
  import type { URLString } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";
  import { onDestroy, onMount } from "svelte";

  /**
   * Shows the team's identity provider login page, and waits for it to send the
   * browser back to our own `wire…://` URL, which carries the session cookie.
   *
   * On the desktop that page lives in a sandboxed <webview> of ours, and we
   * watch where it navigates. On mobile it is the system browser, and the
   * verdict comes back as a deep link into the app.
   */

  /** in/out */
  export let session: WireSession;
  /** The team's login code `wire-<uuid>` */
  export let code: string;
  /** Only for the login window: its cookie jar and its title */
  export let account: Account | null = null;
  export let onContinue = () => undefined;
  export let onCancelled = () => undefined;

  let ui: OAuth2Embed;
  let startURL: URLString | null = null;
  let error: Error | null = null;
  let webviewE: HTMLIFrameElement = null;
  let watching = false;
  let deepLinkListener: { remove: () => Promise<void> } | null = null;
  /** Not `persist:`: the identity provider's own cookies are none of our business */
  let partition = "wire-sso-" + (account?.id ?? "setup");

  onMount(() => catchErrors(async () => {
    ui = new OAuth2Embed(session.sso);
    session.sso.account = account;
    session.sso.ui = ui;
    ui.subscribe(() => {
      if (!startURL && ui.startURL) {
        startURL = ui.startURL;
        catchErrors(openLoginPage, showError);
      }
    });
    await session.loginWithSSO(code);
    await closeLoginPage();
    onContinue();
  }, showError));

  onDestroy(() => {
    session.sso.abort();
    closeLoginPage()
      .catch(console.error);
  });

  /** On mobile, the login page is a tab in the system browser, and the verdict
   * comes back as a deep link into our app. On the desktop it is our own
   * <webview>, which is showing `startURL` already. */
  async function openLoginPage() {
    // #if [MOBILE]
    deepLinkListener = await App.addListener("appUrlOpen",
      ({ url }) => catchErrors(() => urlChanged(url), showError));
    await Browser.open({ url: startURL });
    // #endif
  }

  /** Watches where the <webview> goes, from before it is showing anything.
   * The login ends at a URL that no browser can load, so we have to catch it
   * before the navigation, not after it: `will-redirect` is the event for the
   * server-side redirect that ends the login. */
  $: webviewE && catchErrors(watchLoginPage, showError);
  async function watchLoginPage() {
    // #if [!MOBILE]
    if (watching) {
      return;
    }
    watching = true;
    let webContentsID = (webviewE as any).getWebContentsId();
    for (let event of ["will-navigate", "will-redirect", "did-start-navigation"]) {
      await appGlobal.remoteApp.addEventListenerWebContents(webContentsID, event,
        (url: URLString) => catchErrors(() => urlChanged(url), showError));
    }
    // #endif
  }

  async function closeLoginPage() {
    // #if [MOBILE]
    await deepLinkListener?.remove();
    deepLinkListener = null;
    await Browser.close();
    // #endif
  }

  /** Where the login page went. Ends the login, once that is our own URL. */
  async function urlChanged(url: URLString) {
    await ui.urlChanged(url);
  }

  function onCancel() {
    session.sso.abort();
    onCancelled();
  }

  function showError(ex: Error) {
    error = ex;
  }
</script>

<style>
  .browser {
    min-height: 24em;
  }
  webview {
    flex: 1 0 0;
  }
  .waiting {
    align-items: center;
    justify-content: center;
    margin-block: 32px;
  }
  .waiting .text {
    margin-block-start: 16px;
  }
</style>
