<Header
  title={$t`Set up your existing XMPP account`}
  subtitle={$t`Import your existing XMPP or Jabber account`}
/>
{#if errorMessage}
  <ErrorMessage {errorMessage} errorGravity={ErrorGravity.Error}
    on:continue={() => errorMessage = null} />
{/if}
<vbox flex class="account">
  <grid>
    <label for="username">{$t`Your JID`}</label>
    <input type="text" bind:value={jid} name="username"
      placeholder="fred@example.com" autofocus />
    <label for="password">{$t`Password`}</label>
    <Password bind:password={config.password} />
  </grid>
</vbox>

{#if error}
  <ErrorMessageInline ex={error} />
{/if}

<ButtonsBottom
  onContinue={onContinue}
  canContinue={!!config.username && !!config.password}
  canCancel={true}
  onCancel={onCancel}
  errorCallback={showError}
  />

<script lang="ts">
  import type { XMPPAccount } from "../../../logic/Chat/XMPP/XMPPAccount";
  import { appGlobal } from "../../../logic/app";
  import Password from "../Shared/Password.svelte";
  import ButtonsBottom from "../Shared/ButtonsBottom.svelte";
  import Header from "../Shared/Header.svelte";
  import { t } from "../../../l10n/l10n";
  import ErrorMessage, { ErrorGravity } from "../../Shared/ErrorMessage.svelte";
  import { logErrorToServer } from "../../Util/error";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";

  /** in/out */
  export let config: XMPPAccount;
  /** out */
  export let showPage: ConstructorOfATypedSvelteComponent;
  export let onCancel = (event: Event) => undefined;

  let error: Error | null = null;
  let jid: string;
  $: setUsername(jid);
  function setUsername(_dummy: any) {
    if (!jid) {
      return;
    }
    config.username = jid;
    config.name = jid;
    config.realname = appGlobal.me.name ?? config.username;
    /* If `config.url` is not set, finds the URL using `/.well-known/host-meta.json`
    config.hostname = getDomainForEmailAddress(jid);
    config.port = 5281;
    config.tls = TLSSocketType.TLS;
    config.url = `wss://${config.hostname}/...`; */
  }

  async function onContinue() {
    try {
      error = null;
      await config.loginAndStartup(true);
      await config.save();
      appGlobal.chatAccounts.add(config);
      showPage = null;
    } catch (ex) {
      error = ex;
    }
  }

  let errorMessage: string | null = null;
  function showError(ex: Error) {
    console.error(ex);
    logErrorToServer(ex);
    errorMessage = ex.message ?? ex + "";
  }
</script>

<style>
  grid {
    grid-template-columns: max-content auto;
    align-items: center;
    margin: 32px;
    gap: 8px 24px;
  }
</style>
