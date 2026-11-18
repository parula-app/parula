<AddonButtons {place} mail={$mail} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import AddonButtons from "../../../frontend/Addons/AddonButtons.svelte";
  import type { Readable } from "svelte/store";

  export let place: string;
  export let mail: Readable<EMail>;
</script>
