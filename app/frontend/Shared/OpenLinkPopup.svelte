<Popup bind:popupOpen {popupAnchor} placement="bottom-start" boundaryElSel="body">
  <vbox class="open-link-popup" bind:this={popupE} on:keydown={onKeyDown} role="dialog" aria-label={domain || $t`Unknown destination`} tabindex="-1">
    <vbox class="content">
      {#if domain}
        <hbox class="domain">{domain}</hbox>
      {:else}
        <hbox class="domain unknown" role="alert">
          <WarningIcon size="1em" />
          {$t`Unknown destination`}
        </hbox>
      {/if}
      <hbox class="buttons">
        <Button label={$t`Open in browser`} classes="filled" onClick={onOpenLinkInBrowser} />
        <Button label={$t`Cancel`} classes="secondary" onClick={onCancel} />
      </hbox>
      <hbox class="url-line">
        <div class="url">
          {#each urlParts(targetURL) as part}
            {part}<wbr>
          {/each}
        </div>
        <hbox class="copy">
          <Button label={$t`Copy link`} icon={CopyIcon} iconSize="14px" iconOnly plain onClick={onCopy} />
        </hbox>
      </hbox>
      {#if untrackedURL != originalURL}
        <hbox class="remove-tracking">
          <Checkbox bind:checked={removeTracking} allowIndetermined={false}
            label={$t`Remove tracking`} />
        </hbox>
      {/if}
    </vbox>
    {#if domain}
      <hbox class="footer">
        {#key domain} <!-- The other checkbox can change the domain. Then start unchecked again. -->
          <Checkbox checked={false} allowIndetermined={false}
            label={$t`Don't show again for ${domain}`}
            on:change={ev => catchErrors(() => onDontShowAgain(ev.detail))} />
        {/key}
      </hbox>
    {/if}
  </vbox>
</Popup>

<script lang="ts" context="module">
  import { getBaseDomainFromHost, removeTrackingURL } from "../../logic/util/netUtil";
  import { getUserPreference, setUserPreference } from "../../logic/util/util";
  import { sanitize } from "../../../lib/util/sanitizeDatatypes";

  /** Base domains for which the user wants links to open without asking */
  const kOpenWithoutAskingPref = "links.openWithoutAsking.domains";

  /** Whether we should show this popup for the link, before opening it in the browser.
   * Only for web pages. `mailto:` etc. open in the OS app without asking, as before.
   * For a tracking link, this depends on where it goes, see `removeTrackingURL()`. */
  export function askBeforeOpening(url: string): boolean {
    let domain = linkDomain(removeTrackingURL(url));
    return !!domain && !sanitize.array(getUserPreference(kOpenWithoutAskingPref, []), []).includes(domain);
  }

  function setAskBeforeOpening(domain: string, ask: boolean) {
    let otherDomains = sanitize.array(getUserPreference(kOpenWithoutAskingPref, []), []).filter(d => d != domain);
    setUserPreference(kOpenWithoutAskingPref, ask ? otherDomains : [...otherDomains, domain]);
  }

  /** @returns e.g. "foo.com" for "https://a.b.foo.com/bar",
   *   or null for links that are not to web pages */
  function linkDomain(url: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (ex) {
      return null;
    }
    if (!["https:", "http:"].includes(parsed.protocol) || !parsed.hostname) {
      return null;
    }
    // `URL` gives the punycode, so look-alike Unicode domains show what they really are
    return getBaseDomainFromHost(parsed.hostname) ?? parsed.hostname;
  }
</script>

<script lang="ts">
  import type { VirtualElement } from "@popperjs/core";
  import Popup from "./Popup.svelte";
  import Button from "./Button.svelte";
  import Checkbox from "./Checkbox.svelte";
  import CopyIcon from "lucide-svelte/icons/copy";
  import WarningIcon from "lucide-svelte/icons/triangle-alert";
  import { openExternalURL } from "../../logic/util/os-integration";
  import { catchErrors } from "../Util/error";
  import { tick } from "svelte";
  import { t } from "../../l10n/l10n";

  /** Where the link is. The popup appears below or above it.
   * in */
  export let popupAnchor: HTMLElement | VirtualElement;

  let popupOpen = false;
  /** The link as it was in the email */
  let originalURL: string;
  $: untrackedURL = removeTrackingURL(originalURL);
  let removeTracking = true;
  /** What we show, open and copy */
  let targetURL: string;
  $: targetURL = removeTracking ? untrackedURL : originalURL;
  /** null, if the link has no web domain */
  let domain: string | null;
  $: domain = linkDomain(targetURL);
  let popupE: HTMLElement;

  /** Shows the popup for this link, which lets the user open or copy it */
  export async function show(linkURL: string) {
    popupOpen = false; // Recreate the content, e.g. reset the checkbox
    await tick();
    originalURL = linkURL;
    removeTracking = true;
    popupOpen = true;
    await tick();
    popupE?.focus(); // for Return and Escape
  }

  async function onOpenLinkInBrowser() {
    popupOpen = false;
    await openExternalURL(targetURL);
  }

  function onCancel() {
    popupOpen = false;
  }

  async function onCopy() {
    popupOpen = false;
    await navigator.clipboard.writeText(targetURL);
  }

  function onDontShowAgain(checked: boolean) {
    setAskBeforeOpening(domain, !checked);
    // The checkbox replaces its <input>, so the focus would go to the page, and Escape would not reach us
    popupE.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key == "Escape") {
      event.stopPropagation();
      popupOpen = false;
    } else if (event.key == "Enter" && !(event.target as Element).closest("button")) {
      // [Open in browser] is the default button. A button with the focus does its own action.
      event.preventDefault();
      event.stopPropagation();
      catchErrors(onOpenLinkInBrowser);
    }
  }

  /** Splits the URL after each `/`, so that it can wrap there. Not within `//`. */
  function urlParts(url: string): string[] {
    return url.split(/(?<=\/)(?!\/)/);
  }
</script>

<style>
  .open-link-popup {
    min-width: min(350px, calc(100vw - 32px)); /* phones */
    max-width: min(480px, calc(100vw - 32px));
    background-color: var(--bg);
    color: var(--fg);
    /* In dark mode, the mail has the same background */
    border: 1px solid var(--border);
    border-radius: 5px;
    overflow: hidden;
    outline: none;
  }
  /* The line height of the domain adds space above its letters, so less padding
     at the top. The letters are 25px from the top and 29px from the side. */
  .content {
    padding: 12px 28px 16px;
  }
  .domain {
    font-size: 24px;
    font-weight: bold;
    overflow-wrap: anywhere;
  }
  .unknown {
    align-items: center;
    gap: 8px;
  }
  .buttons {
    gap: 8px;
    margin-block-start: 12px;
  }
  .url-line {
    margin-block-start: 24px;
    align-items: flex-start;
    /* A long URL wraps, but doesn't make the popup wider */
    contain: inline-size;
  }
  .url {
    flex: 1;
    min-width: 0;
    max-height: 6lh; /* whole lines */
    overflow-y: auto;
    overflow-wrap: anywhere;
    font-size: 12px;
    opacity: 70%;
    user-select: text;
  }
  /* One line of the URL high, so that the button is in the middle of its first line,
     also when the URL wraps.
     On the right is the padding of the popup, minus 8px, so the same space on the left. */
  .copy {
    height: 1lh;
    align-items: center;
    margin-inline-start: 8px;
    margin-inline-end: -8px;
    font-size: 12px;
    opacity: 70%; /* like the URL */
  }
  .copy :global(button) {
    color: inherit;
  }
  .remove-tracking {
    margin-block-start: 8px;
    font-size: 12px;
  }
  .footer {
    padding: 10px 28px;
    border-block-start: 1px solid var(--border);
    background-color: var(--leftbar-bg);
    font-size: 12px;
  }
  .open-link-popup :global(.checkbox input),
  .open-link-popup :global(.checkbox .state-icon-wrapper) {
    width: 16px;
    height: 16px;
    min-width: 16px;
  }

  :global(.lookout-window) .open-link-popup {
    border-color: var(--lo-border);
    border-radius: var(--lo-radius);
    box-shadow: var(--lo-shadow-popup);
  }
  /* The letters of the domain are 24px from the top and 24px from the side */
  :global(.lookout-window) .content {
    padding: 16px 24px 16px;
  }
  :global(.lookout-window) .domain {
    font-size: var(--lo-font-size-large);
    font-weight: 600;
  }
  :global(.lookout-window) .unknown :global(svg) {
    color: var(--lo-warning);
  }
  :global(.lookout-window) .url {
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
    opacity: 1;
  }
  :global(.lookout-window) .copy {
    font-size: var(--lo-font-size-small);
    margin-inline-start: 4px;
    /* like the URL */
    color: var(--lo-fg-secondary);
    opacity: 1;
  }
  :global(.lookout-window) .remove-tracking {
    font-size: var(--lo-font-size-small);
  }
  :global(.lookout-window) .footer {
    padding: 10px 24px;
    border-color: var(--lo-divider);
    background-color: var(--lo-pane-alt-bg);
    font-size: var(--lo-font-size-small);
  }
</style>
