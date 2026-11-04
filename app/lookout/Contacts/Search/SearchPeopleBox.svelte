<RibbonTextBox label={$t`Search People`} placeholder={$t`Search People`} icon={PersonIcon}
  bind:value bind:isListOpen width="180px"
  on:input={event => onTyped(event.detail)} on:enter={onEnter}>
  <svelte:fragment slot="list">
    {#each matches as contact (contact.id)}
      <MenuItem label={contact.name} tooltip={contactColumnValue(ContactColumn.EMail, contact)}
        icon={contact instanceof Group ? GroupIcon : PersonIcon}
        onClick={() => choose(contact)} />
    {:else}
      <MenuItem label={value.trim() ? $t`No matches` : $t`Type a name`} disabled />
    {/each}
  </svelte:fragment>
</RibbonTextBox>

<script lang="ts">
  import type { Contact } from "../../../logic/Abstract/Contact";
  import { Group } from "../../../logic/Abstract/Group";
  import { appGlobal } from "../../../logic/app";
  import { findContacts } from "../ContactSearch";
  import { ContactColumn, contactColumnValue } from "../Person/ContactColumns";
  import { LetterIndex } from "../LetterIndex";
  import RibbonTextBox from "../../Shared/Ribbon/RibbonTextBox.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import PersonIcon from "lucide-svelte/icons/user-round";
  import GroupIcon from "lucide-svelte/icons/users-round";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  const dispatch = createEventDispatcher<{ select: Contact }>();

  let value = "";
  let isListOpen = false;
  let matches: Contact[] = [];

  function onTyped(typed: string) {
    const kMaxMatches = 12;
    let term = typed.trim();
    matches = term.length >= 2
      ? findContacts(appGlobal.addressbooks.contents, term).contents
        .sort(LetterIndex.compareByName)
        .slice(0, kMaxMatches)
      : [];
    isListOpen = matches.length > 0;
  }

  function onEnter() {
    if (matches.length) {
      choose(matches[0]);
    }
  }

  function choose(contact: Contact) {
    isListOpen = false;
    value = "";
    matches = [];
    dispatch("select", contact);
  }
</script>
