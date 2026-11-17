<vbox class="account-page">
  <h1>{appName}</h1>
  <hbox class="columns">
    <vbox class="column">
      <h2>{$t`User Information`}</h2>
      {#if mainAccount}
        <hbox class="user">
          <PersonCircle name={$mainAccount.realname || $mainAccount.name} colorKey={$mainAccount.emailAddress} size={48} />
          <vbox class="user-text">
            <label for="backstage-realname" class="lo-secondary">{$t`Your name`}</label>
            <input id="backstage-realname" class="lo-text-field" type="text"
              title={$t`Your real name, as shown to other people when you are sending messages`}
              value={$mainAccount.realname ?? ""}
              on:change={event => catchErrors(() => saveRealname(event.currentTarget.value))} />
          </vbox>
        </hbox>
      {:else}
        <span class="lo-secondary">{$t`No email account is set up yet`}</span>
      {/if}
      <h2>{$t`License *=> Section about the license that you bought for the app`}</h2>
      <License />
      <h2>{$t`${appName} Theme *=> Color scheme of the app`}</h2>
      <ComboBox options={themeOptions} bind:value={$theme.value} label={$t`${appName} Theme *=> Color scheme of the app`} width="240px" />
    </vbox>
    <vbox class="column">
      <h2>{$t`Product Information`}</h2>
      <hbox class="product">
        <span class="logo">{@html logo}</span>
        <vbox>
          <span class="product-name">{appName}</span>
          <span class="lo-secondary">{$t`Version ${appVersion}`}</span>
        </vbox>
      </hbox>
      <BackstageTile label={$t`Update Options *=> Menu with the options for updates of the app`} icon={UpdateIcon}
        title={$t`${appName} Updates`} description={updateText}>
        <MenuItem label={$t`Update Now`} icon={UpdateIcon} onClick={checkForUpdate} />
        {#if hasUpdate}
          <MenuItem label={$t`Install Update`} icon={InstallIcon} onClick={installUpdate} />
        {/if}
      </BackstageTile>
      <BackstageTile label={$t`About ${appName}`} icon={AboutIcon}
        title={$t`About ${appName}`} description={$t`Learn more about ${appName}, its version and copyright`}
        onClick={() => { isAboutOpen = true; }} />
      <h2>{$t`Open-Source Licenses`}</h2>
      <OpenSource />
    </vbox>
  </hbox>
</vbox>

{#if isAboutOpen}
  <AboutDialog on:close={() => { isAboutOpen = false; }} />
{/if}

<script lang="ts">
  import { appGlobal } from "../../../logic/app";
  import { appName, appVersion } from "../../../logic/build";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import PersonCircle from "../../Contacts/Person/PersonCircle.svelte";
  import BackstageTile from "./BackstageTile.svelte";
  import AboutDialog from "../About/AboutDialog.svelte";
  import License from "../License/Page/License.svelte";
  import OpenSource from "../About/OpenSource.svelte";
  import { catchErrors } from "../../../frontend/Util/error";
  import logo from "../../../frontend/asset/icon/general/logo.svg?raw";
  import UpdateIcon from "lucide-svelte/icons/refresh-cw";
  import InstallIcon from "lucide-svelte/icons/download";
  import AboutIcon from "lucide-svelte/icons/info";
  import { t } from "../../../l10n/l10n";

  const theme = getLocalStorage<string>("appearance.theme", "system");
  const emailAccounts = appGlobal.emailAccounts;

  let isAboutOpen = false;
  let hasUpdate = false;
  let updateText = $t`Updates are installed for you`;

  $: mainAccount = $emailAccounts.first;
  $: themeOptions = [
    { value: "system", label: $t`Use system setting` },
    { value: "light", label: $t`Light` },
    { value: "dark", label: $t`Dark` },
  ];

  async function saveRealname(name: string) {
    mainAccount.realname = name.trim();
    await mainAccount.save();
  }

  async function checkForUpdate() {
    updateText = $t`Checking for updates…`;
    hasUpdate = !!await appGlobal.remoteApp.checkForUpdate();
    updateText = hasUpdate ? $t`An update is available` : $t`You're up to date`;
  }

  async function installUpdate() {
    await appGlobal.remoteApp.installUpdate();
    updateText = $t`Installing the update…`;
  }
</script>

<style>
  .account-page {
    max-width: 960px;
    padding: 24px 40px;
  }
  h1 {
    margin: 0 0 16px 0;
    font-size: 28px;
    font-weight: 300;
  }
  h2 {
    margin: 16px 0 8px 0;
    font-size: 18px;
    font-weight: 400;
  }
  .columns {
    gap: 48px;
    align-items: start;
  }
  .column {
    flex: 1 1 0;
    min-width: 0;
  }
  .user {
    align-items: center;
    gap: 12px;
  }
  .user-text {
    flex: 1 1 0;
    min-width: 0;
    max-width: 320px;
    gap: 4px;
  }
  .product {
    align-items: center;
    gap: 12px;
    margin-block-end: 16px;
  }
  .logo {
    display: flex;
    width: 40px;
    height: 40px;
  }
  .logo :global(svg) {
    width: 100%;
    height: 100%;
  }
  .logo :global(.horse),
  .logo :global(.circle-bars) {
    fill: var(--lo-accent);
    stroke: var(--lo-accent);
  }
  .product-name {
    font-size: 20px;
    font-weight: 600;
  }
</style>
