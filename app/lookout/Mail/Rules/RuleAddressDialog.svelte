<SelectNamesDialog title={$t`Rule Address`} persons={picks} label={$t`From`} single on:ok={onPicked} on:close={onClose} />

<script lang="ts">
  import type { Person } from "../../../logic/Abstract/Person";
  import { PersonUID } from "../../../logic/Abstract/PersonUID";
  import SelectNamesDialog from "../Composer/SelectNamesDialog.svelte";
  import { ArrayColl } from "svelte-collections";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let person: Person | null;
  const dispatch = createEventDispatcher<{ choose: Person | null, close: void }>();

  const picks = new ArrayColl<PersonUID>(person?.emailAddresses.hasItems ? [PersonUID.fromPerson(person)] : []);

  function onPicked() {
    dispatch("choose", picks.first?.findPerson() ?? null);
  }

  function onClose() {
    dispatch("close");
  }
</script>
