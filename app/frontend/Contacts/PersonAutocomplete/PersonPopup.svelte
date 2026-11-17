<vbox class="person-popup">
  <hbox class="picture-name">
    <vbox class="picture">
      {#if person?.picture}
        <PersonPicture {person} size={32} />
      {:else}
        <RoundButton
          icon={AvatarFallbackIcon}
          iconSize="24px" filled
          onClick={onEditPerson}
          />
      {/if}
    </vbox>
    {#if isEditing}
      <vbox class="name-primary-mail font-normal" flex>
        <input class="name font-normal" type="text"
          bind:value={personUID.name}
          bind:this={nameInputEl}
          on:keydown={(event) => onKeyEnter(event, onClose)}
          placeholder={$t`Enter a name for the person`} />
        <input class="email font-normal" type="email"
          bind:value={personUID.emailAddress}
          placeholder={$t`Email address to be used here`} />
      </vbox>
      <!--
      <vbox class="top-right buttons">
        <Button plain iconOnly iconSize="14px"
          label="Save"
          icon={CheckIcon}
          onClick={onSave}
          />
      </vbox>
      -->
    {:else}
      <vbox class="name-primary-mail" flex>
        <value class="name">{$personUID.name}</value>
        <value class="email">{$personUID.emailAddress}</value>
      </vbox>
      <vbox class="top-right buttons">
        <Button plain iconOnly iconSize="14px"
          label={$t`Edit name and email address`}
          icon={EditIcon}
          onClick={() => isEditing = true}
          {disabled}
          />
      </vbox>
    {/if}
  </hbox>
  {#if !disabled}
    {#if person?.emailAddresses.hasItems}
      <vbox class="other-email-addresses">
        {#each person.emailAddresses.each as altContactEntry}
          {#if contactEntry != altContactEntry}
            <Clickable onClick={() => useOtherEmailAddress(altContactEntry.value)}>
              <hbox class="other-email-address font-small">
                <MailIcon size={12} />
                {altContactEntry.value}
              </hbox>
            </Clickable>
          {/if}
        {/each}
      </vbox>
    {/if}
    <slot name="bottom" {personUID} />
    <hbox class="bottom buttons">
      <Button plain
        label={$t`Edit`}
        onClick={onEditPerson}
        />
      <Button plain
        label={$t`Remove`}
        onClick={() => onRemovePerson(personUID)}
        />
      <slot name="buttons" {personUID} />
    </hbox>
  {/if}
</vbox>

<script lang="ts">
  import { kDummyPerson, PersonUID } from "../../../logic/Abstract/PersonUID";
  import type { ContactEntry, Person } from "../../../logic/Abstract/Person";
  import { openPersonFromOtherApp } from "../open";
  import { appGlobal } from "../../../logic/app";
  import PersonPicture from "../Person/PersonPicture.svelte";
  import Button from "../../Shared/Button.svelte";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Clickable from "../../Shared/Clickable.svelte";
  import AvatarFallbackIcon from "lucide-svelte/icons/user";
  import EditIcon from "lucide-svelte/icons/pencil";
  import CheckIcon from "lucide-svelte/icons/check";
  import MailIcon from "lucide-svelte/icons/mail";
  import { createIsSame, onKeyEnter } from "../../Util/util";
  import { minorError } from "../../Util/error";
  import { t } from "../../../l10n/l10n";
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  const dispatch = createEventDispatcher<{ close: void }>();

  export let personUID: PersonUID;
  export let disabled = false;
  export let onRemovePerson: (person: PersonUID) => void | Promise<void>;

  let person: Person;
  let contactEntry: ContactEntry;
  let isEditing = false;
  let nameInputEl: HTMLInputElement;

  onMount(() => {
    if (nameInputEl) {
      nameInputEl.select();
    }
  });
  $: nameInputEl?.focus();

  $: onLoad(personUID);
  const isSamePerson = createIsSame<PersonUID>();
  function onLoad(personUID: PersonUID) {
    if (isSamePerson(personUID)) {
      return;
    }
    personUID ??= new PersonUID();
    personUID.emailAddress ??= kDummyPerson.emailAddress;
    person = personUID.createPerson(appGlobal.collectedAddressbook);
    contactEntry = person.emailAddresses.find(c => c.value == personUID.emailAddress);
    isEditing = (!person.addressbook || person.addressbook == appGlobal.collectedAddressbook) && !disabled;
  }

  /** The user closes the popup in many ways, not only with ENTER. */
  onDestroy(() => {
    if (isEditing) {
      onSave()
        .catch(minorError);
    }
  });
  function onClose() {
    dispatch("close");
    // continue in onDestroy()
  }
  async function onSave() {
    person ??= personUID.createPerson(appGlobal.personalAddressbook);
    person.name = personUID.name;
    contactEntry.value = personUID.emailAddress;
    if (!person.addressbook) {
      person.addressbook = appGlobal.personalAddressbook;
      person.addressbook.persons.add(person);
    }
    await person.save();
  }
  function onEditPerson() {
    onClose();
    openPersonFromOtherApp(personUID.createPerson(appGlobal.personalAddressbook));
  }
  function useOtherEmailAddress(emailAddress: string) {
    personUID.emailAddress = emailAddress;
    contactEntry = person.emailAddresses.find(c => c.value == personUID.emailAddress);
  }
</script>

<style>
  .person-popup {
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
    border-radius: 5px;
    box-shadow: 2.281px 1.14px 9.123px 0px rgba(var(--shadow-color), 20%);
  }
  @media (prefers-color-scheme: dark) {
    .person-popup {
      box-shadow: none;
    }
  }
  .picture {
    justify-content: center;
    margin: 0px 12px;
  }
  .name-primary-mail {
    margin: 12px 18px 12px 0px;
  }
  .name-primary-mail .name {
    margin-block-end: 3px;
  }
  .name-primary-mail,
  .name-primary-mail input {
  }
  input {
    min-width: 15em;
  }
  .top-right.buttons {
    justify-content: start;
    align-items: end;
    margin: 8px 8px;
  }
  .other-email-addresses {
    margin: 0px 12px 12px 68px;
  }
  .other-email-address {
    align-items: center;
    color: #555555;
    cursor: pointer;
  }
  .other-email-address :global(svg) {
    margin-inline-end: 6px;
  }
  .bottom.buttons {
    border-top: 1px solid var(--border);
  }
  .bottom.buttons > :global(button:not(:first-child)) {
    border-left: 1px solid var(--border);
  }
  .bottom.buttons > :global(button) {
    padding: 8px 16px;
    border-radius: 0px;
  }
</style>
