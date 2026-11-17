<Dialog title={$t`Add New Member`} okLabel={$t`OK`} onOK={onOK} width="420px"
  okDisabled={!emailAddress.includes("@") && $t`Enter an email address`}
  on:close>
  <vbox class="fields">
    <FormGrid>
      <span>{$t`Display name`}</span>
      <TextField bind:value={name} label={$t`Display name`} />
      <span>{$t`E-mail address`}</span>
      <TextField bind:value={emailAddress} type="email" label={$t`E-mail address`} />
    </FormGrid>
    <Checkbox label={$t`Add to Contacts`} checked disabled={$t`Contact groups can only have contacts as members`} />
  </vbox>
</Dialog>

<script lang="ts">
  import Dialog from "../Shared/Dialog/Dialog.svelte";
  import FormGrid from "../Shared/Form/FormGrid.svelte";
  import TextField from "../Shared/Form/TextField.svelte";
  import Checkbox from "../Shared/Form/Checkbox.svelte";
  import { t } from "../../l10n/l10n";

  export let onAdd: (name: string, emailAddress: string) => Promise<void>;

  let name = "";
  let emailAddress = "";

  async function onOK() {
    await onAdd(name.trim(), emailAddress.trim());
  }
</script>

<style>
  .fields {
    gap: 12px;
  }
</style>
