<Header
  title={$t`Connect Signal`}
  subtitle={$t`Signal on your phone can link this as a companion device`}
/>

<hbox class="splitscreen">
  <vbox>
    {#if paired}
      <vbox class="status success">
        <StatusMessage status="success" message={$t`Device linked`} />
      </vbox>
    {:else if error}
      <vbox class="status error">
        <ErrorMessageInline ex={error} />
        <Button label={$t`Try again`} classes="secondary" onClick={startLinking} />
      </vbox>
    {:else if historyStatus}
      <vbox class="status inprogress">
        <StatusMessage status="processing" message={historyStatusLabel} />
      </vbox>
    {:else if qrData}
      <vbox class="qr-area">
        <QRCode data={qrData} size={264} />
      </vbox>
    {:else}
      <hbox class="status inprogress">
        <StatusMessage status="processing" message={$t`Preparing code…`} />
      </hbox>
    {/if}
  </vbox>
  {#if historyStatus == "awaiting-approval"}
    <vbox class="instructions">
      <p>{$t`Fetching your messages`}</p>
      <ol>
        <li>{@html $t`On your phone, tap <span class="mock-button">Transfer</span> (or <span class="mock-button">Transfer Message History</span>)`}</li>
        <li>{$t`Keep your phone nearby and online`}</li>
      </ol>
      <Button label={$t`Skip`} classes="secondary" onClick={onSkipHistory} />
    </vbox>
  {:else if !paired && !historyStatus}
    <vbox class="instructions">
      <ol>
        <li>{$t`Open Signal on your phone`}</li>
        <li>{@html $t`Tap your profile icon, then <span class="mock-button">Settings</span>, then <span class="mock-button">Linked devices</span>`}</li>
        <li>{@html $t`Tap <span class="mock-button">Link New Device</span>`}</li>
        <li>{$t`Scan this code with your phone camera`}</li>
      </ol>
    </vbox>
  {/if}
</hbox>

<ButtonsBottom canContinue={false} showContinue={false} canCancel={true} onCancel={onCancelLink} />

<script lang="ts">
  import type { SignalAccount } from "../../../../logic/Chat/Signal/SignalAccount";
  import type { BackupImportStatus } from "../../../../logic/Chat/Signal/Connection/MessageBackupImport";
  import { appGlobal } from "../../../../logic/app";
  import Header from "../../Shared/Header.svelte";
  import StatusMessage from "../../Shared/StatusMessage.svelte";
  import ButtonsBottom from "../../Shared/ButtonsBottom.svelte";
  import Button from "../../../Shared/Button.svelte";
  import QRCode from "../../../Shared/QRCode.svelte";
  import ErrorMessageInline from "../../../Shared/ErrorMessageInline.svelte";
  import { catchErrors } from "../../../Util/error";
  import { t } from "../../../../l10n/l10n";
  import { onMount, onDestroy } from "svelte";

  /** in/out */
  export let config: SignalAccount;
  /** out */
  export let showPage: ConstructorOfATypedSvelteComponent;
  export let onCancel = (event: Event) => undefined;

  /** The `sgnl://linkdevice?uuid=…&pub_key=…` payload the phone scans. */
  let qrData: string | null = null;
  let error: Error | null = null;
  let paired = false;
  let closing = false;
  /** Set once the message-history transfer phase starts (Docs/02 §B.6); drives the
   * "approve on your phone" dialog. Cleared back to null on `done`/`skipped`. */
  let historyStatus: BackupImportStatus | null = null;

  config.name = "Signal";

  $: historyStatusLabel =
    historyStatus == "downloading" ? $t`Downloading your chats…` :
    historyStatus == "importing" ? $t`Importing your chats…` :
    $t`Transferring your chats…`;

  onMount(() => catchErrors(startLinking));

  onDestroy(() => {
    closing = true;
    config.cancelLinking();
  });

  async function startLinking() {
    error = null;
    qrData = null;
    paired = false;
    historyStatus = null;
    try {
      await config.linkDevice(qr => qrData = qr, onHistoryStatus);
      qrData = null;
      historyStatus = null;
      paired = true;
      if (!appGlobal.chatAccounts.includes(config)) {
        appGlobal.chatAccounts.add(config);
      }
      await config.save();
      await config.syncOnStartup(); // `linkDevice()` logged us in already
      showPage = null; // finish the wizard
    } catch (ex) {
      if (!closing) {
        error = ex as Error;
      }
    }
  }

  function onHistoryStatus(status: BackupImportStatus) {
    qrData = null; // the phone is done scanning; show the transfer dialog instead
    historyStatus = status == "done" || status == "skipped" ? null : status;
  }

  function onSkipHistory() {
    config.cancelHistoryTransfer();
  }

  function onCancelLink(event: Event) {
    config.cancelLinking();
    onCancel(event);
  }
</script>

<style>
  .splitscreen {
    margin-block-start: 8px;
    gap: 24px;
    flex-wrap: wrap;
  }
  .qr-area,
  .status {
    align-items: center;
    justify-content: center;
    width: 250px;
    height: 250px;
    padding: 8px;
    gap: 12px;
  }
  .qr-area {
    border: 2px dashed var(--border, #BBBBBB);
    border-radius: 8px;
  }
  .status.error {
    border-color: var(--error-fg, #CC0000);
  }
  .status.success > :global(.status) {
    max-width: 70%;
  }
  .instructions {
    justify-content: center;
  }
  li {
    margin-block-end: 6px;
    line-height: 1.4;
  }
  .instructions :global(.mock-button) {
    display: inline-block;
    border: 1px solid var(--border);
    padding: 0px 4px;
    margin: 2px 0px;
  }
</style>
