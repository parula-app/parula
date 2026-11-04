<vbox class="all-fields-page">
  <hbox class="select-row">
    <span>{$t`Select from *=> Choose which kind of fields to show`}</span>
    <ComboBox options={fieldSets} bind:value={fieldSet} label={$t`Select from *=> Choose which kind of fields to show`} width="280px" />
  </hbox>
  <ListView items={rows} bind:selected label={$t`Fields *=> List of the fields of the contact`} height="320px"
    columns={[{ label: $t`Name`, width: "minmax(0, 2fr)" }, { label: $t`Value *=> Value of the field`, width: "minmax(0, 3fr)" }]}
    let:item>
    <span class="cell">{item.name}</span>
    {#if item.kind != "address"}
      <input class="value-field" type="text" value={item.entry.value ?? ""} aria-label={item.name}
        on:input={event => { item.entry.value = event.currentTarget.value; }} />
    {:else}
      <span class="cell lo-secondary" title={$t`Edit the address on the General page`}>{addressText(item.entry.value).replace(/\n/g, ", ")}</span>
    {/if}
    <span slot="empty">{fieldSet == "user-defined"
      ? $t`This contact has no user-defined fields. Click New… to add one.`
      : $t`This contact has no fields of this kind`}</span>
  </ListView>
  <hbox class="buttons">
    <DialogButton label={$t`New… *=> Add a new user-defined field`} onClick={() => { isNewOpen = true; }} />
    <DialogButton label={$t`Delete`}
      disabled={selected?.kind != "custom" && $t`Select a user-defined field first`}
      onClick={onDelete} />
  </hbox>
</vbox>

{#if isNewOpen}
  <Dialog title={$t`New Column`} okLabel={$t`OK`} okDisabled={!newName.trim() && $t`Enter a name`}
    onOK={onAdd} width="360px" on:close={() => { isNewOpen = false; newName = ""; }}>
    <FormGrid>
      <span>{$t`Name`}</span>
      <TextField bind:value={newName} label={$t`Name`} />
    </FormGrid>
  </Dialog>
{/if}

<script lang="ts">
  import { ContactEntry, type Person } from "../../../logic/Abstract/Person";
  import { allFieldRows, type FieldRow, type FieldSet } from "./AllFields";
  import { addressText } from "../Person/ContactColumns";
  import ListView from "../../Shared/Form/ListView.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import FormGrid from "../../Shared/Form/FormGrid.svelte";
  import TextField from "../../Shared/Form/TextField.svelte";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import { tick } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let person: Person;

  let fieldSet: FieldSet = "user-defined";
  let selected: FieldRow = null;
  let isNewOpen = false;
  let newName = "";
  let revision = 0;

  $: fieldSets = [
    { value: "user-defined", label: $t`User-defined fields in this item` },
    { value: "email", label: $t`E-mail fields` },
    { value: "phone", label: $t`Phone number fields` },
    { value: "address", label: $t`Address fields` },
    { value: "internet", label: $t`Web page and IM fields` },
    { value: "all", label: $t`All Contact fields` },
  ] as { value: FieldSet, label: string }[];

  let rows: FieldRow[] = [];
  $: revision, rows = allFieldRows(person, fieldSet);

  async function onAdd() {
    let entry = new ContactEntry("", newName.trim());
    person.custom.add(entry);
    newName = "";
    fieldSet = "user-defined";
    revision++;
    await tick();
    selected = rows.find(row => row.entry == entry) ?? null;
  }

  function onDelete() {
    selected.list.remove(selected.entry);
    selected = null;
    revision++;
  }
</script>

<style>
  .all-fields-page {
    flex: 1;
    gap: 12px;
    max-width: 760px;
    padding: 4px 0;
  }
  .select-row {
    align-items: center;
    gap: 12px;
  }
  .cell {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .all-fields-page input.value-field[type] {
    min-width: 0;
    min-height: 0;
    height: 24px;
    margin: -3px 0;
    padding: 0 7px;
    border: 1px solid transparent;
    border-radius: var(--lo-radius-small);
    background: none;
    color: inherit;
    font: inherit;
  }
  .all-fields-page input.value-field[type]:hover {
    border-color: var(--lo-input-border);
  }
  .all-fields-page input.value-field[type]:focus {
    outline: none;
    border-color: var(--lo-accent);
    background-color: var(--lo-input-bg);
  }
  .buttons {
    gap: 8px;
  }
</style>
