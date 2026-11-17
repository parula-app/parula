{#if privateKey}
  <hbox class="encryption buttons"
    class:encrypt={mail.shouldEncrypt}
    style="--trustColor: {trustColor[trustLevel]}; --trustColorFG: {trustColorFG[trustLevel]}">
    <ButtonMenu bind:isMenuOpen>
      <RoundButton
        label={$t`Sign or encrypt`}
        tooltip={signDisabledReason ?? encryptDisabledReason ?? mail.shouldEncrypt ? $t`Encrypt and sign` : mail.signedByKeyID ? $t`Sign digitally` : $t`Sign or encrypt`}
        icon={mail.shouldEncrypt ? EncryptIcon : mail.signedByKeyID ? SignIcon : NoEncryptIcon}
        selected={!!mail.signedByKeyID || mail.shouldEncrypt}
        onClick={() => isMenuOpen = !isMenuOpen}
        disabled={mail.mustEncrypt || !!signDisabledReason && !!encryptDisabledReason}
        classes="plain"
        border={false}
        iconSize="16px"
        padding="4px"
        tabindex={2}
        slot="control"
        />
      <MenuItem
        label={$t`Don't encrypt nor sign`}
        icon={NoneIcon}
        selected={!mail.signedByKeyID && !mail.shouldEncrypt}
        onClick={onDisableBoth}
        classes="nothing"
        iconSize="16px"
        tabindex={2}
        />
      <MenuItem
        label={$t`Sign digitally`}
        tooltip={signDisabledReason ?? $t`This proves that I wrote this email`}
        icon={SignIcon}
        selected={!!mail.signedByKeyID}
        onClick={toggleSigned}
        disabled={!!signDisabledReason}
        classes="sign"
        iconSize="16px"
        tabindex={2}
        />
      <MenuItem
        label={$t`Encrypt`}
        tooltip={encryptDisabledReason ?? $t`This ensures that only the recipients can read the email`}
        icon={EncryptIcon}
        selected={mail.shouldEncrypt}
        onClick={toggleEncrypted}
        disabled={!!encryptDisabledReason}
        classes="encrypt"
        iconSize="16px"
        tabindex={2}
        />
    </ButtonMenu>
  </hbox>
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { MailIdentity } from "../../../logic/Mail/MailIdentity";
  import { getMyPrivateKey, getPublicKeyForPersonUID } from "../../../logic/Mail/Encryption/KeyUtils";
  import type { PublicKey } from "../../../logic/Mail/Encryption/PublicKey";
  import { TrustLevel, trustColor, trustColorFG, trustOrder } from "../../../logic/Mail/Encryption/enums";
  import ButtonMenu from "../../Shared/Menu/ButtonMenu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import SignIcon from "lucide-svelte/icons/signature";
  import EncryptIcon from "lucide-svelte/icons/lock";
  import NoEncryptIcon from "lucide-svelte/icons/lock-open";
  import NoneIcon from "lucide-svelte/icons/circle-off";
  import { openSettingsCategoryForAccount } from "../../Settings/Window/CategoriesUtils";
  import { every } from "../../../logic/util/collections";
  import { showError } from "../../Util/error";
  import { assert, UserError } from "../../../logic/util/util";
  import { t, gt } from "../../../l10n/l10n";
  import type { Collection } from "svelte-collections";

  export let mail: EMail;
  export let identity: MailIdentity;

  $: privateKey = getMyPrivateKey(identity);
  $: signDisabledReason = privateKey ? null : gt`No secret keys enabled for signing`;
  $: to = mail.to;
  $: cc = mail.cc;
  $: allRecipients = $to.concat($cc);
  $: allRecipientsKeys = $allRecipients.map(p => getPublicKeyForPersonUID(p));
  $: trustLevel = mail.shouldEncrypt ? lowestTrust($allRecipientsKeys) : TrustLevel.Personal;
  $: encryptDisabledReason =
    $mail.mustEncrypt
    ? gt`Policy requires that this email stays encrypted, to keep protect secret information`
    : null; // Enable even if some recipients don't have public keys. Our UI warns and allows to resolve it.

  let isMenuOpen = false;

  let extra = mail as any;
  $: privateKey, changedIdentity()
  function changedIdentity() {
    if (privateKey) {
      if (!mail.signedByKeyID && privateKey.useToSign) {
        mail.signedByKeyID = privateKey.id;
        extra.signOnlyByDefault = true;
      }
      if (!mail.shouldEncrypt && privateKey.encryptByDefault) {
        mail.shouldEncrypt = true;
        extra.encryptOnlyByDefault = true;
      }
      if (mail.signedByKeyID && extra.signOnlyByDefault && !privateKey.useToSign) {
        mail.signedByKeyID = null;
        extra.signOnlyByDefault = false;
      }
      if (mail.shouldEncrypt && extra.encryptOnlyByDefault && !privateKey.encryptByDefault) {
        mail.shouldEncrypt = null;
        extra.encryptOnlyByDefault = false;
      }
    } else {
      assert(!mail.mustEncrypt, gt`This email must be encrypted.`);
      mail.shouldEncrypt = false;
      mail.signedByKeyID = null;
    }
  }

  function toggleSigned() {
    if (mail.mustEncrypt) {
      return;
    }
    if (mail.signedByKeyID && mail.shouldEncrypt) {
      mail.shouldEncrypt = false;
    } else if (mail.signedByKeyID) {
      mail.signedByKeyID = null;
      mail.shouldEncrypt = false;
    } else {
      doSign();
    }
  }
  function doSign() {
    if (signDisabledReason) {
      openSettingsCategoryForAccount(identity.account, "mail-identity");
      return;
    }
    mail.signedByKeyID = getMyPrivateKey(identity)?.id;
    assert(mail.signedByKeyID, "No signing key found");
  }
  function toggleEncrypted() {
    if (mail.mustEncrypt) {
      return;
    }
    if (!mail.shouldEncrypt && encryptDisabledReason) {
      showError(new UserError(encryptDisabledReason)); // TODO open UI to fix the reason
      return;
    }

    mail.shouldEncrypt = !mail.shouldEncrypt;
    if (mail.shouldEncrypt && !mail.signedByKeyID) {
      doSign();
    }
  }
  function onDisableBoth() {
    if (mail.mustEncrypt) {
      return;
    }
    mail.signedByKeyID = null;
    mail.shouldEncrypt = false;
  }

  function lowestTrust(keys: Collection<PublicKey | null>): TrustLevel {
    if (keys.isEmpty) {
      return TrustLevel.Personal;
    }
    if (!every(keys, key => !!key)) {
      return TrustLevel.Distrusted;
    }
    return allTrust(keys, TrustLevel.Personal)
      || allTrust(keys, TrustLevel.ThirdParty)
      || allTrust(keys, TrustLevel.OS)
      || allTrust(keys, TrustLevel.Sender)
      || TrustLevel.Distrusted;
  }
  function allTrust(keys: Collection<PublicKey>, trustLevel: TrustLevel): TrustLevel | false {
    let needLevel = trustOrder(trustLevel);
    return every(keys, key => trustOrder(key.trustLevel) >= needLevel) ? trustLevel : false;
  }
</script>

<style>
  .buttons {
    align-items: center;
    margin-inline-start: 4px;
    gap: 4px;
  }
  .buttons  :global(.button:not(.selected)) {
    color: #595065;
  }
  .buttons.encrypt :global(.button) {
    background-color: var(--trustColor);
    color: var(--trustColorFG);
    border-radius: 1000px;
  }
</style>
