<Header
  title={$t`Set up your existing Wire account`}
  subtitle={$t`Import your existing Wire account`}
/>

{#if ssoSession}
  <WireSSOLogin session={ssoSession} code={ssoCode} account={config}
    onContinue={onSSOLoggedIn} onCancelled={() => ssoSession = null} />
{:else}
  <vbox flex class="account">
    <grid>
      <label for="url">{$t`Chat server`}</label>
      <input type="url" bind:value={config.url} name="url"
        placeholder={kWireBackendURL} />
      {#if useSSO}
        <label for="ssoCode">{$t`Login code`}</label>
        <input type="text" bind:value={ssoCode} name="ssoCode"
          placeholder="wire-00000000-0000-0000-0000-000000000000" autofocus />
      {:else}
        <label for="username">{$t`Email address`}</label>
        <input type="email" bind:value={emailAddress} name="username"
          placeholder="fred@example.com" autofocus />
        <label for="password">{$t`Password`}</label>
        <Password bind:password={config.password} />
      {/if}
      {#if verificationCodeNeeded}
        <label for="verificationCode">{$t`Verification code`}</label>
        <input type="text" bind:value={verificationCode} name="verificationCode"
          placeholder="123456" />
      {/if}
    </grid>
    <hbox class="sso">
      <Button label={useSSO ? $t`Log in with your password` : $t`Log in with single sign-on`}
        plain onClick={() => useSSO = !useSSO} />
    </hbox>
  </vbox>

  {#if error}
    <ErrorMessageInline ex={error} />
  {/if}

  <ButtonsBottom
    onContinue={onContinue}
    canContinue={canContinue}
    canCancel={true}
    onCancel={onCancel}
    />
{/if}

<script lang="ts">
  import type { WireAccount } from "../../../logic/Chat/Wire/WireAccount";
  import type { WireSession } from "../../../logic/Chat/Wire/WireSession";
  import WireSSOLogin from "./WireSSOLogin.svelte";
  import Password from "../Shared/Password.svelte";
  import ButtonsBottom from "../Shared/ButtonsBottom.svelte";
  import Header from "../Shared/Header.svelte";
  import Button from "../../Shared/Button.svelte";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import { appGlobal } from "../../../logic/app";
  import { t } from "../../../l10n/l10n";

  /** in/out */
  export let config: WireAccount;
  /** out */
  export let showPage: ConstructorOfATypedSvelteComponent;
  export let onCancel = (event: Event) => undefined;

  /** Wire's own production backend. A team on its own server has a login code
   * or a deeplink that names theirs instead. */
  const kWireBackendURL = "https://prod-nginz-https.wire.com";

  let error: Error | null = null;
  let emailAddress: string;
  let useSSO = false;
  let ssoCode: string;
  /** Set once the identity provider's login page is showing */
  let ssoSession: WireSession | null = null;
  /** The backend mailed a 6-digit code and wants it back */
  let verificationCodeNeeded = false;
  let verificationCode: string;
  let verificationCodeEntered: (code: string) => void;

  $: config.url ||= kWireBackendURL;
  $: emailAddress, setUsername();
  function setUsername() {
    if (!emailAddress) {
      return;
    }
    config.username = emailAddress;
    config.name = emailAddress;
    config.realname = appGlobal.me.name ?? emailAddress;
  }

  $: canContinue = useSSO
    ? !!config.url && !!ssoCode
    : !!config.url && !!emailAddress && !!config.password;

  async function onContinue() {
    try {
      error = null;
      if (useSSO) {
        startSSO();
        return;
      }
      config.onVerificationCode = askVerificationCode;
      await config.login(true);
      await finish();
    } catch (ex) {
      error = ex;
    }
  }

  /** Hands over to the identity provider's own login page. It comes back to a
   * private URL of ours that carries the session cookie, and then the rest of
   * the login is the same as with a password. */
  function startSSO() {
    config.ssoCode = ssoCode;
    config.setup();
    ssoSession = config.session;
  }

  async function onSSOLoggedIn() {
    try {
      ssoSession = null;
      await config.login(true);
      await finish();
    } catch (ex) {
      error = ex;
    }
  }

  async function finish() {
    await config.save();
    appGlobal.chatAccounts.add(config);
    showPage = null;
  }

  /** The 2FA code that the backend just mailed to the user */
  function askVerificationCode(): Promise<string> {
    verificationCodeNeeded = true;
    return new Promise<string>(resolve => {
      verificationCodeEntered = resolve;
    });
  }

  $: verificationCode?.length == 6 && verificationCodeEntered?.(verificationCode);
</script>

<style>
  grid {
    grid-template-columns: max-content auto;
    align-items: center;
    margin: 32px;
    gap: 8px 24px;
  }
  .sso {
    margin-inline: 32px;
  }
</style>
