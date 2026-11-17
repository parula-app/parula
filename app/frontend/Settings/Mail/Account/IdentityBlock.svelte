<HeaderGroupBox>
  <hbox slot="header">{$identity.emailAddress || $t`New`}</hbox>
  <svelte:fragment slot="buttons-top-right">
    {#if canRemove}
      <RoundButton
        label={$t`Delete this identity`}
        onClick={onDelete}
        icon={DeleteIcon}
        />
    {/if}
  </svelte:fragment>
  <vbox class="content">
    <grid>
      <label for="realname">{$t`Your name`}</label>
      <input type="text" bind:value={identity.realname} name="realname" />

      <label for="emailaddress">{$t`Your email address`}</label>
      <input type="email" bind:value={identity.emailAddress} required
        bind:this={emailInput}
        autofocus={!$identity.emailAddress}
        name="emailaddress" class="emailaddress" />

      {#if identity.isCatchAll}
        <hbox />
        <hbox>
          <hbox class="catch-all">{$t`This is a catch-all email address.`}</hbox>
          <a href="{siteRoot}/link/catch-all" target="_blank">{$t`More info`}</a>
        </hbox>
      {/if}

      <!--
      <label for="picture">Profile picture</label>
      <img on:click={} name="picture" />
      -->

      {#if showReplyTo}
        <label for="replyto" class="reply-to">{$t`Reply-to address`}</label>
        <input type="email" bind:value={identity.replyTo} name="replyto" class="reply-to" />
      {/if}

      {#if showOrganisation}
        <label for="organisation">{$t`Company`}</label>
        <input type="text" bind:value={identity.organisation} name="organisation" />
      {/if}
    </grid>

    {#if showSignature}
      <vbox class="signature">
        {$t`Signature`}
        <vbox class="signature-editor-box">
          <HTMLEditorToolbar {editor} />
          <HTMLEditor bind:html={identity.signatureHTML} bind:editor />
          {#if showSentBy}
            <hbox class="sentBy">
              <div>
                {@html $t`Sent by © ${`<a href=${siteRoot} target="_blank" style="color: #20AE9E"><strong><em>${appName}</em></strong></a>`}`}
              </div>
              {#if !showSentByExplainer}
                <RoundButton
                  label={$t`Remove 'Sent by'`}
                  icon={RemoveIcon}
                  border={false}
                  padding="4px"
                  iconSize="12px"
                  onClick={() => showSentByExplainer = true}
                  />
              {/if}
            </hbox>
          {/if}
        </vbox>

        {#if showSentByExplainer}
          <SentByExplainer />
        {/if}
      </vbox>
    {/if}

    {#if showEncryption || showEncryptionOverride}
      <Encryption {identity} bind:showCreateOverride={showEncryptionOverride} />
    {/if}

    <ExpanderButtons>
      <ExpanderButton bind:expanded={showReplyTo} label={$t`Reply-To`} />
      <ExpanderButton bind:expanded={showOrganisation} label={$t`Organisation`} />
      <ExpanderButton bind:expanded={showSignature} label={$t`Signature`} />
      <ExpanderButton bind:expanded={showEncryption} label={$t`Encryption`} on:expand={addEcryption} />
    </ExpanderButtons>
  </vbox>
</HeaderGroupBox>

<script lang="ts">
  import type { MailIdentity } from "../../../../logic/Mail/MailIdentity";
  import { gLicense } from "../../../../logic/util/License";
  import SentByExplainer from "./SentByExplainer.svelte";
  import HTMLEditor from "../../../Shared/Editor/HTMLEditor.svelte";
  import HTMLEditorToolbar from "../../../Shared/Editor/HTMLEditorToolbar.svelte";
  import Encryption from "./Encryption.svelte";
  import ExpanderButton from "../../../Shared/ExpanderButton.svelte";
  import ExpanderButtons from "../../../Shared/ExpanderButtons.svelte";
  import HeaderGroupBox from "../../../Shared/HeaderGroupBox.svelte";
  import RoundButton from "../../../Shared/RoundButton.svelte";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import RemoveIcon from "lucide-svelte/icons/circle-x";
  import type { Editor } from "@tiptap/core";
  import { appName, siteRoot } from "../../../../logic/build";
  import { isLicensed } from "../../../../logic/util/LicenseClient";
  import { catchErrors } from "../../../Util/error";
  import { checkInputField } from "../../../Util/util";
  import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";
  import { t } from "../../../../l10n/l10n";
  import { createEventDispatcher, onMount } from 'svelte';
  const dispatchEvent = createEventDispatcher();

  export let identity: MailIdentity;
  export let canRemove = true;

  let showReplyTo = !!identity.replyTo;
  let showOrganisation = !!identity.organisation;
  let showSignature = !!identity.signatureHTML;
  let showSentBy = !gLicense.license;
  let showSentByExplainer = false;
  $: keys = identity.encryptionPrivateKeys;
  $: showEncryption = $keys.hasItems;
  let showEncryptionOverride = false;
  let editor: Editor;
  let emailInput: HTMLInputElement;
  $: $identity.emailAddress && checkInputField(() => sanitize.emailAddress($identity.emailAddress.replace("*", "any")), emailInput);

  function addEcryption() {
    showEncryptionOverride = true;
  }

  function onDelete() {
    dispatchEvent("delete", identity);
  }

  $: clearSig(identity.signatureHTML);
  function clearSig(_dummy: any) {
    if (identity.signatureHTML == "<p></p>") {
      identity.signatureHTML = null;
    }
  }

  onMount(() => catchErrors(async () => {
    showSentBy = !await isLicensed();
  }));
</script>

<style>
  grid {
    grid-template-columns: max-content auto;
    gap: 8px 24px;
    max-width: 30em;
  }
  .emailaddress:invalid {
    background-color: #FFF160;
    color: black;
  }
  .catch-all {
    font-style: italic;
    margin-inline-end: 1em;
  }
  .reply-to {
    margin-block-start: 32px;
  }
  .signature {
    margin-block-start: 32px;
  }
  .signature-editor-box {
    border: 1px solid var(--border);
    border-radius: 5px;
    margin-block-start: 4px;
  }
  .signature :global(.html-editor) {
    min-height: 5em;
    padding: 8px;
  }
  .sentBy {
    padding: 8px 16px;
  }
  .sentBy :global(button) {
    margin-inline-start: 12px;
  }
  .content :global(.expander-buttons) {
    margin-block-start: 38px;
  }
</style>
