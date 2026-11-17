<StatusMessage status="warning" message={$t`POP3 either *deletes* the emails on the server, so your phone and other devices cannot get those mails anymore. Or it causes a lot of unnecessary Internet traffic for mail check, even if you have no new mail. POP3 is no longer adequate as soon as you use more than one device. Use IMAP, if possible. (Exceptions are Google and Outlook.)`}>
  <AlertIcon slot="icon" size={20} />
</StatusMessage>

<script lang="ts">
  import StatusMessage from "../Shared/StatusMessage.svelte";
  import AlertIcon from "lucide-svelte/icons/alert-triangle";
  import { t } from "../../../l10n/l10n";
</script>
