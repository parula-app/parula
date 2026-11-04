<button class="account-row" class:selected={isSelected} role="option" aria-selected={isSelected}
  on:click
  on:dblclick={() => openAccountSettings(account)}>
  <hbox class="account-icon"><AccountIcon size={24} strokeWidth={1.5} /></hbox>
  <vbox flex class="account-names">
    <span class="account-address">{$account.emailAddress || $account.name}</span>
    <span class="account-type">{$account.emailAddress && $account.name != $account.emailAddress
      ? `${$account.name} · ${getAccountTypeLabel(account)}`
      : getAccountTypeLabel(account)}</span>
  </vbox>
</button>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { getAccountTypeLabel } from "../Shared/AccountLabels";
  import { openAccountSettings } from "../SettingsDialogs";
  import AccountIcon from "lucide-svelte/icons/mail";

  export let account: MailAccount;
  export let isSelected = false;
</script>

<style>
  .account-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    padding: 4px 12px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .account-row:hover {
    background-color: var(--lo-hover-bg);
  }
  .account-row.selected {
    background-color: var(--lo-selected-bg);
  }
  .account-icon {
    color: var(--lo-accent-text);
  }
  .account-names {
    min-width: 0;
  }
  .account-address {
    font-weight: 600;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .account-type {
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
