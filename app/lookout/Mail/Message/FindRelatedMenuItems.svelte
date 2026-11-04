<MenuItem label={$t`Messages in This Conversation`} icon={ConversationIcon}
  disabled={!isInConversation && $t`This message is not part of a conversation`}
  onClick={findConversation} />
<MenuItem label={$t`Messages from or to Sender`} icon={SenderIcon}
  disabled={!sender && (message.outgoing ? $t`You sent this message` : $t`The sender is not in your address books`)}
  onClick={() => findRelated({ person: sender })} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { assert } from "../../../logic/util/util";
  import { globalSearchTerm } from "../../../frontend/AppsBar/selectedApp";
  import { defaultSearchOptions, type SearchOptions } from "../Search/MailSearch";
  import { searchOptions } from "../Selected";
  import { MessageActions } from "../MessageActions";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import ConversationIcon from "lucide-svelte/icons/messages-square";
  import SenderIcon from "lucide-svelte/icons/user-search";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;

  $: sender = MessageActions.senderPerson(message);
  $: isInConversation = !!(message.threadID ?? message.inReplyTo);

  async function findConversation() {
    // <copied from="../../../frontend/Mail/Thread/ThreadPane.svelte">
    await message.findThread(message.folder.messages);
    // </copied>
    assert(message.threadID, $t`This message is not part of a conversation`);
    findRelated({ threadID: message.threadID });
  }

  function findRelated(change: Partial<SearchOptions>) {
    $globalSearchTerm = null;
    $searchOptions = { ...defaultSearchOptions(), scope: $searchOptions.scope, ...change };
  }
</script>
