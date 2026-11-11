<Popup bind:popupOpen {popupAnchor} placement="bottom-start" boundaryElSel="body">
  <vbox class="open-link-popup" bind:this={popupE} on:keydown={onKeyDown} role="dialog" aria-label={domain} tabindex="-1">
    <hbox class="domain">{domain}</hbox>
    <hbox class="buttons">
      <Button label={$t`Open in browser`} classes="filled" onClick={onOpen} />
      <Button label={$t`Copy link`} icon={CopyIcon} iconOnly classes="secondary" onClick={onCopy} />
    </hbox>
    <hbox class="url">{url}</hbox>
    <Checkbox checked={false} allowIndetermined={false}
      label={$t`Don't show again for ${domain}`}
      on:change={onDontShowAgain} />
  </vbox>
</Popup>

<script lang="ts" context="module">
  import { getBaseDomainFromHost } from "../../logic/util/netUtil";
  import { getUserPreference, setUserPreference } from "../../logic/util/util";
  import { sanitize } from "../../../lib/util/sanitizeDatatypes";

  /** Base domains for which the user wants links to open without asking */
  const kOpenWithoutAskingPref = "links.openWithoutAsking.domains";

  /** Whether we should show this popup for the link, before opening it in the browser.
   * Only for web pages. `mailto:` etc. open in the OS app without asking, as before. */
  export function askBeforeOpening(url: string): boolean {
    let domain = linkDomain(url);
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
  import { openExternalURL } from "../../logic/util/os-integration";
  import { catchErrors } from "../Util/error";
  import { tick } from "svelte";
  import { t } from "../../l10n/l10n";

  /** Where the link is. The popup appears below or above it.
   * in */
  export let popupAnchor: HTMLElement | VirtualElement;

  let popupOpen = false;
  let url: string;
  let domain: string;
  let popupE: HTMLElement;

  /** Shows the popup for this link, which lets the user open or copy it */
  export async function show(linkURL: string) {
    popupOpen = false; // Recreate the content, e.g. reset the checkbox
    await tick();
    url = linkURL;
    domain = linkDomain(linkURL) ?? "";
    popupOpen = true;
    await tick();
    popupE?.focus(); // for Return and Escape
  }

  async function onOpen() {
    popupOpen = false;
    await openExternalURL(url);
  }

  async function onCopy() {
    popupOpen = false;
    await navigator.clipboard.writeText(url);
  }

  function onDontShowAgain(event: CustomEvent<boolean>) {
    setAskBeforeOpening(domain, !event.detail);
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
      catchErrors(onOpen);
    }
  }
</script>

<style>
  .open-link-popup {
    min-width: 280px;
    max-width: min(480px, calc(100vw - 32px));
    padding: 16px;
    background-color: var(--bg);
    color: var(--fg);
    /* In dark mode, the mail has the same background */
    border: 1px solid var(--border);
    border-radius: 5px;
    outline: none;
  }
  .domain {
    font-size: 24px;
    font-weight: bold;
    overflow-wrap: anywhere;
  }
  .buttons {
    gap: 8px;
    margin-block-start: 12px;
  }
  .url {
    margin-block: 24px 12px;
    max-height: 8em;
    overflow-y: auto;
    overflow-wrap: anywhere;
    font-size: 12px;
    opacity: 70%;
    user-select: text;
  }
  .open-link-popup :global(.checkbox) {
    font-size: 12px;
  }
  .open-link-popup :global(.checkbox input),
  .open-link-popup :global(.checkbox .state-icon-wrapper) {
    width: 16px;
    height: 16px;
    min-width: 16px;
  }
</style>
