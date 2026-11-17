<Header
  title={$t`Set up your existing Matrix account`}
  subtitle={$t`Import your existing Matrix account`}
/>
<vbox flex class="account">
  <grid>
    <label for="username">{$t`Your Matrix ID`}</label>
    <input type="text" bind:value={userID} name="username"
      placeholder="@fred:matrix.org" autofocus />
    <label for="password">{$t`Password`}</label>
    <Password bind:password />
  </grid>
</vbox>

{#if error}
  <ErrorMessageInline ex={error} />
{/if}

<ButtonsBottom
  onContinue={onContinue}
  canContinue={!!config.username && !!config.baseURL}
  canCancel={true}
  onCancel={onCancel}
  />

<script lang="ts">
  import type { MatrixAccount } from "../../../logic/Chat/Matrix/MatrixAccount";
  import { appGlobal } from "../../../logic/app";
  import MatrixVerify from "./MatrixVerify.svelte";
  import Password from "../Shared/Password.svelte";
  import ButtonsBottom from "../Shared/ButtonsBottom.svelte";
  import Header from "../Shared/Header.svelte";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import { t } from "../../../l10n/l10n";

  /** in/out */
  export let config: MatrixAccount;
  /** out */
  export let showPage: ConstructorOfATypedSvelteComponent;
  export let onCancel = (event: Event) => undefined;

  let error: Error | null = null;
  let password: string;
  let userID: string;
  $: splitJID(userID);
  function splitJID(_dummy: any) {
    if (!userID?.startsWith("@")) {
      return;
    }
    let sp = userID?.substring(1).split(":");
    if (!sp || !sp.length || sp.length > 2) {
      return;
    }
    config.username = sp[0];
    config.baseURL = sp[1] ? "https://" + sp[1] : "https://matrix.org";
    config.name = userID;
    config.realname = appGlobal.me.name;
  }

  async function onContinue() {
    try {
      error = null;
      config.password = password;
      await config.deleteAllKeys();

      //await config.login(true);
      //showPage = MatrixVerify;

      // or, until the crypto key recovery works:
      await config.loginAndStartup(true);
      await config.save();
      appGlobal.chatAccounts.add(config);
      showPage = null;
    } catch (ex) {
      await config.deleteAllKeys();
      error = ex;
    }
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
