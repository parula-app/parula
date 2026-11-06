{#if signed || encrypted}
  <hbox class="signed key-{trustLevel} plain">
    <RoundButton
      label={msg}
      icon={encrypted && signed ? EncryptedIcon : signed ? SignedIcon : EncryptedUnsignedIcon}
      onClick={openSigningKey}
      iconSize="12px"
      padding="2px"
      border={false}
      />
  </hbox>
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { PublicKey } from "../../../logic/Mail/Encryption/PublicKey";
  import { TrustLevel } from "../../../logic/Mail/Encryption/enums";
  import { getPublicKeyByKeyID } from "../../../logic/Mail/Encryption/KeyUtils";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import SignedIcon from "lucide-svelte/icons/signature";
  import EncryptedIcon from "lucide-svelte/icons/lock";
  import EncryptedUnsignedIcon from "lucide-svelte/icons/shield-question-mark";
  import { showError } from "../../Util/error";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;
  /** out */
  export let isExpanded = false;

  let signingKey: PublicKey;
  $: getPublicKeyByKeyID($message.signedByKeyID, message)
    .then(key => signingKey = key)
    .catch(showError);
  $: signed = $message.signedByKeyID && signingKey && $signingKey.trustLevel != TrustLevel.Distrusted;
  $: encrypted = $message.wasEncrypted;
  $: trustLevel = $signingKey?.trustLevel == TrustLevel.Distrusted ? "none" : $signingKey?.trustLevel ?? "none";
  $: keyName = $signingKey?.name ?? $message.signedByKeyID?.substring(2, 6);
  $: msg = signed && encrypted
      ? $t`This message was end-to-end-encrypted to you, and signed by ${$message.from?.name ?? $t`somebody`} with ${signingKey?.system} key ${keyName}`
      : signed
        ? $t`This message was signed with ${signingKey?.system} key ${keyName}`
        : $t`This message was end-to-end-encrypted, but not signed`;

  function openSigningKey() {
    isExpanded = !isExpanded;
  }
</script>

<style>
  .signed {
    align-items: start;
    margin-inline-start: 8px;
    margin-block-start: 3px;
  }
  .signed :global(.button) {
    border-radius: var(--border-radius);
  }
  .signed.key-none :global(.button) {
    display: none;
    /*background-color: red;
    color: white;*/
  }
  .signed.key-sender :global(.button) {
    background-color: yellow;
    color: black;
  }
  .signed.key-third-party :global(.button) {
    background-color: blue;
    color: white;
    stroke-width: 3px;
  }
  .signed.key-personal :global(.button) {
    background-color: green;
    color: white;
  }
  .signed.key-third-party :global(.button) {
    background-color: blue;
    color: white;
  }
  .signed.key-none :global(.button svg),
  .signed.key-third-party :global(.button svg),
  .signed.key-personal :global(.button svg) {
    stroke-width: 3px;
  }
</style>
