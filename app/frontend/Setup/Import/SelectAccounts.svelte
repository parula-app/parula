<Header
  title={$t`Import accounts`}
  subtitle={$t`Continue to use your accounts from Thunderbird`} />

{#await startImport()}
  <StatusMessage status="processing"
    message={$t`Importing accounts...`} />
{:then}
  <vbox class="results">
    <HeaderGroupBox>
      <hbox class="found" slot="header">{$t`Found ${accounts.length} imported accounts`}</hbox>
      <vbox class="accounts">
        <Scroll>
          <grid class="protocol-grid">
            {#each accounts as account}
              <Checkbox label={account.name} bind:checked={account.import} />
              <hbox class="protocol {account.protocol} font-small">{account.protocol.toUpperCase()}</hbox>
            {/each}
          </grid>
        </Scroll>
      </vbox>
    </HeaderGroupBox>
  </vbox>
{:catch ex}
  {ex?.message ?? ex + ""}
{/await}
<ButtonsBottom
  canContinue={!!accounts.length}
  onContinue={onContinue}
  >
  <Button label={$t`Uncheck all`} classes="secondary"
    onClick={onUncheckAll}
    />
  <Button label={$t`Skip`} classes="secondary"
    onClick={onSkip}
    />
</ButtonsBottom>

<script lang="ts">
  import { ThunderbirdProfile } from "../../../logic/Mail/Import/Thunderbird/TBProfile";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import StatusMessage from "../Shared/StatusMessage.svelte";
  import ButtonsBottom from "../Shared/ButtonsBottom.svelte";
  import Checkbox from "../../Shared/Checkbox.svelte";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import Button from "../../Shared/Button.svelte";
  import Header from "../Shared/Header.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import { t } from "../../../l10n/l10n";

  export let accounts: MailAccount[] = [];
  export let onContinue = () => undefined;

  async function startImport() {
    let profiles = await ThunderbirdProfile.findProfiles();
    if (profiles.length) {
      for (let profile of profiles.filter(p => p.name && !p.name.toLowerCase().includes("test"))) {
        try {
          let tbAccounts = await profile.readMailAccounts();
          accounts = accounts.concat(tbAccounts);
        } catch (ex) {
          console.log(ex?.message);
        }
      }
    }

    for (let account of accounts) {
      (account as any).import = true;
    }

    console.log("Imported accounts", accounts);
    if (!accounts.length) {
      onContinue();
      return;
    }
  }

  function onUncheckAll() {
    for (let account of accounts) {
      (account as any).import = false;
    }
    accounts = accounts;
  }

  function onSkip() {
    onUncheckAll();
    onContinue();
  }
</script>

<style>
  .results > :global(.group) {
    margin-block-start: -4px;
  }
  .found {
    justify-content: center;
  }
  .accounts {
    min-height: 30vh;
  }
  grid.protocol-grid {
    grid-template-columns: auto max-content;
    margin: 4px 12px;
    row-gap: 4px;
  }

  .protocol {
    min-height: 20px;
    max-height: 20px;
    border-radius: 8px;
    color: white;
    border: 1px solid transparent;
    padding-inline-start: 8px;
    padding-inline-end: 8px;
    margin: 2px;
    margin-inline-start: 24px;
  }
  .protocol.imap {
    background-color: green;
  }
  .protocol.pop3 {
    background-color: #178989;
  }
  .protocol.owa {
    background-color: #0009a8;
  }
  .protocol.ews {
    background-color: #017DC5;
  }
  .protocol.activesync {
    background-color: #155EA2;
  }
</style>
