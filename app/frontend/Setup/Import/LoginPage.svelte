{#if account}
  <Header title={account.name} subtitle={account.emailAddress} />

  {#if account?.oAuth2}
    <OAuth2Login {account}
      onContinue={() => catchErrors(loginOAuth2, showError)}
      onCancel={onSkip}
      onError={showError} />
  {:else}
    <hbox class="password-row">
      <label for="password">{$t`Password`}</label>
      <Password bind:password
        autofocus={true}
        on:continue={() => catchErrors(validateAccount, showError)} />
    </hbox>
  {/if}

  <hbox class="spacer1" flex />

  {#if validating}
    <StatusMessage status="processing"
      message={$t`Verifying that the configuration works...`} />
  {/if}
  {#if errorMessage}
    <ErrorMessage {errorMessage} errorGravity={ErrorGravity.Error}
      on:continue={() => errorMessage = null} />
  {/if}

  <hbox class="spacer2" flex />
{/if}

<ButtonsBottom
  canContinue={havePassword && !validating}
  onContinue={validateAccount}
  errorCallback={showError}
  >
  <Button label="Back" classes="secondary"
    onClick={onBack}
    />
  <Button label="Skip" classes="secondary"
    onClick={onSkip}
    />
</ButtonsBottom>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { checkConfig } from "../../../logic/Mail/AutoConfig/checkConfig";
  import { saveAndInitConfig } from "../../../logic/Mail/AutoConfig/saveConfig";
  import Password from "../Shared/Password.svelte";
  import OAuth2Login from "../Shared/OAuth2Login.svelte";
  import Header from "../Shared/Header.svelte";
  import StatusMessage from "../Shared/StatusMessage.svelte";
  import ErrorMessage, { ErrorGravity } from "../../Shared/ErrorMessage.svelte";
  import ButtonsBottom from "../Shared/ButtonsBottom.svelte";
  import Button from "../../Shared/Button.svelte";
  import { Cancelled } from "../../../logic/util/flow/Abortable";
  import { catchErrors, logErrorToServer } from "../../Util/error";
  import { t } from "../../../l10n/l10n";

  export let account: MailAccount;
  export let onContinue = () => undefined;
  export let onSkip = () => undefined;
  export let onBack = () => undefined;

  let password = "";
  let oAuth2Succeeded = false;
  $: havePassword = password || oAuth2Succeeded;
  let validating = false;
  let validated = false;
  let errorMessage: string = null;
  $: console.log("account", account);
  resetForAccount();

  $: password, onPasswordChanged();
  function onPasswordChanged() {
    validated = false;
  }

  async function loginOAuth2() {
    await account.oAuth2.login(true);
    oAuth2Succeeded = true;
    await validateAccount();
  }

  async function validateAccount() {
    try {
      validating = true;
      await checkConfig(account, account.emailAddress, password);
    } finally {
      validating = false;
    }
    validated = true;
    await saveAndInitConfig(account, account.emailAddress, password);
    onContinue();
  }

  $: account && resetForAccount();
  function resetForAccount() {
    errorMessage = null;
    validated = false;
    validating = false;
    password = null;
    oAuth2Succeeded = false;
  }

  function showError(ex: Error | string) {
    if (typeof (ex) == "string") {
      ex = new Error(ex);
    }
    if (ex instanceof Cancelled) {
      return;
    }
    console.error(ex);
    logErrorToServer(ex);
    errorMessage = ex.message;
  }
</script>

<style>
  .password-row {
    align-items: center;
  }
  .password-row label {
    margin-inline-end: 24px;
  }
  .password-row :global(input) {
    min-width: 30em;
  }
  .spacer1,
  .spacer2 {
    min-height: 5vh;
  }
</style>
