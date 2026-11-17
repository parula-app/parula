<RibbonGroup label={$t`Encrypt`}>
  {#if privateKey}
    <RibbonToggleButton label={$t`Encrypt`} icon={EncryptIcon}
      tooltip={$t`Only the recipients can read the email`}
      selected={!!$mail.shouldEncrypt}
      disabled={$mail.mustEncrypt && $t`Policy requires that this email stays encrypted, to keep protect secret information`}
      onClick={toggleEncrypted} />
    <RibbonToggleButton label={$t`Sign *=> Digitally sign this email`} icon={SignIcon}
      tooltip={$t`This proves that I wrote this email`}
      selected={!!$mail.signedByKeyID}
      disabled={$mail.mustEncrypt && $t`Policy requires that this email stays encrypted, to keep protect secret information`}
      onClick={toggleSigned} />
  {:else}
    <RibbonButton label={$t`Encrypt`} icon={EncryptIcon}
      tooltip={$t`You need a digital ID to encrypt messages. Set it up in the Trust Center.`}
      onClick={() => openTrustCenter(identity)} />
    <RibbonButton label={$t`Sign *=> Digitally sign this email`} icon={SignIcon}
      tooltip={$t`You need a digital ID to sign messages. Set it up in the Trust Center.`}
      onClick={() => openTrustCenter(identity)} />
  {/if}
</RibbonGroup>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { MailIdentity } from "../../../logic/Mail/MailIdentity";
  import { getMyPrivateKey } from "../../../logic/Mail/Encryption/KeyUtils";
  import { openTrustCenter } from "../../Settings/SettingsDialogs";
  import RibbonGroup from "../../Shared/Ribbon/RibbonGroup.svelte";
  import RibbonButton from "../../Shared/Ribbon/RibbonButton.svelte";
  import RibbonToggleButton from "../../Shared/Ribbon/RibbonToggleButton.svelte";
  import EncryptIcon from "lucide-svelte/icons/lock";
  import SignIcon from "lucide-svelte/icons/signature";
  import { showError } from "../../../frontend/Util/error";
  import { assert, UserError } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";

  export let mail: EMail;
  export let identity: MailIdentity;

  $: privateKey = identity ? getMyPrivateKey(identity) ?? null : null;

  // <copied from="../../../frontend/Mail/Composer/EncryptionButtons.svelte">
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
    if (!getMyPrivateKey(identity)) {
      openTrustCenter(identity);
      return;
    }
    mail.signedByKeyID = getMyPrivateKey(identity)?.id;
    assert(mail.signedByKeyID, "No signing key found");
  }
  function toggleEncrypted() {
    if (mail.mustEncrypt) {
      return;
    }
    let encryptDisabledReason = mail.mustEncrypt
      ? $t`Policy requires that this email stays encrypted, to keep protect secret information`
      : null;
    if (!mail.shouldEncrypt && encryptDisabledReason) {
      showError(new UserError(encryptDisabledReason));
      return;
    }

    mail.shouldEncrypt = !mail.shouldEncrypt;
    if (mail.shouldEncrypt && !mail.signedByKeyID) {
      doSign();
    }
  }
  // </copied>
</script>
