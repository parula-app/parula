// #if [!WEBMAIL && !MOBILE]
<webview bind:this={webviewE} src={url ?? blobURL} {title} class:hidden {partition} />
// #else
<iframe bind:this={webviewE} src={url ?? blobURL} {title} {sandbox} class:hidden />
// #endif
// #if [!WEBMAIL]
<!-- No Svelte if-block between the conditional compile lines: The plugin takes it as its own condition. The popup shows only on `show()` anyways. -->
<OpenLinkPopup bind:this={openLinkPopup} popupAnchor={linkAnchor} />
// #endif
// #if [MOBILE]
<svelte:window on:message={event => catchErrors(() => onTapInPage(event))} />
// #endif

<!--
{#if contextMenuItems && contextMenuItems.hasItems}
  <Menu opened={true} position="bottom" placement="end" on:close={() => contextMenuItems = null}>
    {#each contextMenuItems.each as menuItem}
      <Menu.Item
        on:click={() => catchErrors(() =>menuItem.action)}
        title={menuItem.label}
        icon={menuItem.icon}>
        {menuItem.label}
      </Menu.Item>
    {/each}
  </Menu>
{/if}
-->

<script lang="ts">
  // #if [!WEBMAIL]
  import { buildContextMenu, MenuItem, type ContextInfo } from "./ContextMenu";
  import { newElectronKeyboardEvent, onKeyOnMessage } from "../Mail/Message/MessageKeyboard";
  import { appGlobal } from "../../logic/app";
  import OpenLinkPopup, { askBeforeOpening } from "./OpenLinkPopup.svelte";
  import type { VirtualElement } from "@popperjs/core";
  // import { Menu } from "@svelteuidev/core";
  // #endif
  import { stringToBlobURL } from "../Util/util";
  import type { URLString } from "../../logic/util/util";
  import { minorError, catchErrors, showError } from "../Util/error";
  import type { ArrayColl } from "svelte-collections";
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { openExternalURL } from "../../logic/util/os-integration";
  import { removeTrackingURL } from "../../logic/util/netUtil";
  // #if [MOBILE]
  import { sanitize } from "../../../lib/util/sanitizeDatatypes";
  import linkScriptURL from "./linkScript.js?url&no-inline"; // a file, so that the CSP can allow just this one script
  // #endif
  const dispatch = createEventDispatcher();

  /**
   * Displays untrusted HTML in a sandboxed iframe which does not allow any JavaScript.
   */

  /** The HTML to display.
   * DANGER Attention: The HTML should already be sanitized using `sanitizeHTML()`
   * Alternative to `url` - set only one of them. */
  export let html: string | null = null;
  /** Insert this into the `<head>` section of the HTML, before display.
   * Optional */
  export let headHTML = "";
  /** The webpage to show.
   * Alternative to `html` - set only one of them. */
  export let url: string | null = null;
  /** Tooltip when hovering */
  export let title: string;
  /** Size the <WebView> to the size of the content */
  export let autoSize = false;
  export let hidden = false;
  /** The cookie storage. For `<webview partition="persist:...">` */
  export let sessionID: string | null = null;

  /**
   * Which HTTP servers may be called automatically during the HTML load,
   * e.g. for images, stylesheets etc.?
   * true (default) = `*` any HTTP server on any domain
   * false = `none` = No outgoing calls at all
   * `https://proxy.example.com` = Only allow calls to "https://proxy.example.com/*"
   *
   * This does *not* limit user clicks on links like `<a href="https://...">`.
   */
  export let allowServerCalls: boolean | string = true;

  /** When the user clicks on a link, show where it goes, and let them
   * open it in the browser or copy it.
   * For untrusted content like mails.
   * false (default) = Open links in the browser at once */
  export let askBeforeOpeningLinks = false;

  $: partition = sessionID ? "persist:" + sessionID : undefined;

  /** Jail untrusted `html`, e.g. a mail: No scripts, and an opaque origin to block access of app.
   * `allow-popups` keeps the `target="_blank"` links working that `sanitizeHTML()` creates.
   * Android: The WebView has no second window, so Chromium opens such a link in the top frame
   * instead, and Capacitor then gives it to the system browser. That needs a top navigation.
   * Mobile: Scripts only for our `html`, whose CSP allows only `linkScript`, see `setURL()`.
   * Only a page that a web server gave us is not jailed, e.g. a web app or the payment page:
   * That page gets the origin of its server. A `blob:` URL would get *ours*. */
  let jail = "allow-popups allow-popups-to-escape-sandbox";
  // #if [MOBILE]
  jail += " allow-top-navigation-by-user-activation";
  // #endif
  $: sandbox = url?.startsWith("https:") ? undefined : jail + (linkScript && !url ? " allow-scripts" : "");

  /** Mobile: We don't see the taps in the jailed `<iframe>`. So if we should ask before opening
   * links, the page gets this script, which tells us about each tap, see `onTapInPage()`.
   * The page still has an opaque origin, so the script can't reach our app.
   * Absolute URL, because the page has a `blob:` URL. */
  let linkScript = "";
  // #if [MOBILE]
  if (askBeforeOpeningLinks) {
    linkScript = new URL(linkScriptURL, location.href).href;
  }
  // #endif

  onMount(() =>{
    if (autoSize) {
      observeMaxWidth();
    }
  });

  let blobURL: URLString;
  $: html, catchErrors(setURL);
  async function setURL() {
    if (url) {
      return;
    }
    if (blobURL) {
      URL.revokeObjectURL(blobURL);
    }
    blobURL = "";
    const autoSizeCSS = `<style>
      body {
        min-height: 0px !important;
        min-width: 100px !important;
        height: fit-content !important;
        width: fit-content !important;
        over-flow: visible !important;
      }
    </style>`;
    let servers = allowServerCalls === true ? "*" : allowServerCalls || "";
    const head = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${linkScript || "'none'"};
      style-src ${servers} 'unsafe-inline'; img-src data: blob: ${servers}">\n\n` +
      (linkScript ? `<script src="${linkScript}"><\/script>\n\n` : "") + headHTML + `\n\n`;
    /* Put our head additions in front of the mail, because the content is untrusted.
     * The HTML parser moves a leading meta and style element into the head for us. */
    let displayHTML = head + (autoSize ? autoSizeCSS : "") + (html ?? "");
    // console.log("html", displayHTML);
    blobURL = stringToBlobURL("text/html", displayHTML);
  }

  onDestroy(() => {
    if (blobURL) {
      URL.revokeObjectURL(blobURL);
    }
  });

  let webviewE: HTMLIFrameElement = null;
  $: webviewE && haveWebView();
  function haveWebView () {
    webviewE.addEventListener("dom-ready", async () => {
      try {
        dispatch("webview", webviewE);
        // #if [!WEBMAIL]
        if (autoSize) {
          webviewE.addEventListener("did-finish-load", () => catchErrors(onLoadResize));
        }
        await addInputListener();
        await addLinkListener();
        // #endif
      } catch (ex) {
        minorError(ex);
      }
    }, { once: true });

    // #if [!WEBMAIL]
    // <https://www.electronjs.org/docs/latest/api/webview-tag/#event-context-menu>
    webviewE.addEventListener("context-menu", event =>
      catchErrors(() => onContextMenu((event as any).params)));
    // #endif
  }

  // #if [!WEBMAIL]
  async function addInputListener() {
    if (!webviewE) {
      return;
    }
    let id = (webviewE as any).getWebContentsId();
    // The main process calls this. Show errors here, don't throw them back to it.
    await appGlobal.remoteApp.addEventListenerWebContents(id, "input-event", event => catchErrors(async () => {
      if (event.type == "mouseDown") {
        webviewE.click();
      } else if (event.type == "rawKeyDown") {
        await onKeyOnMessage(newElectronKeyboardEvent(event));
      }
    }), showError);
  }

  async function addLinkListener() {
    if (!webviewE) {
      return;
    }
    let id = (webviewE as any).getWebContentsId();
    let url: string;
    await appGlobal.remoteApp.addEventListenerWebContents(id, "update-target-url", (eventURL) => {
      url = eventURL; // Can also reset `eventURL` to null
    }, showError);
    // The main process calls this. Show errors here, don't throw them back to it.
    await appGlobal.remoteApp.addEventListenerWebContents(id, "input-event", event => catchErrors(async () => {
      if (!url) {
        return;
      }
      if (event.type == "mouseDown" && event.button == "left") {
        clickEvent = event;
        await onLinkClick(url);
      }
    }), showError);
  }

  async function onLinkClick(url: string) {
    if (!askBeforeOpeningLinks) {
      await openExternalURL(url);
    } else if (askBeforeOpening(url)) {
      await openLinkPopup.show(url);
    } else {
      // Like the default in the popup
      await openExternalURL(removeTrackingURL(url));
    }
  }

  let openLinkPopup: OpenLinkPopup;
  /** Where the user clicked on the link, relative to the webview:
   * The Electron `MouseInputEvent`, or on mobile, the tap from `linkScript` */
  let clickEvent: { x: number, y: number };
  /** We don't know how high the link is, so we assume 1 line in the normal font of a mail:
   * 16px with `line-height: 1.5` in `content-body.css` */
  const kLinkHeight = 24;
  /** The link that the user clicked on. The popup appears below or above it. */
  const linkAnchor: VirtualElement = {
    getBoundingClientRect() {
      let webview = webviewE.getBoundingClientRect();
      return new DOMRect(webview.x + clickEvent.x, webview.y + clickEvent.y - kLinkHeight / 2, 0, kLinkHeight);
    },
  };

  let contextMenuItems: ArrayColl<MenuItem>;
  async function onContextMenu(contextInfo: ContextInfo) {
    contextMenuItems = await buildContextMenu(contextInfo, webviewE);
    console.log("Context menu items:", contextMenuItems.contents.map(i => i.id).join(", "), contextMenuItems.contents);
    let menuItems = contextMenuItems.contents.map(item => ({
      id: item.id,
      label: item.label,
      icon: item.icon,
      click: () => catchErrors(item.action),
    }));
    if (!menuItems.length) {
      return;
    }
    await appGlobal.remoteApp.openMenu(menuItems);
  }

  let size: { width: number; height: number };
  async function getContentSize() {
    try {
      size = await webviewE.executeJavaScript(`
        try {
          const body = document.body;
          const styles = window.getComputedStyle(body);
          const width = parseFloat(styles.width);
          const height = Math.max( body.scrollHeight, body.offsetHeight, parseFloat(styles.height) );
          new Promise((resolve) => {
            resolve({
              width: width,
              height: height,
            });
          });
        } catch (ex) {
          new Promise((_, reject) => {
            reject(JSON.stringify(ex));
          });
        }
      `);
    } catch (ex) {
      console.error(ex);
    }
  }

  async function onLoadResize() {
    await getContentSize();
    resizeWebview();
  }
  // #endif

  // #if [MOBILE]
  /** The user tapped in the page, see `linkScript` */
  async function onTapInPage(event: MessageEvent) {
    if (event.source != webviewE?.contentWindow) {
      return;
    }
    webviewE.click(); // e.g. to close the popup, like `addInputListener()`
    let url = sanitize.url(event.data?.url, null);
    if (!url) {
      return;
    }
    clickEvent = { x: sanitize.float(event.data.x), y: sanitize.float(event.data.y) };
    await onLinkClick(url);
  }
  // #endif

  const heightBuffer = 10;
  let maxWidth: number;
  $: autoSize && size && maxWidth && resizeWebview();
  function resizeWebview() {
    if ((webviewE.parentElement && size.width > webviewE.parentElement.clientWidth) &&
    (!maxWidth || maxWidth && size.width < maxWidth)) {
      webviewE.style.width = size.width + "px";
    }
    if (maxWidth && maxWidth < size.width) {
      webviewE.style.width = maxWidth + "px";
    }
    if (webviewE.parentElement && size.width < webviewE.parentElement.clientWidth) {
      webviewE.style.width = "100%";
    }
    webviewE.style.height = (size.height + heightBuffer) + "px";
  };

  function observeMaxWidth() {
    const parent = parentWithMaxWidth(webviewE);
    const maxWidthVal = getComputedStyle(parent).maxWidth;
    const observer = new ResizeObserver((entries) => {
      const el = entries[0];
      if (maxWidthVal.endsWith("%")) {
        maxWidth = el.contentRect.width * (parseInt(maxWidthVal)/100);
      } else {
        maxWidth = parseInt(maxWidthVal);
      }
    });
    observer.observe(parent.parentElement);
  }

  function parentWithMaxWidth(el: HTMLElement) {
    while (el.parentElement &&
      getComputedStyle(el).maxWidth == "none") {
      el = el.parentElement;
    }
    return el;
  }
</script>

<style>
  webview, iframe {
    flex: 1 0 0;
    width: 100%;
    height: auto;
  }
  iframe {
    border: none;
  }
  .hidden {
    visibility: collapse;
  }
</style>
