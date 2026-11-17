<hbox class="account" title={errorMsg}
  on:contextmenu={contextMenu.onContextMenu} {iconSize}>
  {#if $account.isLoggedIn}
    <hbox class="icon">
      {#if account.icon && typeof(account.icon) == "string" }
        <img src={account.icon}
          width={iconLogoSize}
          height={iconLogoSize}
          alt=""
          class="logo"
          />
      {:else}
        <Icon data={MailIcon} size={iconSize} />
      {/if}
    </hbox>
  {:else}
    <hbox class="icon">
      <Icon data={MailXIcon} size={iconSize} />
    </hbox>
  {/if}
  <hbox class="label font-small">{$account.name}</hbox>
  <hbox flex class="buttons">
    {#if $account.isLoggedIn}
      <GetMailButton folder={account.inbox} iconSize="14px" />
    {:else}
      <Button
        label={$t`Login`}
        icon={DisconnectedIcon}
        onClick={login}
        iconSize="16px" plain iconOnly />
    {/if}
    {#if account.protocol != "all"}
      <Button
        label={$t`Account settings`}
        icon={SettingsIcon}
        onClick={openSettings}
        iconSize="16px" plain iconOnly />
    {/if}
  </hbox>
</hbox>

<ContextMenu bind:this={contextMenu}>
  <AccountMenu {account} />
</ContextMenu>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { openSettingsCategoryForAccount } from "../../Settings/Window/CategoriesUtils";
  import { appGlobal } from "../../../logic/app";
  import Icon from 'svelte-icon/Icon.svelte';
  import GetMailButton from "./GetMailButton.svelte";
  import AccountMenu from "../../Mail/LeftPane/AccountMenu.svelte";
  import ContextMenu from "../../Shared/Menu/ContextMenu.svelte";
  import Button from "../../Shared/Button.svelte";
  import MailIcon from '../../asset/icon/appBar/mail.svg?raw';
  import MailXIcon from '../../asset/icon/mail/mail-question.svg?raw';
  import DisconnectedIcon from "lucide-svelte/icons/unplug";
  import SettingsIcon from "lucide-svelte/icons/settings";
  import { t } from "../../../l10n/l10n";

  export let account: MailAccount;

  async function login() {
    await account.loginAndStartup(true);
  }

  async function openSettings() {
    openSettingsCategoryForAccount(account);
  }

  let contextMenu: ContextMenu;

  $: errors = $account.errors;
  $: errorMsg = $account.fatalError
    ? account.fatalError.message
    : $errors.hasItems
      ? errors.first.message
      : "";
  $: iconSize = $appGlobal.isMobile ? "24px" : "16px";
  $: iconLogoSize = $appGlobal.isMobile ? "24px" : "18px";
</script>

<style>
  .account {
    align-items: center;
    padding-inline-start: 12px;
    padding-block-start: 2px;
    padding-block-end: 2px;
  }
  .icon {
    height: 20px;
    width: 20px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
  }
  .icon :global(path),
  .icon :global(.cls-2) {
    stroke: var(--leftpane-fg);
  }
  .logo {
    border-radius: 2px;
  }
  .label {
    margin-inline-start: 6px;
    font-weight: 300;
    max-height: 1.3em;
    min-width: 0; /* avoid pushing out the buttons */
    overflow: hidden;
  }
  .account:not(:hover) .buttons {
    display: none;
  }
  .buttons {
    justify-content: end;
    margin-inline-end: 8px;
    background-color: inherit;
  }
  .buttons :global(button) {
    color: unset;
    background-color: unset;
    border: none;
  }
  .buttons :global(.get-mail button) {
    padding: 2px;
    border: 1px solid transparent;
  }
</style>
