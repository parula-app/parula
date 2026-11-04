<input type={type} class="lo-text-field slot-field" aria-label={slot.label}
  value={$entries && slot.valueIn(entries)}
  on:input={event => onTyped(event.currentTarget.value)} />

<script lang="ts">
  import type { ContactEntry } from "../../../logic/Abstract/Person";
  import type { ContactSlot } from "./ContactSlots";
  import type { ArrayColl } from "svelte-collections";

  export let slots: readonly ContactSlot[];
  export let slot: ContactSlot;
  export let entries: ArrayColl<ContactEntry>;
  export let type: "text" | "email" | "tel" | "url" = "text";

  function onTyped(value: string) {
    slot = slot.setValueIn(entries, value, slots);
  }
</script>

<style>
  .slot-field {
    width: 100%;
    box-sizing: border-box;
  }
</style>
