<Header
  title={$t`Verify using existing device`}
  subtitle={$t`To access your old messages, you need to confirm this new device, using one of your existing devices that are logged in to this Matrix account.`}
/>

{#if error}
  <ErrorMessageInline ex={error} />
{:else if sas}
  <vbox flex class="verify">
    <hbox class="instructions">{$t`Check your other device that is logged in with the same Matrix account, and compare the emojis. If they are the same, confirm the connection.`}</hbox>

    {emojis}

    <hbox class="buttons">
      <Button
        label={$t`Confirm`}
        icon={ConfirmIcon}
        onClick={onConfirm}
        />
    </hbox>
  </vbox>
{:else}
  <Loader />
{/if}

<ButtonsBottom
  onContinue={onContinue}
  canContinue={!!config.username && !!config.baseURL}
  canCancel={true}
  onCancel={cancel}
  />

<script lang="ts">
  import type { MatrixAccount } from "../../../logic/Chat/Matrix/MatrixAccount";
  import { appGlobal } from "../../../logic/app";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import Header from "../Shared/Header.svelte";
  import ButtonsBottom from "../Shared/ButtonsBottom.svelte";
  import Button from "../../Shared/Button.svelte";
  import ConfirmIcon from "lucide-svelte/icons/check";
  import { catchErrors } from "../../Util/error";
  import { t } from "../../../l10n/l10n";
  import { onMount } from "svelte";
  import type { ShowSasCallbacks, VerificationRequest, VerificationRequestEvent, Verifier } from "matrix-js-sdk/lib/crypto-api";
  import Loader from "../../Shared/Loader.svelte";

  /** in/out */
  export let config: MatrixAccount;
  /** out */
  export let showPage: ConstructorOfATypedSvelteComponent;
  export let onCancel: (event: Event) => undefined;

  $: acc = config;
  let error: Error | null = null;
  onMount(() => catchErrors(load, ex => error = ex));

  let verification: VerificationRequest;
  let verifier: Verifier;
  let sas: ShowSasCallbacks;
  let emojis: string;

  async function load() {
    let client = acc.client;
    await acc.cryptoSetup();
    await client.downloadKeysForUsers([client.getUserId()]);
    console.log(client.getCrypto().isCrossSigningReady(), "ready for cross signing");
    verification = await client.getCrypto().requestOwnUserVerification();
    verifier = await verification.startVerification("m.sas.v1");
    sas = verifier.getShowSasCallbacks();
    emojis = sas.sas.emoji.map(mapping => mapping[0]).join();

    //let qrCode = await verification.generateQRCode();
    /*
    let request = await acc.waitForEventMatching("VerificationRequest", ev => ev.isSelfVerification());
    if (request.isSelfVerification())
    request.accept();
    //await acc.cryptoSetup();
    verification = await acc.client.getCrypto().requestOwnUserVerification();
    */
  }

  async function onConfirm() {
    await sas.confirm();
    await onContinue();
  }

  async function onContinue() {
    try {
      await config.loginAndStartup(true);
      await config.save();
      appGlobal.chatAccounts.add(config);
      showPage = null;
    } catch (ex) {
      error = ex;
    }
  }

  async function cancel(event: Event) {
    sas?.cancel();
    await verification.cancel();
    onCancel(event);
  }
</script>

<style>
  .buttons {
    align-items: start;
  }
</style>
