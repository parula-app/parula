<SelectNamesDialog persons={picks} label={fieldLabel} single on:ok={onOK} on:close />

<script lang="ts">
  import type { Person } from "../../../logic/Abstract/Person";
  import { PersonUID } from "../../../logic/Abstract/PersonUID";
  import SelectNamesDialog from "../Composer/SelectNamesDialog.svelte";
  import { ArrayColl } from "svelte-collections";
  import { createEventDispatcher } from "svelte";

  export let fieldLabel: string;
  export let person: Person | null = null;

  const dispatch = createEventDispatcher<{ pick: Person | null }>();

  const picks = new ArrayColl<PersonUID>(person?.emailAddresses.hasItems ? [PersonUID.fromPerson(person)] : []);

  function onOK() {
    let pick = picks.first;
    dispatch("pick", pick ? pick.findPerson() ?? null : null);
  }
</script>
