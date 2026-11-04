<Dialog title={$t`Properties *=> Properties of the email`} okLabel={$t`OK`} onOK={onOK} width="560px" on:close>
  <vbox class="properties">
    <GroupBox label={$t`Settings`}>
      <hbox class="setting">
        <span>{$t`Importance *=> Importance of the email`}</span>
        <ComboBox label={$t`Importance *=> Importance of the email`} options={importanceOptions} bind:value={isImportant} width="160px" />
      </hbox>
    </GroupBox>
    <span>{$t`Internet headers`}</span>
    <TextField label={$t`Internet headers`} value={headers} multiline rows={12} readonly classes="headers" />
  </vbox>
</Dialog>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import GroupBox from "../../Shared/Form/GroupBox.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import TextField from "../../Shared/Form/TextField.svelte";
  import type { ComboOption } from "../../Shared/Form/ComboOption";
  import { catchErrors } from "../../../frontend/Util/error";
  import { onMount } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;

  const importanceOptions: ComboOption<boolean>[] = [
    { value: false, label: $t`Normal *=> Importance of the email: normal` },
    { value: true, label: $t`High *=> Importance of the email: high` },
  ];
  let isImportant = !!message.isImportant;
  let headers = "";

  onMount(() => catchErrors(loadHeaders));
  async function loadHeaders() {
    await message.loadMIME();
    if (!message.mime) {
      headers = $t`Source not available`;
      return;
    }
    let source = new TextDecoder().decode(message.mime);
    let end = source.search(/\r?\n\r?\n/);
    headers = end < 0 ? source : source.substring(0, end);
  }

  async function onOK() {
    if (isImportant != !!message.isImportant) {
      await message.markImportant(isImportant);
    }
  }
</script>

<style>
  .properties {
    gap: 8px;
  }
  .setting {
    align-items: center;
    gap: 16px;
  }
  .properties :global(.headers) {
    font-family: monospace;
    font-size: 12px;
    white-space: pre;
    resize: none;
  }
</style>
