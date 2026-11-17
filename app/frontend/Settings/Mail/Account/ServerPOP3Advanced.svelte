<HeaderGroupBox>
  <hbox slot="header">POP3 - {$t`Advanced`}</hbox>

  <Checkbox bind:checked={account.loginOnStartup} label={$t`Login on startup`} allowIndetermined={false} />

  <hbox class="interval-box">
    <label for="pollInterval">{$t`Poll interval`}</label>
    <input type="number" bind:value={account.pollIntervalMinutes} name="pollInterval" min={0} max={360} maxlength={3} />
    <hbox class="unit">{$t`Minutes`}</hbox>
  </hbox>

  <hbox class="leave-box">
    <Checkbox bind:checked={account.leaveOnServer} label={$t`Leave the mails on the server`} allowIndetermined={false} />
  </hbox>
  {#if $account.leaveOnServer}
    <hbox class="interval-box">
      <label for="deleteAfterDays">{$t`Delete them from the server after`}</label>
      <input type="number" bind:value={account.deleteAfterDays} name="deleteAfterDays" min={0} max={9999} maxlength={4} />
      <hbox class="unit">{$t`days (0 = never)`}</hbox>
    </hbox>
  {/if}
  {#if $account.deleteAfterDays || !$account.leaveOnServer}
    <StatusMessage status="warning" message={$t`POP3 downloads mails to this device and *deletes* the emails on the server. Your phone and other devices cannot get those mails anymore. Use IMAP, if possible. (Exceptions are Google and Outlook.)`}>
      <AlertIcon slot="icon" size={20} />
    </StatusMessage>
  {/if}
</HeaderGroupBox>

<script lang="ts">
  import type { POP3Account } from "../../../../logic/Mail/POP3/POP3Account";
  import HeaderGroupBox from "../../../Shared/HeaderGroupBox.svelte";
  import StatusMessage from "../../../Setup/Shared/StatusMessage.svelte";
  import Checkbox from "../../../Shared/Checkbox.svelte";
  import AlertIcon from "lucide-svelte/icons/alert-triangle";
  import { t } from "../../../../l10n/l10n";

  export let account: POP3Account;
</script>

<style>
  .interval-box, .leave-box {
    margin-block-start: 16px;
  }
  input[type="number"] {
    width: 3em;
    text-align: center;
    margin-inline-start: 12px;
    margin-inline-end: 6px;
  }
</style>
