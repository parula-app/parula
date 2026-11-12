  <hbox class="header">
    <hbox class="direction">
      {#if outgoing}
          <ArrowLeftIcon size={14} />
      {:else}
          <ArrowRightIcon size={14} />
      {/if}
    </hbox>
    <hbox class="text">
      {#if outgoing}
          {$t`Outgoing server`}
      {:else}
          {$t`Incoming server`}
      {/if}
    </hbox>
  </hbox>

  {#if outgoing}
    <hbox class="protocol outgoing">{config.protocol}</hbox>
  {:else}
    <hbox>
      <ProtocolSelector bind:config {isSetup} on:newProtocol={onProtocolChanged} tabindex={1} />
    </hbox>
  {/if}

  <hbox class="hostname" class:error={hostnameError} class:outgoing>
    <input type="text" bind:value={config.hostname} required
      tabindex={2}
      autofocus={!outgoing}
      on:input={onHostnameChanged}
      on:keydown={event => catchErrors(() => onKeyInHostname(event))}
      />
  </hbox>

  {#if stepFull}
    <hbox class="port" class:error={portError} class:outgoing class:incoming={!outgoing}>
      <input type="number" bind:value={config.port} required on:change={onPortChanged} tabindex={3} />
      {#if !isStandardPort && defaultPort}
        <hbox class="default">{$t`Default: ${defaultPort}`}</hbox>
      {/if}
    </hbox>

    <vbox class="tls" class:error={tlsError} tls={config.tls}>
      {#if tlsWarning}
        <div class="tls-warning">
          {tlsWarning}
        </div>
      {/if}
      {#if hasCertError || config.acceptBrokenTLSCerts}
        <vbox class="cert-error-override" class:checked={config.acceptBrokenTLSCerts}>
          <Checkbox bind:checked={config.acceptBrokenTLSCerts} label={$t`Do not check where you connect to`} />
        </vbox>
      {/if}
      <hbox class="row">
        <select bind:value={config.tls} required on:change={onTLSChanged} tabindex={4}>
          <option value={TLSSocketType.TLS}>TLS</option>
          <option value={TLSSocketType.STARTTLS}>STARTTLS</option>
          <option value={TLSSocketType.Plain}>{$t`Unprotected`}</option>
        </select>
        <hbox class="tls-icon">
          {#if config.tls == TLSSocketType.Unknown}
            <ShieldQuestionIcon size={20} />
          {:else if noEncryption(config.tls)}
            <ShieldAlertIcon size={20} />
          {:else}
            <ShieldOKIcon size={20} />
          {/if}
        </hbox>
      </hbox>
    </vbox>

    <hbox class="authMethod" class:error={authError}>
      <select bind:value={config.authMethod} required tabindex={5}>
        <option value={AuthMethod.Password}>{$t`Password`}</option>
        <option value={AuthMethod.OAuth2}>OAuth2 / {$t`MFA *=> Multi-factor authentication`}</option>
        <!--
        <option value={AuthMethod.GSSAPI}>Kerberos / GSSAPI</option>
        <option value={AuthMethod.NTLM}>NTLM</option>
        -->
        <option value={AuthMethod.CRAMMD5}>CRAM-MD5</option>
        {#if config.protocol == "smtp"}
          <option value={AuthMethod.None}>{$t`No authentication`}</option>
        {/if}
      </select>
    </hbox>

    <hbox class="username">
      {#if config.authMethod != AuthMethod.None}
        <input type="text" bind:value={config.username} tabindex={6} />
      {/if}
    </hbox>

    <hbox class="password">
      {#if config.authMethod != AuthMethod.None}
        <PasswordChange bind:password={config.password} tabindex={7} />
      {/if}
    </hbox>
  {/if}

<script lang="ts">
  import type { MailAccount } from "../../../../logic/Mail/MailAccount";
  import { AuthMethod } from "../../../../logic/Abstract/Account";
  import { TLSSocketType } from "../../../../logic/Abstract/TCPAccount";
  import { kStandardPorts } from "../../../../logic/Mail/AutoConfig/configInfo";
  import { dummyHostname } from "../../../../logic/Mail/AutoConfig/manualConfig";
  import { getDomainForEmailAddress } from "../../../../logic/util/netUtil";
  import { isCertError } from "../../../../logic/Mail/AutoConfig/checkConfig";
  import { getOAuth2BuiltIn } from "../../../../logic/Auth/OAuth2Util";
  import ProtocolSelector from "./ProtocolSelector.svelte";
  import PasswordChange from "../../Shared/PasswordChange.svelte";
  import Checkbox from "../../../Shared/Checkbox.svelte";
  import ShieldOKIcon from "lucide-svelte/icons/shield-check";
  import ShieldAlertIcon from "lucide-svelte/icons/shield-alert";
  import ShieldQuestionIcon from "lucide-svelte/icons/shield-question";
  import ArrowLeftIcon from "lucide-svelte/icons/move-left";
  import ArrowRightIcon from "lucide-svelte/icons/move-right";
  import { gt, t } from "../../../../l10n/l10n";
  import { UserError } from "../../../../logic/util/util";
  import { catchErrors } from "../../../Util/error";
  import { createEventDispatcher, tick } from 'svelte';
  import { AppWindow } from "../../../MainWindow/AppWindow";
  const dispatchEvent = createEventDispatcher<{ continue: void }>();
  const appWindow = AppWindow.current();

  /** in/out */
  export let config: MailAccount;
  /** false = show hostnames only, true = show all fields.
   * in/out */
  export let stepFull: boolean;
  export let isSetup = false;

  $: outgoing = config.protocol == "smtp";

  /** Error that happened during checkConfig() */
  $: hasCertError = isCertError(config.fatalError);

  function noEncryption(tls: TLSSocketType): boolean {
    return tls != TLSSocketType.Unknown && tls != TLSSocketType.TLS && tls != TLSSocketType.STARTTLS || config.acceptBrokenTLSCerts;
  }

  $: tlsWarning = noEncryption(config.tls) ? gt`Attackers can read your password and mails` : null;

  function onTLSChanged() {
    let newP = kStandardPorts.find(p => p.protocol == config.protocol && p.tls == config.tls);
    let oldIsStandardPort = kStandardPorts.find(p => p.port == config.port); // even if wrong protocol, e.g. just changed protocol, or confused user
    let oldPortStillValid = kStandardPorts.find(p => p.port == config.port && p.protocol == config.protocol && p.tls == config.tls); // Port 25, TLS changed -> keep port
    if (newP && (oldIsStandardPort && !oldPortStillValid || !config.port)) {
      config.port = newP.port;
    }
  }

  function onPortChanged() {
    let newPreferred = kStandardPorts.find(p => p.protocol == config.protocol && p.port == config.port);
    if (newPreferred && !isStandardPort) {
      config.tls = newPreferred.tls;
    }
  }

  $: defaultPort = kStandardPorts.find(p => p.protocol == config.protocol && p.tls == config.tls)?.port;
  $: isStandardPort = !!kStandardPorts.find(p => p.protocol == config.protocol && p.port == config.port && p.tls == config.tls); // also allow SMTP 25

  function onProtocolChanged() {
    onTLSChanged();
    onPortChanged();
  }

  function onHostnameChanged() {
    if (!stepFull && config.outgoing && !outgoing) {
      config.outgoing.hostname = config.hostname;
    }
  }

  async function onKeyInHostname(event: KeyboardEvent) {
    if (!(event.key == "Enter" || event.key == "Tab") || event.shiftKey || event.ctrlKey || event.altKey) {
      return;
    }
    event.preventDefault();
    if (!stepFull && outgoing) {
      // Expand all fields
      // `onContinue()` here only expands one of outgoing/incoming, not both, so need to call parent
      dispatchEvent("continue");
      await tick();
    }
    // Move to next field: outgoing hostname, or corresponding port
    let selector = stepFull
      ? ".incoming.port input"
      : ".outgoing.hostname input";
    let inputE = appWindow.window.document.querySelector(selector) as HTMLInputElement;
    console.log("next field", selector, inputE);
    if (!inputE) {
      return;
    }
    inputE.focus();
    inputE.select();
  }

  let hostnameError: Error | null = null;
  let portError: Error | null = null;
  let tlsError: Error | null = null;
  let authError: Error | null = null;

  /** User just pressed the [Next] button
   * @returns true = can continue, false or exception: Don't continue
   */
  export async function onContinue(): Promise<boolean> {
    if (!config.emailAddress) {
      throw new UserError(gt`Please enter the email address`);
    }
    let domain = getDomainForEmailAddress(config.emailAddress);
    if (!config.hostname || config.hostname == dummyHostname(domain)) {
      hostnameError = new UserError(gt`Please enter the correct hostname`);
      throw hostnameError;
    } else {
      hostnameError = null;
    }
    if (!stepFull) {
      stepFull = true;
      return false;
    }
    // TODO validate hostname (throw if not reachable), guess config, cache the result, and fill in the fields
    if (config.tls == TLSSocketType.Unknown) {
      tlsError = new UserError(gt`Please set the correct connection encryption`);
      throw tlsError;
    } else {
      tlsError = null;
    }
    if (!config.port) {
      portError = new UserError(gt`Please enter the correct port number`);
      throw portError;
    } else {
      portError = null;
    }
    if (config.authMethod == AuthMethod.Unknown) {
      authError = new UserError(gt`Please enter the authentication method`);
      throw authError;
    } else if (config.authMethod == AuthMethod.OAuth2) {
      config.oAuth2 ??= getOAuth2BuiltIn(config);
    } else {
      authError = null;
    }
    if (config.hostname?.endsWith("example.com")) { // TODO replace with real checks
      throw new UserError(gt`Please enter the correct hostname`);
    }
    return true;
  }
</script>

<style>
  .header {
    align-items: center;
    font-weight: bold;
  }
  .header .direction {
    margin-inline-end: 6px;
    color: #555555;
  }
  .protocol.outgoing {
    text-transform: uppercase;
  }
  .hostname input {
    min-width: 15em;
  }
  .port .default {
    color: #555555;
    margin-inline-start: 8px;
  }
  .tls {
    align-items: start;
    justify-content: end;
  }
  .tls-icon {
    margin-inline-start: 8px;
  }
  .tls[tls="0"] .tls-icon :global(svg) {
    stroke: grey;
  }
  .tls[tls="2"] .tls-icon :global(svg),
  .tls[tls="3"] .tls-icon :global(svg) {
    stroke: green;
  }
  .tls[tls="1"] .tls-icon :global(svg) {
    stroke: red;
  }
  .tls-warning {
    color: red;
    margin-block-start: 4px;
    margin-block-end: 8px;
    max-width: 12em;
  }
  .cert-error-override {
    margin-block-end: 12px;
  }
  .cert-error-override.checked {
    color: red;
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
  .port input[type=number] {
    width: 6em;
  }
</style>
