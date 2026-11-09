<SecondaryWindow title={$mail.subject || $t`New mail`}>
  <MailComposer {mail} />
</SecondaryWindow>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import SecondaryWindow from "../../MainWindow/SecondaryWindow.svelte";
  import MailComposer from "./MailComposer.svelte";
  import { t } from "../../../l10n/l10n";

  export let mail: EMail;
</script>
