<HeaderGroupBox>
  <hbox slot="header">{$t`OAuth2`}</hbox>
  <vbox class="content">
    <grid>
      <label for="ui">{$t`Login UI`}</label>
      <hbox class="ui">
        <select bind:value={oAuth2.uiMethod} required name="ui">
          {#if oAuth2.uiMethod == OAuth2UIMethod.Embed}
            <option value={OAuth2UIMethod.Embed}>{$t`Embedded inside app UI`}</option>
          {/if}
          <option value={OAuth2UIMethod.Tab}>{$t`Inside app UI`}</option>
          <option value={OAuth2UIMethod.SystemBrowser}>{$t`Browser`}</option>
          {#if oAuth2.uiMethod == OAuth2UIMethod.Embed}
            <option value={OAuth2UIMethod.Localhost}>{$t`Copy URL`}</option>
          {/if}
        </select>
      </hbox>

      <!--
      <label for="authURL">Login URL</label>
      <input type="url" bind:value={oAuth2.authURL} required name="authURL" />

      <label for="authDoneURL">Login finished URL</label>
      <input type="url" bind:value={oAuth2.authDoneURL} required name="authDoneURL" />

      <label for="tokenURL">Token URL</label>
      <input type="url" bind:value={oAuth2.tokenURL} required name="tokenURL" />

      <label for="tokenPasswordURL">Password URL</label>
      <input type="url" bind:value={oAuth2.tokenURLPasswordAuth} name="tokenPasswordURL" />

      <label for="scope">Scope</label>
      <input type="text" bind:value={oAuth2.scope} required name="scope" />

      <label for="clientID">Client ID</label>
      <input type="password" bind:value={oAuth2.clientID} required name="clientID" />

      <label for="clientSecret">Client secret</label>
      <input type="password" bind:value={oAuth2.clientSecret} name="clientSecret" />
      -->
    </grid>
  </vbox>
</HeaderGroupBox>

<script lang="ts">
  import { OAuth2UIMethod } from "../../../../logic/Auth/UI/OAuth2UIMethod";
  import type { MailAccount } from "../../../../logic/Mail/MailAccount";
  import HeaderGroupBox from "../../../Shared/HeaderGroupBox.svelte";
  import { t } from "../../../../l10n/l10n";

  /** in */
  export let config: MailAccount;
  $: oAuth2 = config.oAuth2;
</script>

<style>
  grid {
    grid-template-columns: max-content auto;
    gap: 8px 24px;
  }
</style>
