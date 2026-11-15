<hbox style="justify-content: center">{$t`The threaded view does not yet work as intended.`}</hbox>
<Scroll>
  <vbox class="messages background-pattern">
    {#each $threadMessages.each as message, i}
      <MailMessage {message} previousMessage={threadMessages.getIndex(i - 1)} />
    {/each}
  </vbox>
  <vbox class="rest background-pattern" flex />
</Scroll>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { newSearchEMail } from "../../../logic/Mail/Store/setStorage";
  import MailMessage from "../MailChat/MailMessage.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import { ArrayColl } from "svelte-collections";
  import { catchErrors } from "../../Util/error";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;

  let threadMessages = new ArrayColl<EMail>();
  $: message && catchErrors(getThread);
  async function getThread() {
    threadMessages.clear();
    threadMessages.add(message);
    message.html;
    await message.findThread(message.folder.messages);
    if (!message.threadID) {
      return;
    }
    let search = newSearchEMail();
    search.threadID = message.threadID;
    threadMessages.clear();
    let msgs = await search.startSearch();
    msgs = msgs.sortBy(email => email.sent.getTime());
    threadMessages.addAll(msgs);
    for (let msg of threadMessages) {
      msg.html;
    }
  }
</script>

<style>
  @media (prefers-color-scheme: light) {
    .messages,
    .rest {
      background-color: #F0F0F5;
      color: black;
    }
    .messages :global(.from) {
      color: black;
      font-size: 16px;
    }
  }
</style>
