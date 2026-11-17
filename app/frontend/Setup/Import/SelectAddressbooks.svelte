<Header
  title={$t`Import address books`}
  subtitle={$t`Import your contacts from Thunderbird`} />

{#await startImport()}
  <StatusMessage status="processing"
    message={$t`Importing address books...`} />
{:then}
  <vbox class="results">
    <HeaderGroupBox>
      <hbox class="found" slot="header">{$t`Found ${$addressbooks.length} imported addressbooks`}</hbox>
      <vbox class="list">
        <Scroll>
          <grid class="protocol-grid">
            {#each $addressbooks.each as addressbook}
              <Checkbox label={addressbook.name} bind:checked={addressbook.import} />
              <hbox class="protocol thunderbird-local font-smallest">Thunderbird</hbox>
            {/each}
          </grid>
        </Scroll>
      </vbox>
    </HeaderGroupBox>
  </vbox>
{:catch ex}
  {ex?.message ?? ex + ""}
{/await}
{#if isThunderbirdRunning}
  <StatusMessage status="error"
    message={$t`Please close Thunderbird to import the address books of your current profile.`}>
    <vbox class="retry">
      <Button label={$t`Retry`} classes="filled"
        onClick={startImport}
        />
    </vbox>
  </StatusMessage>
{/if}
<ButtonsBottom
  canContinue={!!$addressbooks.length}
  onContinue={onOK}
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
  import type { Addressbook } from "../../../logic/Contacts/Addressbook";
  import StatusMessage from "../Shared/StatusMessage.svelte";
  import ButtonsBottom from "../Shared/ButtonsBottom.svelte";
  import Checkbox from "../../Shared/Checkbox.svelte";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import Button from "../../Shared/Button.svelte";
  import Header from "../Shared/Header.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import { t } from "../../../l10n/l10n";
  import { ThunderbirdAddressbook } from "../../../logic/Mail/Import/Thunderbird/TBAddressbook";
  import { ArrayColl } from "svelte-collections";
  import { appGlobal } from "../../../logic/app";
  import { logErrorToServer } from "../../Util/error";

  export let addressbooks = new ArrayColl<Addressbook>();
  export let onContinue = () => undefined;

  let errors = new ArrayColl<Error>();
  let isThunderbirdRunning = false;

  function reset() {
    addressbooks.clear();
    errors.clear();
    isThunderbirdRunning = false;
  }

  async function startImport() {
    reset();
    let profiles = await ThunderbirdProfile.findProfiles();
    if (profiles.length) {
      for (let profile of profiles.filter(p => p.name && !p.name.toLowerCase().includes("test"))) {
        try {
          let abs = await ThunderbirdAddressbook.readAll(profile, abErrorCallback, entryErrorCallback);
          addressbooks.addAll(abs);
        } catch (ex) {
          abErrorCallback(ex);
        }
      }
    }

    for (let account of addressbooks) {
      (account as any).import = true;
    }

    //console.log("Found Thunderbird addressbooks", addressbooks.contents.map(ab => ab.name));
    if (!addressbooks.length && !isThunderbirdRunning) {
      onContinue();
      return;
    }
  }

  function abErrorCallback(ex: Error) {
    errors.add(ex);
    let code = (ex as any)?.code;
    if (code == "SQLITE_BUSY" || code == "SQLITE_LOCKED") {
      isThunderbirdRunning = true;
      return;
    }
    logErrorToServer(ex);
  }

  function entryErrorCallback(ex: Error) {
    console.log(ex?.message ?? ex + "");
  }

  function onUncheckAll() {
    for (let addressbook of addressbooks) {
      (addressbook as any).import = false;
    }
    addressbooks = addressbooks;
  }

  function onSkip() {
    onUncheckAll();
    onContinue();
  }

  async function onOK() {
    let importAddressbooks = addressbooks.filterOnce((ab: any) => ab.import);
    for (let addressbook of importAddressbooks) {
      appGlobal.addressbooks.add(addressbook);
      await addressbook.save();
      for (let person of addressbook.persons) {
        // Slow, and the next `addressbook.save()` will block on it
        await person.save();
      }
    }
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
  .list {
    min-height: 30vh;
  }
  grid.protocol-grid {
    grid-template-columns: auto max-content;
    margin: 4px 12px;
    row-gap: 6px;
  }
  .retry {
    justify-content: center;
    margin-inline-start: 24px;
  }

  .protocol {
    min-height: 16px;
    border-radius: 8px;
    color: white;
    border: 1px solid transparent;
    padding-inline-start: 8px;
    padding-inline-end: 8px;
    margin: 2px;
    margin-inline-start: 24px;
  }
  .protocol.thunderbird-local {
    background-color: #1177d9;
  }
</style>
