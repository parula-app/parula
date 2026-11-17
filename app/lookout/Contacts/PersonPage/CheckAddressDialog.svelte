<Dialog title={$t`Check Address`} okLabel={$t`OK`} onOK={onOK} width="440px" on:close>
  <GroupBox label={$t`Address details`}>
    <FormGrid>
      <span>{$t`Street *=> Street and house number of the person or company`}</span>
      <TextField bind:value={street} label={$t`Street *=> Street and house number of the person or company`} multiline rows={2} />
      <span>{$t`City`}</span>
      <TextField bind:value={city} label={$t`City`} />
      <span>{$t`State/Province *=> State or province of the person or company`}</span>
      <TextField bind:value={state} label={$t`State/Province *=> State or province of the person or company`} />
      <span>{$t`ZIP/Postal code`}</span>
      <TextField bind:value={postalCode} label={$t`ZIP/Postal code`} />
      <span>{$t`Country/Region *=> Country or region of the person or company`}</span>
      <TextField bind:value={country} label={$t`Country/Region *=> Country or region of the person or company`} />
    </FormGrid>
  </GroupBox>
</Dialog>

<script lang="ts">
  import { StreetAddress } from "../../../logic/Contacts/StreetAddress";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import GroupBox from "../../Shared/Form/GroupBox.svelte";
  import FormGrid from "../../Shared/Form/FormGrid.svelte";
  import TextField from "../../Shared/Form/TextField.svelte";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let value: string;
  const dispatch = createEventDispatcher<{ change: string }>();

  let address = parse(value);
  let street = address.street ?? "";
  let city = address.city ?? "";
  let state = address.state ?? "";
  let postalCode = address.postalCode ?? "";
  let country = address.country ?? "";

  function parse(json: string): StreetAddress {
    try {
      return new StreetAddress(json || undefined);
    } catch (ex) {
      let fallback = new StreetAddress();
      fallback.street = json;
      return fallback;
    }
  }

  function onOK() {
    address.street = street.trim() || null;
    address.city = city.trim() || null;
    address.state = state.trim() || null;
    address.postalCode = postalCode.trim() || null;
    address.country = country.trim() || null;
    dispatch("change", address.toString());
  }
</script>
