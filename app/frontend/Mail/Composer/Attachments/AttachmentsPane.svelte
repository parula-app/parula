<vbox flex class="attachments-pane">
  <Scroll>
    {#each $attachments.each as attachment}
      <AttachmentEntry {attachment} {attachments} />
    {/each}
    <hbox class="buttons">
      <RoundButton
        icon={AddIcon} label={$t`Add attachment`}
        onClick={onAdd}
        />
    </hbox>
  </Scroll>
</vbox>

<FileSelector bind:this={fileSelector} />

<script lang="ts">
  import { addFilesAsAttachments, type MessageWithAttachments } from "../../../../logic/Abstract/Attachment";
  import AttachmentEntry from "./AttachmentEntry.svelte";
  import FileSelector from "./FileSelector.svelte";
  import RoundButton from "../../../Shared/RoundButton.svelte";
  import Scroll from "../../../Shared/Scroll.svelte";
  import AddIcon from "lucide-svelte/icons/plus";
  import { t } from "../../../../l10n/l10n";

  /** The email, chat message or calendar event to attach the files to */
  export let message: MessageWithAttachments;
  $: attachments = message.attachments;

  let fileSelector: FileSelector;
  export async function onAdd() {
    let files = await fileSelector.selectFiles();
    if (!files?.length) {
      console.log("no file selected");
      return;
    }
    addFilesAsAttachments(message, files);
  }
</script>

<style>
  .buttons {
    justify-content: center;
    margin-block-start: 12px;
  }
</style>
