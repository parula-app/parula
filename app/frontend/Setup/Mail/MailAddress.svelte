<hbox class="mail-address">
  <input type="email"
    placeholder="you@example.com"
    bind:value={emailAddress}
    bind:this={inputEl}
    on:keydown={(event) => onKeyEnter(event, onEnter)}
    />
  <hbox class="icon" class:valid>
    {#if !emailAddress}
      <Icon data={GMailIcon} title="Google" size="16px" />
      <Icon data={Microsoft365Icon} title="Microsoft" size="16px" />
      <Icon data={YahooIcon} title="Yahoo" size="16px" />
    {:else if valid}
      {#if emailAddress.endsWith("@gmail.com")}
        <Icon data={GMailIcon} title="Google" size="16px" />
      {:else if emailAddress.includes("@yahoo.")}
        <Icon data={YahooIcon} title="Yahoo" size="16px" />
      {:else if emailAddress.includes("@outlook.") || emailAddress.includes("@hotmail.") || emailAddress.includes("@live.")}
        <Icon data={Microsoft365Icon} title="Microsoft" size="16px" />
      {:else}
        <CheckIcon />
      {/if}
    {/if}
  </hbox>
</hbox>

<script lang="ts">
  import Icon from 'svelte-icon/Icon.svelte';
  import CheckIcon from "lucide-svelte/icons/check";
  import GMailIcon from '../../asset/icon/brand/gmail.svg?raw';
  import Microsoft365Icon from '../../asset/icon/brand/microsoft365.svg?raw';
  import YahooIcon from '../../asset/icon/brand/yahoo.svg?raw';
  import { onKeyEnter } from '../../Util/util';
  import { sanitize } from '../../../../lib/util/sanitizeDatatypes';
  import { createEventDispatcher } from 'svelte';
  const dispatchEvent = createEventDispatcher();

  /** in/out */
  export let emailAddress: string;

  let inputEl: HTMLInputElement;
  $: valid = emailAddress && sanitize.emailAddress(emailAddress, null) && inputEl?.validity.valid;

  function onEnter() {
    if (valid) {
      dispatchEvent("continue");
    }
  }

  export function focus() {
    inputEl.focus();
  }
</script>

<style>
  .mail-address {
    margin: 8px 0 8px 0;
  }
  input {
    height: 24px;
  }
  input:invalid {
    border-bottom-color: red;
  }
  .icon {
    min-width: 32px;
  }
  .icon :global(> *) {
    margin-inline-start: 2px;
  }
  .icon.valid {
    color: var(--selected-bg);
  }
</style>
