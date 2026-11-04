<vbox class="open-export-page">
  <h1>{$t`Open`}</h1>
  <vbox class="commands">
    <button class="command" on:click={() => openSettingsDialog({ kind: "import-export", action: "import" })}>
      <hbox class="command-icon"><ImportIcon size={32} strokeWidth={1.25} /></hbox>
      <vbox class="command-text">
        <span class="command-title">{$t`Import`}</span>
        <span class="command-description">{$t`Import contacts or appointments from a file, or accounts from another program`}</span>
      </vbox>
    </button>
    <button class="command" on:click={() => openSettingsDialog({ kind: "import-export", action: "export" })}>
      <hbox class="command-icon"><ExportIcon size={32} strokeWidth={1.25} /></hbox>
      <vbox class="command-text">
        <span class="command-title">{$t`Export *=> Export data to a file`}</span>
        <span class="command-description">{$t`Save a calendar, an address book or other data to a file, for use in other programs`}</span>
      </vbox>
    </button>
    <button class="command" disabled={!sharingAccounts.length}
      title={sharingAccounts.length ? null : $t`None of your accounts can open the calendars of colleagues`}
      on:click={() => isOpenCalendarOpen = true}>
      <hbox class="command-icon"><OpenCalendarIcon size={32} strokeWidth={1.25} /></hbox>
      <vbox class="command-text">
        <span class="command-title">{$t`Open Calendar`}</span>
        <span class="command-description">{$t`Open a calendar that a colleague shared with you`}</span>
      </vbox>
    </button>
    <button class="command" disabled={!mailAccount}
      on:click={() => isSharedFolderOpen = true}>
      <hbox class="command-icon"><SharedFolderIcon size={32} strokeWidth={1.25} /></hbox>
      <vbox class="command-text">
        <span class="command-title">{$t`Other User's Folder`}</span>
        <span class="command-description">{$t`Open a folder shared by another user`}</span>
      </vbox>
    </button>
  </vbox>
</vbox>

{#if isOpenCalendarOpen}
  <OpenCalendarDialog on:close={() => isOpenCalendarOpen = false} />
{/if}
{#if isSharedFolderOpen && mailAccount}
  <SharedFolderDialog account={mailAccount} on:close={() => isSharedFolderOpen = false} />
{/if}

<script lang="ts">
  import { appGlobal } from "../../../logic/app";
  import { openSettingsDialog } from "../SettingsDialogs";
  import { selectedAccount } from "../../../frontend/Mail/Selected";
  import OpenCalendarDialog from "../../Calendar/OpenCalendarDialog.svelte";
  import SharedFolderDialog from "../../Mail/LeftPane/SharedFolderDialog.svelte";
  import OpenCalendarIcon from "lucide-svelte/icons/calendar-search";
  import ImportIcon from "lucide-svelte/icons/file-input";
  import ExportIcon from "lucide-svelte/icons/file-output";
  import SharedFolderIcon from "lucide-svelte/icons/folder-symlink";
  import { t } from "../../../l10n/l10n";

  const emailAccounts = appGlobal.emailAccounts;
  let isOpenCalendarOpen = false;
  let isSharedFolderOpen = false;
  $: sharingAccounts = $emailAccounts.contents.filter(account => !account.isDependentAccount && account.canShareWithPersons());
  $: mailAccount = $selectedAccount && $emailAccounts.contains($selectedAccount)
    ? $selectedAccount
    : $emailAccounts.first;
</script>

<style>
  .open-export-page {
    max-width: 760px;
    padding: 24px 40px;
  }
  h1 {
    margin: 0 0 16px 0;
    font-size: 28px;
    font-weight: 300;
  }
  .commands {
    gap: 4px;
  }
  .command {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 16px;
    min-height: 64px;
    padding: 8px 16px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .command:hover:not(:disabled) {
    background-color: var(--lo-hover-bg);
  }
  .command:active:not(:disabled) {
    background-color: var(--lo-pressed-bg);
  }
  .command:disabled {
    color: var(--lo-fg-disabled);
    cursor: default;
  }
  .command-icon {
    flex-shrink: 0;
    width: 40px;
    justify-content: center;
    color: var(--lo-accent-text);
  }
  .command:disabled .command-icon,
  .command:disabled .command-description {
    color: var(--lo-fg-disabled);
  }
  .command-text {
    gap: 2px;
  }
  .command-title {
    font-size: 16px;
    font-weight: 600;
  }
  .command-description {
    color: var(--lo-fg-secondary);
  }
</style>
