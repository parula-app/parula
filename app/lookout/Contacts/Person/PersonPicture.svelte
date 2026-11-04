<PersonCircle name={$person?.name} picture={$person?.picture} colorKey={preferredEmail}
  isGroup={person instanceof Group} {size} />

<script lang="ts">
  import type { PersonOrGroup } from "../../../frontend/Contacts/Person/PersonOrGroup";
  import { Person, type ContactEntry } from "../../../logic/Abstract/Person";
  import { Group } from "../../../logic/Abstract/Group";
  import PersonCircle from "./PersonCircle.svelte";
  import { ArrayColl } from "svelte-collections";

  export let person: PersonOrGroup;
  export let size = 40;

  $: emailAddresses = person instanceof Person ? person.emailAddresses : new ArrayColl<ContactEntry>();
  $: preferredEmail = $emailAddresses.sortBy(entry => entry.preference).first?.value || null;
</script>
