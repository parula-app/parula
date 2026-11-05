<div class="tap-point" style="left: {tap?.x}px; top: {tap?.y}px" bind:this={tapE} />
<Popup bind:popupOpen popupAnchor={tapE} placement="bottom" boundaryElSel="body">
  <vbox class="link-popup">
    <hbox class="domain">{domain}</hbox>
    <Button
      label={$t`Open`}
      icon={BrowserIcon}
      iconSize="20px"
      classes="filled large"
      onClick={onOpen}
      bind:buttonEl={openButtonE}
      />
    <hbox class="buttons">
      <Button
        label={$t`Copy link`}
        icon={CopyIcon}
        classes="secondary"
        onClick={onCopy}
        />
      <Button
        label={$t`Open in… *=> Choose the app that opens the link`}
        icon={OpenWithIcon}
        classes="secondary"
        onClick={onOpenWith}
        />
    </hbox>
    <hbox class="url">{tap?.url}</hbox>
  </vbox>
</Popup>
<svelte:window on:blur={onFocusToWebView} on:popstate={() => popupOpen = false} />

<script lang="ts">
  import { linkTapPlugin, type LinkTap } from "../../logic/util/os-integration";
  import { getBaseDomainFromURL } from "../../logic/util/netUtil";
  import Popup from "./Popup.svelte";
  import Button from "./Button.svelte";
  import BrowserIcon from "lucide-svelte/icons/globe";
  import CopyIcon from "lucide-svelte/icons/copy";
  import OpenWithIcon from "lucide-svelte/icons/external-link";
  import { catchErrors } from "../Util/error";
  import { t } from "../../l10n/l10n";
  import { onDestroy, onMount, tick } from "svelte";
  import type { PluginListenerHandle } from "@capacitor/core";

  /**
   * Android: A tap on a link in a mail or other untrusted HTML first shows
   * where the link goes, and lets the user decide what to do with it.
   */

  let tap: LinkTap;
  let domain: string;
  let popupOpen = false;
  let tapE: HTMLDivElement;
  let openButtonE: HTMLButtonElement;

  let listener: PluginListenerHandle;
  onMount(() => catchErrors(listen));
  async function listen() {
    listener = await linkTapPlugin?.addListener("linkTap", newTap => catchErrors(() => onLinkTap(newTap)));
  }
  onDestroy(() => catchErrors(() => listener?.remove()));

  async function onLinkTap(newTap: LinkTap) {
    if (document.elementFromPoint(newTap.x, newTap.y)?.matches("iframe[sandbox]")) {
      popupOpen = false;
      await tick();
      tap = newTap;
      domain = getBaseDomainFromURL(tap.url) || new URL(tap.url).hostname;
      popupOpen = true;
      await tick();
      openButtonE?.focus();
      return;
    }
    await linkTapPlugin.open({ url: newTap.url });
  }

  /** A tap into the mail moves the focus there, but its click events don't reach us */
  function onFocusToWebView() {
    if (document.activeElement instanceof HTMLIFrameElement) {
      popupOpen = false;
    }
  }

  async function onOpen() {
    popupOpen = false;
    await linkTapPlugin.open({ url: tap.url });
  }

  async function onOpenWith() {
    popupOpen = false;
    await linkTapPlugin.openWith({ url: tap.url });
  }

  async function onCopy() {
    popupOpen = false;
    await navigator.clipboard.writeText(tap.url);
  }
</script>

<style>
  .tap-point {
    position: fixed;
    width: 0px;
    height: 32px;
    margin-top: -16px;
    pointer-events: none;
  }
  .link-popup {
    width: 18em;
    max-width: calc(100vw - 32px);
    padding: 16px;
    gap: 12px;
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
    border-radius: 5px;
    box-shadow: 2.281px 1.14px 9.123px 0px rgba(var(--shadow-color), 20%);
  }
  .domain {
    justify-content: center;
    font-size: 20px;
    font-weight: bold;
    overflow-wrap: anywhere;
  }
  .buttons {
    gap: 8px;
  }
  .buttons :global(.button) {
    flex: 1 1 0;
  }
  .url {
    max-height: 6em;
    overflow-y: auto;
    font-size: 12px;
    opacity: 70%;
    overflow-wrap: anywhere;
  }
</style>
