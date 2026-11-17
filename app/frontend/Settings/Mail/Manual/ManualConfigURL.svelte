<grid class="manual-config" full={stepFull}>
  <hbox class="header font-small"></hbox>
  <hbox class="label">{$t`Protocol`}</hbox>
  <hbox class="label">{$t`URL`}</hbox>
  {#if stepFull}
    <hbox class="label">{$t`Authentication method`}</hbox>
    <hbox class="label">{$t`Username`}</hbox>
    <hbox class="label">{$t`Password`}</hbox>
  {/if}

  <hbox class="header font-small">
    <hbox class="direction">
      <ServerIcon size={14} />
    </hbox>
    <hbox class="text">
      {$t`Server`}
    </hbox>
  </hbox>

  <hbox>
    <ProtocolSelector bind:config {isSetup} />
  </hbox>

  <hbox class="url" class:error={urlError}>
    <input type="url" bind:value={config.url} required />
  </hbox>

  {#if stepFull}
    <hbox class="authMethod" class:error={authError}>
      <select bind:value={config.authMethod} required>
        <option value={AuthMethod.Password}>{$t`Password`}</option>
        {#if $config.protocol == "ews"}
          <option value={AuthMethod.NTLM}>NTLM</option>
        {/if}
        <option value={AuthMethod.OAuth2}>OAuth2 / {$t`MFA *=> Multi-factor authentication`}</option>
      </select>
    </hbox>

    <hbox class="username">
      <input type="text" bind:value={config.username} />
    </hbox>

    <hbox class="password">
      <PasswordChange bind:password={config.password}  />
    </hbox>
  {/if}
</grid>

<script lang="ts">
  import type { MailAccount } from "../../../../logic/Mail/MailAccount";
  import { AuthMethod } from "../../../../logic/Abstract/Account";
  import { getOAuth2BuiltIn } from "../../../../logic/Auth/OAuth2Util";
  import { TLSSocketType } from "../../../../logic/Abstract/TCPAccount";
  import ProtocolSelector from "./ProtocolSelector.svelte";
  import PasswordChange from "../../Shared/PasswordChange.svelte";
  import ServerIcon from "lucide-svelte/icons/server";
  import { t } from "../../../../l10n/l10n";
  import { assert } from "../../../../logic/util/util";
  import { getStandardURL } from "../../../../logic/Mail/AutoConfig/configInfo";
  import { getDomainForEmailAddress } from "../../../../logic/util/netUtil";
  import { minorError } from "../../../Util/error";

  /** in/out */
  export let config: MailAccount;
  /** false = show hostnames only, true = show all fields.
   * in/out */
  export let stepFull: boolean;
  export let isSetup = false;

  let urlError: Error | null = null;
  let authError: Error | null = null;

  $: config?.protocol && !config.url && setDefaultURL();
  function setDefaultURL() {
    try {
      let domain = getDomainForEmailAddress(config.emailAddress);
      config.url = getStandardURL(config.protocol, domain);
    } catch (ex) {
      minorError(ex);
    }
  }

  /** User just pressed the [Next] button
   * @returns true = can continue, false or exception: Don't continue
   */
  export async function onContinue(): Promise<boolean> {
    if (!config.emailAddress) {
      throw new Error("Please enter the email address");
    }
    if (!config.url) {
      urlError = new Error("Please enter the correct URL");
      throw urlError;
    } else if (!config.url.startsWith("https://")) {
      urlError = new Error("URL must be https");
      throw urlError;
    } else {
      urlError = null;
      try {
        let hostname = new URL(config.url).hostname;
        // Office365 needs special handling
        if (hostname.endsWith(".office.com") || hostname.endsWith(".office365.com")) {
          config.authMethod = AuthMethod.OAuth2;
          if (config.protocol == "ews") {
            config.url = "https://outlook.office365.com/EWS/Exchange.asmx";
          } else if (config.protocol == "owa") {
            config.url = "https://outlook.office.com/owa/";
          } else if (config.protocol == "activesync") {
            config.url = "https://outlook.office365.com/Microsoft-Server-ActiveSync";
          }
        }
        let url = new URL(config.url);
        let path = url.pathname;
        if (config.protocol == "owa") {
          assert(path.toLowerCase().startsWith("/owa/"), "URL needs to contain /owa/");
        }
        if (config.protocol == "ews") {
          if (path.toLowerCase().startsWith("/owa/")) {
            url.pathname = "/EWS/Exchange.asmx";
            config.url = url.href;
          }
        }
      } catch (ex) {
        urlError = ex;
        throw ex;
      }
    }

    config.tls = TLSSocketType.TLS;
    config.port = 443;
    config.hostname = new URL(config.url).hostname;
    if (!stepFull) {
      stepFull = true;
      return false;
    }
    if (config.authMethod == AuthMethod.Unknown) {
      authError = new Error("Please enter the authentication method");
      throw authError;
    } else if (config.authMethod == AuthMethod.OAuth2) {
      config.oAuth2 ??= getOAuth2BuiltIn(config);
    } else {
      authError = null;
    }
    config.outgoing = null;
    return true;
  }
</script>

<style>
  grid {
    grid-auto-flow: column;
    grid-template-rows: auto auto auto;
    grid-auto-columns: max-content auto auto;
    row-gap: 12px;
  }
  grid[full=true] {
    grid-template-rows: auto auto auto auto auto auto;
  }
  grid :global(> *) {
    align-items: end;
  }

  /* Style */

  grid {
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-block-start: 24px;
    padding-block-end: 20px;
  }
  grid :global(.header) {
    background-color: var(--headerbar-bg);
    color: var(--headerbar-fg);
    padding-block-start: 8px;
    padding-block-end: 8px;
    padding-inline-start: 8px;
    border-bottom: 1px solid var(--border);
  }
  grid :global(> *) {
    padding-inline-start: 16px;
    padding-inline-end: 16px;
  }

  .header {
    align-items: center;
    font-weight: bold;
  }
  .header .direction {
    margin-inline-end: 6px;
    color: #555555;
  }
  .error select {
    border: 1px solid red;
  }
  .error input {
    border: 1px solid red;
  }
  select {
    min-width: 7em;
  }
  .authMethod select {
    width: 100%;
  }
</style>
