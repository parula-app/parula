<Dialog title={$t`Certificate Properties`} okLabel={$t`OK`} onOK={onOK} width="520px" on:close>
  <vbox class="certificate">
    <FormGrid columns="150px minmax(0, 1fr)">
      <span>{$t`Name`}</span>
      <TextField bind:value={name} label={$t`Name`} placeholder={key.defaultName} />
      <span>{$t`Issued to *=> Owner of the Digital ID`}</span>
      <span class="value">{key.userIDs.contents.join(", ") || "-"}</span>
      <span>{$t`Issued by *=> Certificate authority that certified the Digital ID`}</span>
      <span class="value">{key.caName || $t`Not certified by a certification authority`}</span>
      <span>{$t`Valid from *=> Date from which the Digital ID is valid`}</span>
      <span class="value">{key.created ? getDateString(key.created) : "-"}</span>
      <span>{$t`Valid to *=> Date until which the Digital ID is valid`}</span>
      <span class="value">{key.expires ? getDateString(key.expires) : $t`No end date`}</span>
      <span>{$t`Type *=> Kind of Digital ID: OpenPGP key or S/MIME certificate`}</span>
      <span class="value">{[key.system, key.cipher, key.keyLengthInBits ? $t`${key.keyLengthInBits} bits` : null].filter(Boolean).join(", ")}</span>
      <span>{$t`Verification code`}</span>
      <span class="value code">{key.fingerprintDisplay}</span>
    </FormGrid>
    <GroupBox label={$t`Trust *=> How much you trust this certificate`}>
      <vbox class="trust">
        <Radio label={$t`I have personally checked the verification code with ${personName}`}
          name="certificate-trust" value={TrustLevel.Personal} bind:group={trustLevel} />
        {#if key.caName}
          <Radio label={$t`${key.caName} claims that this is correct *=> A company claims this`}
            name="certificate-trust" value={TrustLevel.ThirdParty} bind:group={trustLevel} />
        {:else}
          <Radio label={$t`Not checked`}
            name="certificate-trust" value={TrustLevel.Sender} bind:group={trustLevel} />
        {/if}
        <Radio label={$t`This certificate is bad`}
          name="certificate-trust" value={TrustLevel.Distrusted} bind:group={trustLevel} />
      </vbox>
    </GroupBox>
    <Checkbox label={$t`Encrypt my emails to ${personName} with this certificate`}
      bind:checked={encryptByDefault}
      disabled={trustLevel == TrustLevel.Distrusted && $t`The certificate is marked as bad`} />
  </vbox>
</Dialog>

<script lang="ts">
  import type { PublicKey } from "../../../logic/Mail/Encryption/PublicKey";
  import { TrustLevel } from "../../../logic/Mail/Encryption/enums";
  import { getDateString } from "../../../logic/util/date";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import FormGrid from "../../Shared/Form/FormGrid.svelte";
  import TextField from "../../Shared/Form/TextField.svelte";
  import GroupBox from "../../Shared/Form/GroupBox.svelte";
  import Radio from "../../Shared/Form/Radio.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import { t } from "../../../l10n/l10n";

  export let key: PublicKey;
  export let personName: string;

  let name = key.name ?? "";
  let trustLevel = key.trustLevel;
  let encryptByDefault = key.encryptByDefault;

  function onOK() {
    key.name = name.trim();
    key.trustLevel = trustLevel;
    if (trustLevel != TrustLevel.Distrusted) {
      key.encryptByDefault = encryptByDefault;
    }
  }
</script>

<style>
  .certificate {
    gap: 12px;
  }
  .value {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--lo-fg-secondary);
  }
  .code {
    font-family: monospace;
  }
  .trust {
    gap: 6px;
  }
</style>
