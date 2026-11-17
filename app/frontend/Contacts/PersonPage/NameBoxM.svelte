<vbox class="main font-normal" language={getUILocale()} flex>
  <hbox class="top-button-row" flex>
    <hbox class="top-left buttons" flex>
      {#if isIOS}
        <RoundButton
          icon={BackIcon}
          label={$t`Back to list of persons`}
          onClick={() => goBack()}
          classes="back" />
      {/if}
      {#if isEditing}
        <hbox class="addressbook-edit">
          <AddressbookChanger {person} withLabel={true} />
        </hbox>
      {/if}
    </hbox>
    <hbox class="top-right buttons" flex>
      {#if isEditing}
        <Button
          icon={SaveIcon}
          label={$t`Save`}
          onClick={onSave}
          classes="save primary filled" />
      {:else}
        <RoundButton
          icon={person.addressbook?.icon ?? AddressbookIcon}
          label={person.addressbook?.name}
          disabled={true}
          padding="0px"
          classes="addressbook-display plain" border={false} />
        <Button
          icon={EditIcon}
          label={$t`Edit`}
          onClick={onEdit}
          classes="edit primary" plain={true} />
      {/if}
    </hbox>
  </hbox>
  <vbox class="avatar-row" class:has-avatar={$person.picture}>
    {#if $person.picture || isEditing}
      <PersonPicture {person} size={$person.picture ? 64 : 32} placeholder="icon" />
    {/if}
    {#if isEditing}
      <hbox class="picture-buttons">
        {#if $person.picture}
          <Button
            label={$t`Delete picture`}
            onClick={deletePicture}
            icon={DeleteIcon}
            iconSize="20px"
            iconOnly plain classes="delete-picture" />
        {/if}
        <SetPictureButton {person} iconSize="20px" />
      </hbox>
    {/if}
  </vbox>
  <vbox class="main-info" flex>
    {#if isEditing}
      <GroupBox headerName="">
        <vbox class="names-edit-box" slot="content">
          <hbox class="name">
            <hbox class="label font-small">{$t`Full name`}</hbox>
            <EditableSimpleText bind:value={person.name}
              on:save={onSaveWithCatch}
              bind:isEditing={isEditing}
              isName={true}
              placeholder={$t`First name Last name`} />
          </hbox>
          <hbox class="names firstname">
            <hbox class="label font-small">{$t`First name`}</hbox>
            <EditableSimpleText
              bind:value={person.firstName}
              on:save={onSaveWithCatch}
              bind:isEditing={isEditing}
              placeholder={$t`First name`} />
          </hbox>
          <hbox class="names lastname">
            <hbox class="label font-small">{$t`Last name`}</hbox>
            <EditableSimpleText
              bind:value={person.lastName}
              on:save={onSaveWithCatch}
              bind:isEditing={isEditing}
              placeholder={$t`Last name`} />
          </hbox>
        </vbox>
      </GroupBox>
    {:else}
      <hbox class="name center font-small">
        <EditableSimpleText bind:value={person.name}
          on:save={onSaveWithCatch}
          bind:isEditing={isEditing}
          isName={true}
          placeholder={$t`First name Last name`} />
      </hbox>
    {/if}
  </vbox>
  {#if !isEditing}
    <hbox class="center" flex>
      <CallButtons {person} />
    </hbox>
  {/if}
</vbox>
{#if showCompany || showCompanyEdit}
    <CompanyBox {person} isEditing={isEditing} />
{:else if isEditing}
  <hbox class="company-expander">
    <ExpanderButtons>
      <ExpanderButton bind:expanded={showCompanyEdit} addIconSize="18px"
        label={$t`Company`} icon={CompanyIcon} classes="company" />
    </ExpanderButtons>
  </hbox>
{/if}

<script lang="ts">
  import type { Person } from "../../../logic/Abstract/Person";
  import CallButtons from "./CallButtons.svelte";
  import EditableSimpleText from "./EditableSimpleText.svelte";
  import PersonPicture from "../Person/PersonPicture.svelte";
  import SetPictureButton from "./SetPictureButton.svelte";
  import CompanyBox from "./CompanyBox.svelte";
  import AddressbookChanger from "../AddressbookChanger.svelte";
  import ExpanderButtons from "../../Shared/ExpanderButtons.svelte";
  import ExpanderButton from "../../Shared/ExpanderButton.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import EditIcon from "lucide-svelte/icons/pencil";
  import SaveIcon from "lucide-svelte/icons/check";
  import AddressbookIcon from "lucide-svelte/icons/book-user";
  import CompanyIcon from "lucide-svelte/icons/building-2";
  import BackIcon from "lucide-svelte/icons/chevron-left";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import { showError } from "../../Util/error";
  import { getUILocale, t } from "../../../l10n/l10n";
  import Button from "../../Shared/Button.svelte";
  import GroupBox from "./GroupBox.svelte";
  import { goBack } from "../../AppsBar/selectedApp";

  export let person: Person;
  /** in/out */
  export let isEditing: boolean;

  $: showCompany = $person.company || $person.position || $person.department ? true : false;
  let showCompanyEdit = false;
  $: !isEditing && (showCompanyEdit = false);
  let isIOS = false;

  function onEdit() {
    isEditing = true;
  }
  async function onSave() {
    isEditing = false;
    await person.save();
  }
  async function onSaveWithCatch() {
    try {
      await onSave();
    } catch (ex) {
      showError(ex);
    }
  }

  function deletePicture() {
    person.picture = null;
  }
</script>

<style>
  .top-button-row {
    flex-wrap: wrap;
  }
  .buttons {
    align-items: start;
    margin: 12px 12px;
    flex-wrap: wrap;
  }
  .buttons :global(button.primary) {
    padding: 10px 16px;
  }
  .buttons :global(button .label) {
    white-space: nowrap; /** TODO Move to `<Button>`? */
  }
  .top-left {
    justify-content: start;
  }
  .top-right {
    justify-content: end;
  }
  .top-left :global(> *) {
    margin-inline-end: 8px;
  }
  .top-right :global(> *) {
    margin-inline-start: 8px;
  }
  .top-right :global(> .edit) {
    margin-block-start: -12px;
    padding-block: 12px;
  }
  .addressbook-edit {
    margin-block-start: 6px;
    margin-inline-start: 8px;
  }
  .top-right :global(.account-selector .icon) {
    width: 20px;
    height: 20px;
  }
  .avatar-row {
    align-items: center;
  }
  .avatar-row:not(.has-avatar) {
    margin-block-start: 24px;
  }
  .avatar-row.has-avatar {
    margin-block-start: -12px;
  }
  .picture-buttons {
    gap: 12px; /* Far enough apart for fingers */
    margin-block-start: 8px;
  }
  .picture-buttons :global(button) {
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 1000px;
    background-color: var(--main-bg);
  }
  .main-info {
    justify-content: center;
    margin-block-end: 8px;
  }
  .center {
    justify-content: center;
  }
  .label {
    white-space: nowrap;
    align-items: end;
    margin-inline-end: 18px;
    font-weight: normal;
    opacity: 50%;
  }
  .name :global(.value) {
    font-size: 32px;
  }
  .name,
  .name :global(input) {
    font-weight: bold;
    color: inherit;
  }
  .names :global(input:not(:focus)) {
    opacity: 50%;
    border-bottom-width: 1px;
  }
  .names-edit-box {
    margin-inline-end: 8px;
    margin-block-end: 8px;
  }
  .names :global(button.save) {
    visibility: hidden;
  }
  .main[language="fr"] .names.lastname {
    text-transform: uppercase;
  }
  .company-expander {
    justify-content: end;
  }
</style>
