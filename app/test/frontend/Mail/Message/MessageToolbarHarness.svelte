<!-- Mimics `MessageHeader`, which shows the toolbar of whichever mail
  the user selected, without rebuilding the toolbar itself -->
<MessageToolbar message={$message} />

<script lang="ts">
  import type { EMail } from "../../../../logic/Mail/EMail";
  import MessageToolbar from "../../../../frontend/Mail/Message/MessageToolbar.svelte";
  import type { Readable } from "svelte/store";

  export let message: Readable<EMail>;
</script>
