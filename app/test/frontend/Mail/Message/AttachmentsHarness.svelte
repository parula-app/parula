<!-- Mimics `MessageDisplay`, which shows the attachments of whichever mail
  the user selected, without rebuilding the attachment list itself -->
<AttachmentsUI attachments={$message.attachments} />

<script lang="ts">
  import type { EMail } from "../../../../logic/Mail/EMail";
  import AttachmentsUI from "../../../../frontend/Mail/Message/AttachmentsUI.svelte";
  import type { Readable } from "svelte/store";

  export let message: Readable<EMail>;
</script>
