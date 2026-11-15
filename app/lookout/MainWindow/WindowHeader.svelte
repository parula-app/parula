<hbox class="title-bar" class:mac class:os-rtl={osRTL}>
  <hbox class="app-logo">
    <AppIcon icon={logo} size="18px" />
  </hbox>
  <hbox class="app-name">{appName}</hbox>
  <QuickAccessToolbar placement="above" />
  <hbox class="ribbon-tabs" bind:this={$titleBarTabs} />
  <hbox class="search-area" class:mail={isMail}>
    <hbox class="search-box" class:has-search={!!$globalSearchTerm}>
      {#if isMail}
        <MailSearchBox />
      {:else}
        <SearchField bind:searchTerm={$globalSearchTerm} placeholder={$t`Search`} bind:this={searchField} />
      {/if}
    </hbox>
  </hbox>
  <hbox class="window-buttons">
    {#if !webMail}
      <button class="window-button minimize" title={$t`Minimize`} aria-label={$t`Minimize`}
        on:click={() => catchErrors(onMinimize)}>
        <MinimizeIcon size="16" />
      </button>
      <button class="window-button maximize"
        title={canMaximize ? $t`Maximize` : $t`Restore window`}
        aria-label={canMaximize ? $t`Maximize` : $t`Restore window`}
        on:click={() => catchErrors(onMaximizeOrRestore)}>
        <svelte:component this={canMaximize ? MaximizeIcon : UnmaximizeIcon} size="13" />
      </button>
      <button class="window-button close" title={$t`Close`} aria-label={$t`Close`}
        on:click={() => catchErrors(onCloseApp)}>
        <XIcon size="17" />
      </button>
    {/if}
  </hbox>
</hbox>

<script lang="ts">
  import { globalSearchTerm } from "../../frontend/AppsBar/selectedApp";
  import type { MustangApp } from "../../frontend/AppsBar/MustangApp";
  import { mailMustangApp } from "../../frontend/Mail/MailMustangApp";
  import { appGlobal } from "../../logic/app";
  import { appName, webMail } from "../../logic/build";
  import SearchField from "../../frontend/Shared/SearchField.svelte";
  import MailSearchBox, { mailSearchInput } from "../Mail/Search/MailSearchBox.svelte";
  import QuickAccessToolbar, { quickAccessCommands } from "./QuickAccessToolbar.svelte";
  import { titleBarTabs } from "../Shared/Ribbon/Ribbon.svelte";
  import type { QuickAccessCommand } from "../Shared/QuickAccess/QuickAccess";
  import type { EMail } from "../../logic/Mail/EMail";
  import { selectedMessages } from "../../frontend/Mail/Selected";
  import { MessageActions } from "../Mail/MessageActions";
  import SendReceiveIcon from "lucide-svelte/icons/refresh-cw";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ReplyAllIcon from "lucide-svelte/icons/reply-all";
  import ForwardIcon from "lucide-svelte/icons/forward";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import PrintIcon from "lucide-svelte/icons/printer";
  import { printMessage } from "../Mail/Message/MessagePrint.svelte";
  import { derived, get, writable } from "svelte/store";
  import AppIcon from "../../frontend/AppsBar/AppIcon.svelte";
  import logo from "../../frontend/asset/icon/general/logo.svg?raw";
  import MinimizeIcon from "lucide-svelte/icons/minus";
  import MaximizeIcon from "lucide-svelte/icons/square";
  import UnmaximizeIcon from "lucide-svelte/icons/copy";
  import XIcon from "lucide-svelte/icons/x";
  import { getOSName } from "../../frontend/Util/util";
  import { catchErrors } from "../../frontend/Util/error";
  import { rtlLocales } from "../../l10n/list";
  import { t } from "../../l10n/l10n";

  export let selectedApp: MustangApp;

  $: isMail = !!selectedApp && (selectedApp == mailMustangApp || mailMustangApp.subApps.includes(selectedApp));

  let searchField: SearchField;
  export function focusSearch() {
    if (isMail) {
      $mailSearchInput?.focus();
    } else {
      searchField?.focus();
    }
  }

  const sendReceiveAll: QuickAccessCommand = {
    id: "sendReceiveAll",
    label: $t`Send/Receive All Folders`,
    icon: SendReceiveIcon,
    shortCutInfo: "F9",
    shownByDefault: true,
    run: () => MessageActions.sendReceiveAll(),
  };
  $: selection = $selectedMessages;
  const selectedArray = writable<EMail[]>([]);
  $: $selectedArray = $selection?.contents ?? [];
  const noSelection = derived(selectedArray, messages => !messages.length && $t`Select a message first`);
  const noSingle = derived(selectedArray, messages => messages.length != 1 && $t`Select one message first`);
  const mailCommands: QuickAccessCommand[] = [
    sendReceiveAll,
    { id: "mail.reply", label: $t`Reply`, icon: ReplyIcon, shortCutInfo: $t`Ctrl+R *=> Keyboard shortcut`, disabled: noSingle,
      run: () => MessageActions.respond(get(selectedArray)[0], get(selectedArray)[0].compose.replyToAuthor()) },
    { id: "mail.replyAll", label: $t`Reply All`, icon: ReplyAllIcon, shortCutInfo: $t`Ctrl+Shift+R *=> Keyboard shortcut`, disabled: noSingle,
      run: () => MessageActions.respond(get(selectedArray)[0], get(selectedArray)[0].compose.replyAll()) },
    { id: "mail.forward", label: $t`Forward`, icon: ForwardIcon, shortCutInfo: $t`Ctrl+F *=> Keyboard shortcut`, disabled: noSingle,
      run: () => MessageActions.forward(get(selectedArray)[0]) },
    { id: "mail.delete", label: $t`Delete`, icon: DeleteIcon, shortCutInfo: $t`Del *=> Delete key`, disabled: noSelection,
      run: async () => { await Promise.all(get(selectedArray).map(message => message.deleteMessage())); } },
    { id: "mail.print", label: $t`Print`, icon: PrintIcon, shortCutInfo: $t`Ctrl+P *=> Keyboard shortcut`, disabled: noSingle,
      run: () => { $printMessage = get(selectedArray)[0]; } },
  ];
  $: $quickAccessCommands = isMail ? mailCommands : [sendReceiveAll];

  /* <copied from="../../frontend/MainWindow/WindowHeader.svelte"> */
  const mac = (!webMail && getOSName() == "macintosh") ? true : false;
  const osRTL = (rtlLocales.includes(navigator.language) && mac) ? true : false;

  function onMinimize() {
    appGlobal.remoteApp.minimizeMainWindow();
  }

  let canMaximize = true;
  function onMaximizeOrRestore() {
    if (canMaximize) {
      appGlobal.remoteApp.maximizeMainWindow();
    } else {
      appGlobal.remoteApp.unminimizeMainWindow();
    }
    canMaximize = !canMaximize;
  }

  function onCloseApp() {
    window.close();
  }
  /* </copied> */
</script>

<style>
  .title-bar {
    flex: 0 0 auto;
    align-items: stretch;
    height: var(--lo-titlebar-height);
    background-color: var(--lo-titlebar-bg);
    color: var(--lo-fg);
    app-region: drag;
  }
  .app-logo {
    align-items: center;
    padding-inline: 14px 8px;
  }
  .app-logo :global(.horse),
  .app-logo :global(.circle-bars) {
    fill: var(--lo-accent);
    stroke: var(--lo-accent);
  }
  /* Gets the free space before the search field, so it shrinks after the search field */
  .app-name {
    display: block;
    flex: 1000 1 0;
    max-width: max-content;
    min-width: 0;
    align-self: center;
    margin-inline-end: 16px;
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Shrinks only if even the smallest search field doesn't fit */
  .ribbon-tabs {
    min-width: 0;
    app-region: no-drag;
  }
  .search-area {
    flex: 1 1 0;
    min-width: calc(50px + 10ch);
    align-items: center;
    justify-content: center;
    /* Leaves space to drag the window */
    padding-inline: 64px 8px;
    container: search-area / inline-size;
  }
  .search-area.mail {
    min-width: calc(155px + 10ch);
  }
  .search-box {
    flex: 0 1 680px;
    min-width: 0;
  }
  /* If there is not enough space, the search field shrinks to about 25 characters.
   * Then, the mail search scope shows only an icon.
   * Then, the search field shrinks to 10 characters, and expands when it's used.
   * 245px, 155px and 50px are roughly the icons and buttons around the text field. */
  @container search-area (width < calc(245px + 25ch)) {
    .mail :global(.scope-label) {
      display: none;
    }
    .mail :global(.scope-icon) {
      display: block;
    }
  }
  @container search-area (width < calc(155px + 25ch)) {
    .mail .search-box:not(:has(input:focus), .has-search) {
      flex: 0 0 calc(155px + 10ch);
    }
  }
  @container search-area (width < calc(50px + 25ch)) {
    .search-area:not(.mail) .search-box:not(:has(input:focus), .has-search) {
      flex: 0 0 calc(50px + 10ch);
    }
  }
  .search-box :global(.search) {
    flex: 1 1 0;
    height: 30px;
    box-sizing: border-box;
    padding: 0 10px;
    gap: 8px;
    align-items: center;
    background-color: var(--lo-input-bg);
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
    color: var(--lo-fg-secondary);
    app-region: no-drag;
  }
  .search-box :global(.search:hover) {
    border-color: var(--lo-border-strong);
  }
  .search-box :global(.search:focus-within) {
    border-color: var(--lo-border-strong);
    border-bottom: 2px solid var(--lo-accent);
  }
  .search-box :global(.search input) {
    flex: 1 1 0;
    min-width: 0;
    border: none;
    background-color: transparent;
    color: var(--lo-fg);
    font-size: var(--lo-font-size);
    outline: none;
  }
  .search-box :global(.search input:focus) {
    border: none;
  }
  .window-buttons {
    flex: 0 0 auto;
    justify-content: flex-end;
    align-items: stretch;
  }
  .window-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    padding: 0;
    border: none;
    background-color: transparent;
    color: var(--lo-fg);
    app-region: no-drag;
  }
  .window-button:hover {
    background-color: var(--lo-hover-bg);
  }
  .window-button.close:hover {
    background-color: var(--lo-danger);
    color: var(--lo-danger-fg);
  }

  .mac .window-buttons {
    display: none;
  }
  .mac .app-logo {
    padding-inline-start: 80px;
  }
  :global([dir="rtl"]) .mac:not(.os-rtl) .app-logo,
  .mac.os-rtl .app-logo {
    padding-inline-start: 14px;
  }
</style>
