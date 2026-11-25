<!-- svelte-ignore a11y_no_static_element_interactions -->
<hbox class="reaction bar">
  <RoundButton
    label={$t`Copy`}
    icon={hasCopied ? CheckIcon : CopyIcon}
    onClick={onCopy}
    border={false} classes="plain"
    padding="4px"
    />
  {#if message instanceof ChatMessage && message.canEdit}
    <RoundButton
      label={$t`Edit`}
      icon={EditIcon}
      onClick={onEdit}
      border={false} classes="plain"
      padding="4px"
      />
  {/if}
  {#if message instanceof ChatMessage && message.canDeleteForOthers}
    <ButtonMenu bind:isMenuOpen={isDeleteMenuOpen}>
      <RoundButton
        label={$t`Delete`}
        icon={TrashIcon}
        onClick={() => isDeleteMenuOpen = !isDeleteMenuOpen}
        border={false} classes="plain"
        padding="4px"
        slot="control"
        />
      <MenuItem
        label={$t`Delete for myself`}
        icon={TrashIcon}
        onClick={onDelete}
        />
      <MenuItem
        label={$t`Delete for everybody`}
        icon={TrashIcon}
        onClick={onDeleteForOthers}
        />
    </ButtonMenu>
  {:else}
    <RoundButton
      label={$t`Delete`}
      icon={TrashIcon}
      onClick={onDelete}
      border={false} classes="plain"
      padding="4px"
      />
  {/if}
  <RoundButton
    label={$t`Reply`}
    icon={ReplyIcon}
    onClick={onReply}
    border={false} classes="plain"
    padding="4px"
    />
  <RoundButton
    label={$t`Forward`}
    icon={ForwardIcon}
    onClick={onForward}
    border={false} classes="plain"
    padding="4px"
    />
  <AddToTopicButton target={message} />
</hbox>

<script lang="ts">
  import { Message } from "../../../logic/Abstract/Message";
  import { ChatMessage } from "../../../logic/Chat/ChatMessage";
  import RoundButton from "../../Shared/RoundButton.svelte";
  import AddToTopicButton from "../../Topic/Picker/AddToTopicButton.svelte";
  import Toolbar from "../../Shared/Toolbar/Toolbar.svelte";
  import TrashIcon from "lucide-svelte/icons/trash-2";
  import EditIcon from "lucide-svelte/icons/pencil";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ForwardIcon from "lucide-svelte/icons/forward";
  import CopyIcon from "lucide-svelte/icons/copy";
  import CheckIcon from "lucide-svelte/icons/check";
  import ShareIcon from "lucide-svelte/icons/trash-2";
  import { assert, sleep } from "../../../logic/util/util";
  import ButtonMenu from "../../Shared/Menu/ButtonMenu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import { gt, t } from "../../../l10n/l10n";

  export let message: Message;

  let isDeleteMenuOpen = false;
  async function onDelete() {
    await message.deleteMessage();
  }
  async function onDeleteForOthers() {
    assert(message instanceof ChatMessage, "Cannot get back emails");
    await message.deleteForOthers();
  }
  async function onEdit() {
    assert(message instanceof ChatMessage, "Cannot get back emails");
    message.to.draftMessage = await message.createEdit();
  }
  async function onReply() {
    /*let previousText = message.to.draftMessage.html;
    message.to.draftMessage = await message.reply();
    if (previousText) {
      message.to.draftMessage.html += previousText;
    }*/
  }
  async function onForward() {
  }

  let hasCopied = false;
  async function onCopy() {
    await navigator.clipboard.writeText(message.text);
    hasCopied = true;
    await sleep(1);
    hasCopied = false
  }
</script>

<style>
  .bar {
    border-radius: 10px;
  }
</style>
