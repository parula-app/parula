<Ribbon id="mail-write">
  <ComposerMessageTab {mail} {editor} {onSelectNames} {onCheckNames} onOpenTool={tool => openedTool = tool} {onEditSignatures} />
  <InsertTab {editor} bind:openedTool onAttachFile={onAddAttachment} {onInsertPicture} bind:showEmojis>
    <svelte:fragment slot="include">
      <RibbonMenuButton label={$t`Signature`} icon={SignatureIcon}>
        <SignatureMenuItems {identity} {editor} on:editSignatures={onEditSignatures} />
      </RibbonMenuButton>
    </svelte:fragment>
    <svelte:fragment slot="groups">
      <PollsGroup {mail} />
    </svelte:fragment>
  </InsertTab>
  <RibbonTab label={$t`Options *=> Ribbon tab with options for the email being written`}>
    <ShowFieldsGroup {mail} />
    <EncryptionButtons {mail} {identity} />
  </RibbonTab>
  <FormatTextTab {editor} bind:openedTool />
  <ReviewTab {editor} bind:openedTool />
</Ribbon>
<FileSelector bind:this={fileSelector} />
<FileSelector bind:this={imageSelector} acceptFileTypes={["image/png", "image/jpeg", "image/gif"]} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { addFilesAsAttachments } from "../../../logic/Abstract/Attachment";
  import { insertImage } from "../../../frontend/Shared/Editor/InsertImage";
  import type { EditorTool } from "../../Shared/Editor/EditorTool";
  import Ribbon from "../../Shared/Ribbon/Ribbon.svelte";
  import RibbonTab from "../../Shared/Ribbon/RibbonTab.svelte";
  import RibbonMenuButton from "../../Shared/Ribbon/RibbonMenuButton.svelte";
  import InsertTab from "../../Shared/Editor/InsertTab.svelte";
  import FormatTextTab from "../../Shared/Editor/FormatTextTab.svelte";
  import ReviewTab from "../../Shared/Editor/ReviewTab.svelte";
  import ComposerMessageTab from "./ComposerMessageTab.svelte";
  import ShowFieldsGroup from "./ShowFieldsGroup.svelte";
  import EncryptionButtons from "./EncryptionButtons.svelte";
  import SignatureMenuItems from "./SignatureMenuItems.svelte";
  import PollsGroup from "./PollsGroup.svelte";
  import type { RecipientField } from "./SelectNamesDialog.svelte";
  import FileSelector from "../../../frontend/Mail/Composer/Attachments/FileSelector.svelte";
  import SignatureIcon from "lucide-svelte/icons/pen-line";
  import { t } from "../../../l10n/l10n";
  import type { Editor } from "@tiptap/core";

  export let mail: EMail;
  export let editor: Editor | null;
  export let showEmojis = false;
  export let openedTool: EditorTool | null = null;
  export let onSelectNames: (field: RecipientField) => void;
  export let onCheckNames: () => Promise<void>;
  export let onEditSignatures: () => void;

  $: identity = mail.identity;

  /* <copied from="../../../frontend/Mail/Composer/MailComposer.svelte"> */
  let fileSelector: FileSelector;
  async function onAddAttachment() {
    let files = await fileSelector.selectFiles();
    if (!files?.length) {
      return;
    }
    addFilesAsAttachments(mail, files);
  }
  /* </copied> */

  let imageSelector: FileSelector;
  async function onInsertPicture() {
    let files = await imageSelector.selectFiles();
    for (let file of files ?? []) {
      await insertImage(editor, file, mail);
    }
  }
</script>
