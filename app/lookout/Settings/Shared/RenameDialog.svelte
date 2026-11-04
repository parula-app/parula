<Dialog {title}
  okLabel={$t`OK`}
  okDisabled={!name.trim() && $t`Enter a name`}
  onOK={onOK}
  width="400px"
  on:close>
  <label class="field">
    <span class="label">{$t`New name`}</span>
    <input type="text" class="lo-text-field" bind:value={name} />
  </label>
</Dialog>

<script lang="ts">
  import type { Account } from "../../../logic/Abstract/Account";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import { t } from "../../../l10n/l10n";

  export let account: Account;
  export let title: string;

  let name = account.name;

  async function onOK() {
    let trimmed = name.trim();
    if (trimmed == account.name) {
      return;
    }
    account.name = trimmed;
    await account.save();
  }
</script>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .label {
    font-size: var(--lo-font-size-small);
    color: var(--lo-fg-secondary);
  }
</style>
