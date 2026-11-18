<vbox>
  <input type="url" bind:value={value} on:change={onChange} size={40} maxlength={200} />
  {#if isInvalid}
    <hbox class="error">{$t`This is not a web address`}</hbox>
  {/if}
</vbox>

<script lang="ts">
  import { addHTTPSToHostname } from "../../../logic/util/netUtil";
  import { t } from "../../../l10n/l10n";

  export let value: string; /* in/out */

  let isInvalid = false;

  function onChange() {
    value = addHTTPSToHostname(value.trim());
    isInvalid = !!value && !URL.canParse(value);
  }
</script>

<style>
  .error {
    color: red;
  }
</style>
