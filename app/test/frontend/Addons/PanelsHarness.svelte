<!-- Like `MessageDisplay`, which keeps its parts when the user reads another message -->
<AddonPanels message={$message} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import AddonPanels from "../../../frontend/Addons/AddonPanels.svelte";
  import type { Readable } from "svelte/store";

  export let message: Readable<EMail>;
</script>
