<RibbonTab label={$t`Message`} contextual={isInline} isSelected={isInline}>
  <RibbonGroup label={$t`Clipboard *=> Ribbon group with Cut, Copy and Paste`} icon={PasteIcon}>
    <RibbonSplitButton label={$t`Paste`} icon={PasteIcon} shortCutInfo={$t`Ctrl+V *=> Keyboard shortcut`}
      disabled={!editor} onClick={() => pasteClipboard(editor)}>
      <MenuItem label={$t`Keep Source Formatting`} icon={PasteIcon} onClick={() => pasteClipboard(editor)} />
      <MenuItem label={$t`Keep Text Only`} icon={PasteTextIcon} onClick={() => pasteClipboardAsText(editor)} />
    </RibbonSplitButton>
    <RibbonButton label={$t`Cut`} icon={CutIcon} size="small" shortCutInfo={$t`Ctrl+X *=> Keyboard shortcut`}
      disabled={!editor} onClick={() => cutSelection(editor)} />
    <RibbonButton label={$t`Copy`} icon={CopyIcon} size="small" shortCutInfo={$t`Ctrl+C *=> Keyboard shortcut`}
      disabled={!editor} onClick={() => copySelection(editor)} />
  </RibbonGroup>
  <RibbonGroup label={$t`Basic Text *=> Ribbon group with the basic text formatting`} icon={BoldIcon}>
    <RibbonButtonRow label={$t`Font style`}>
      <RibbonToggleButton label={$t`Bold`} icon={BoldIcon} shortCutInfo={$t`Ctrl+B *=> Keyboard shortcut`}
        selected={!!editor?.isActive("bold")} disabled={!editor}
        onClick={() => run(chain => chain.toggleBold())} />
      <RibbonToggleButton label={$t`Italic`} icon={ItalicIcon} shortCutInfo={$t`Ctrl+I *=> Keyboard shortcut`}
        selected={!!editor?.isActive("italic")} disabled={!editor}
        onClick={() => run(chain => chain.toggleItalic())} />
      <RibbonToggleButton label={$t`Underline *=> Text formatting: underlined text`} icon={UnderlineIcon} shortCutInfo={$t`Ctrl+U *=> Keyboard shortcut`}
        selected={!!editor?.isActive("underline")} disabled={!editor}
        onClick={() => run(chain => chain.toggleUnderline())} />
      <RibbonToggleButton label={$t`Strikethrough *=> Text formatting: crossed-out text`} icon={StrikethroughIcon}
        selected={!!editor?.isActive("strike")} disabled={!editor}
        onClick={() => run(chain => chain.toggleStrike())} />
    </RibbonButtonRow>
    <RibbonButtonRow label={$t`Paragraph *=> Buttons for paragraph formatting`}>
      <RibbonToggleButton label={$t`Bullets *=> Format the paragraphs as a bulleted list`} icon={BulletsIcon}
        selected={!!editor?.isActive("bulletList")} disabled={!editor}
        onClick={() => run(chain => chain.toggleBulletList())} />
      <RibbonToggleButton label={$t`Numbering *=> Format the paragraphs as a numbered list`} icon={NumberingIcon}
        selected={!!editor?.isActive("orderedList")} disabled={!editor}
        onClick={() => run(chain => chain.toggleOrderedList())} />
      <RibbonButton label={$t`Decrease Indent`} icon={OutdentIcon}
        disabled={!editor?.can().liftListItem("listItem") && $t`Only list items can be indented`}
        onClick={() => run(chain => chain.liftListItem("listItem"))} />
      <RibbonButton label={$t`Increase Indent`} icon={IndentIcon}
        disabled={!editor?.can().sinkListItem("listItem") && $t`Only list items can be indented`}
        onClick={() => run(chain => chain.sinkListItem("listItem"))} />
      <RibbonButton label={$t`Clear Formatting`} icon={ClearFormattingIcon}
        disabled={!editor}
        onClick={() => run(chain => chain.clearNodes().unsetAllMarks())} />
    </RibbonButtonRow>
  </RibbonGroup>
  <RibbonGroup label={$t`Names *=> Ribbon group with commands for the recipient names`}>
    <RibbonButton label={$t`Address Book`} icon={AddressBookIcon}
      onClick={() => { $openSelectNames = { mail, field: RecipientField.To }; }} />
    <RibbonButton label={$t`Check Names`} icon={CheckNamesIcon}
      tooltip={$t`Check the names you typed in the To, Cc and Bcc boxes against your address books`}
      onClick={() => { $checkNamesOf = mail; }} />
  </RibbonGroup>
  <RibbonGroup label={$t`Include *=> Ribbon group to add files, links and signatures to the email`} icon={AttachIcon}>
    <RibbonButton label={$t`Attach File`} icon={AttachIcon} size="small" onClick={onAddAttachment} />
    <RibbonButton label={$t`Link *=> Insert or edit a link in the text`} icon={LinkIcon} size="small" shortCutInfo={$t`Ctrl+K *=> Keyboard shortcut`}
      disabled={!editor} onClick={() => { $openEditorTool = { mail, tool: EditorTool.Link }; }} />
    <RibbonMenuButton label={$t`Signature`} icon={SignatureIcon} size="small">
      <SignatureMenuItems {identity} {editor} on:editSignatures={() => { $openSignatures = mail; }} />
    </RibbonMenuButton>
  </RibbonGroup>
  {#if isInline}
    <ShowFieldsGroup {mail} />
    <EncryptionButtons {mail} {identity} />
  {/if}
  <RibbonGroup label={$t`Editor *=> Ribbon group with settings of the text editor`}>
    <RibbonToggleButton label={$t`Spelling *=> Check the spelling while typing`} icon={SpellingIcon}
      tooltip={$t`Check spelling while typing`}
      selected={$spellcheck.value}
      onClick={() => { $spellcheck.value = !$spellcheck.value; }} />
  </RibbonGroup>
  <AddonRibbonGroup place="composer-toolbar" {mail} />
</RibbonTab>
<FileSelector bind:this={fileSelector} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { addFilesAsAttachments } from "../../../logic/Abstract/Attachment";
  import { EditorTool } from "../../Shared/Editor/EditorTool";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import { cutSelection, copySelection, pasteClipboard, pasteClipboardAsText } from "../../Shared/Editor/EditorClipboard";
  import RibbonTab from "../../Shared/Ribbon/RibbonTab.svelte";
  import AddonRibbonGroup from "../../Addons/AddonRibbonGroup.svelte";
  import RibbonGroup from "../../Shared/Ribbon/RibbonGroup.svelte";
  import RibbonButton from "../../Shared/Ribbon/RibbonButton.svelte";
  import RibbonToggleButton from "../../Shared/Ribbon/RibbonToggleButton.svelte";
  import RibbonMenuButton from "../../Shared/Ribbon/RibbonMenuButton.svelte";
  import RibbonSplitButton from "../../Shared/Ribbon/RibbonSplitButton.svelte";
  import RibbonButtonRow from "../../Shared/Ribbon/RibbonButtonRow.svelte";
  import { checkNamesOf, openEditorTool } from "./MailComposer.svelte";
  import { openSelectNames, RecipientField } from "./SelectNamesDialog.svelte";
  import { openSignatures } from "./SignaturesDialog.svelte";
  import SignatureMenuItems from "./SignatureMenuItems.svelte";
  import ShowFieldsGroup from "./ShowFieldsGroup.svelte";
  import EncryptionButtons from "./EncryptionButtons.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import FileSelector from "../../../frontend/Mail/Composer/Attachments/FileSelector.svelte";
  import BoldIcon from "lucide-svelte/icons/bold";
  import ItalicIcon from "lucide-svelte/icons/italic";
  import UnderlineIcon from "lucide-svelte/icons/underline";
  import StrikethroughIcon from "lucide-svelte/icons/strikethrough";
  import BulletsIcon from "lucide-svelte/icons/list";
  import NumberingIcon from "lucide-svelte/icons/list-ordered";
  import ClearFormattingIcon from "lucide-svelte/icons/remove-formatting";
  import AddressBookIcon from "lucide-svelte/icons/book-user";
  import AttachIcon from "lucide-svelte/icons/paperclip";
  import LinkIcon from "lucide-svelte/icons/link";
  import SpellingIcon from "lucide-svelte/icons/spell-check";
  import SignatureIcon from "lucide-svelte/icons/pen-line";
  import PasteIcon from "lucide-svelte/icons/clipboard-paste";
  import PasteTextIcon from "lucide-svelte/icons/clipboard-type";
  import CutIcon from "lucide-svelte/icons/scissors";
  import CopyIcon from "lucide-svelte/icons/copy";
  import OutdentIcon from "lucide-svelte/icons/list-indent-decrease";
  import IndentIcon from "lucide-svelte/icons/list-indent-increase";
  import CheckNamesIcon from "lucide-svelte/icons/user-check";
  import { t } from "../../../l10n/l10n";
  import type { ChainedCommands, Editor } from "@tiptap/core";

  export let mail: EMail;
  export let editor: Editor | null;
  export let isInline = false;

  const spellcheck = getLocalStorage<boolean>("mail.send.spellcheck.enabled", false);
  $: identity = mail.identity;

  function run(command: (chain: ChainedCommands) => ChainedCommands) {
    command(editor.chain().focus()).run();
  }

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
</script>
