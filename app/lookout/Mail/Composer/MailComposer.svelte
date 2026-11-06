<vbox flex class="composer-page" class:inline={isInline} on:keydown|capture={event => catchErrors(() => onKey(event))}>
  {#if !isInline}
    <ComposerRibbon {mail} {editor} bind:showEmojis bind:openedTool />
  {/if}
  <vbox flex class="composer" class:lo-card={!isInline} on:keydown={onEscape}>
    <FileDropTarget
      on:add-files={(event) => catchErrors(() => onFilesDrop(event))}
      on:inline-files={(event) => catchErrors(() => onFileInlineDrop(event))}
      allowInline={true}>
      {#if isInline}
        <hbox class="inline-buttons">
          <DialogButton label={$t`Discard`} icon={DiscardIcon} classes="plain"
            tooltip={$t`Discard this response`}
            onClick={onDiscard} />
          <DialogButton label={$t`Pop Out *=> Open this reply in its own message page`} icon={PopOutIcon} classes="plain"
            tooltip={$t`Open this response in its own message page`}
            onClick={onPopOut} />
        </hbox>
      {:else}
        <hbox class="title-row">
          <h1>{$mail.subject || $t`Untitled *=> Title for an email that has no subject yet`}<span class="kind">– {$sendFormat.value == "html" ? $t`Message (HTML)` : $t`Message (Plain Text)`}</span></h1>
          <hbox flex />
          <hbox class="title-buttons">
            <UndoRedoButtons {editor} />
            <DialogButton label={$t`Save`} icon={SaveIcon} classes="plain"
              tooltip={$t`Save as draft (Ctrl+S)`}
              onClick={onSave} />
            <DialogButton label={$t`Discard`} icon={DiscardIcon} classes="plain"
              onClick={onDiscard} />
            <button class="close" title={$t`Close`} aria-label={$t`Close`} on:click={onCloseRequest}>
              <CloseIcon size={18} />
            </button>
          </hbox>
        </hbox>
      {/if}
      <hbox class="header">
        <button class="send" on:click={() => catchErrors(onSendRequest)}
          class:disabled={!!sendDisabledTooltip}
          title={sendDisabledTooltip ?? $t`Send (Ctrl+Enter)`}
          tabindex={2}>
          <SendIcon size={24} strokeWidth={1.5} />
          <span>{$t`Send *=> send emails`}</span>
        </button>
        <grid class="fields">
          {#if showFromRow}
            <IdentitySelector bind:selectedIdentity={fromIdentity}
              bind:fromAddress={mail.from.emailAddress}
              bind:fromName={mail.from.name} />
          {/if}
          <button class="field-button" on:click={() => $openSelectNames = { mail, field: RecipientField.To }} tabindex={-1}
            title={$t`Select recipients from the address book`}>
            {$t`To`}
          </button>
          <hbox class="field">
            <MailAutocomplete addresses={mail.to} label={$t`To`} chips={isChips} tabindex={1} askForName
              autofocus={autofocus && mail.to.isEmpty} on:add={event => onRecipientAdded(event.detail)} bind:this={toField} />
          </hbox>
          <button class="field-button" on:click={() => $openSelectNames = { mail, field: RecipientField.Cc }} tabindex={-1}
            title={$t`Select recipients from the address book`}>
            {$t`Cc`}
          </button>
          <hbox class="field">
            <MailAutocomplete addresses={mail.cc} label={$t`Cc`} chips={isChips} tabindex={1} askForName
              on:add={event => onRecipientAdded(event.detail)} bind:this={ccField} />
          </hbox>
          {#if showBCC}
            <button class="field-button" on:click={() => $openSelectNames = { mail, field: RecipientField.Bcc }} tabindex={-1}
              title={$t`Select recipients from the address book`}>
              {$t`Bcc`}
            </button>
            <hbox class="field">
              <MailAutocomplete addresses={mail.bcc} label={$t`Bcc`} chips={isChips} tabindex={1} askForName
                on:add={event => onRecipientAdded(event.detail)} bind:this={bccField} />
            </hbox>
          {/if}
          <label class="subject-label" for="composer-subject">{$t`Subject`}</label>
          <hbox class="field subject">
            <input id="composer-subject" type="text" bind:value={mail.subject} tabindex={1} />
          </hbox>
        </grid>
      </hbox>
      {#if $mail.shouldEncrypt || $mail.signedByKeyID}
        <hbox class="info-bar">
          {#if $mail.shouldEncrypt}
            <LockIcon size={16} />
            {$t`This message will be encrypted and digitally signed`}
          {:else}
            <SignIcon size={16} />
            {$t`This message will be digitally signed`}
          {/if}
        </hbox>
      {/if}
      <EncryptionDetails {mail} identity={fromIdentity} bind:encryptionError />
      {#if hasAttachments}
        <hbox class="attachments">
          <AttachmentsUI attachments={mail.attachments} isComposing />
        </hbox>
      {/if}
      <hbox flex class="body">
        <vbox flex class="editor-scroll">
          {#if loading}
            <hbox class="loading"><Spinner size="32px" /></hbox>
          {/if}
          <SMLComposer bind:mail />
          <vbox flex class="editor" spellcheck={$spellcheck.value}>
            <!-- The html in the mail passed in MUST already be sanitized HTML.
            Using `rawHTMLDangerous` avoids that we're sanitizing on every keypress. -->
            <HTMLEditor bind:html={mail.rawHTMLDangerous} bind:editor tabindex={1} />
          </vbox>
        </vbox>
        {#if showEmojis}
          <EmojiPane {editor} bind:isOpen={showEmojis} />
        {/if}
      </hbox>
    </FileDropTarget>
  </vbox>
</vbox>

{#if isSelectNamesOpen}
  <SelectNamesDialog {mail} defaultField={$openSelectNames.field}
    on:close={() => $openSelectNames = null} />
{/if}
{#if showSaveChanges}
  <SaveChangesDialog
    onYes={onSaveAndClose}
    onNo={onDiscard}
    on:close={() => showSaveChanges = false} />
{/if}
{#if showSignatures}
  <SignaturesDialog identity={fromIdentity} on:close={() => $openSignatures = null} />
{/if}
<EditorToolDialogs {editor} bind:openedTool />

<script lang="ts" context="module">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { EditorTool } from "../../Shared/Editor/EditorTool";
  import { writable } from "svelte/store";

  export const checkNamesOf = writable<EMail | null>(null);
  export const openEditorTool = writable<{ mail: EMail, tool: EditorTool } | null>(null);
</script>

<script lang="ts">
  import type { PersonUID } from "../../../logic/Abstract/PersonUID";
  import { addFilesAsAttachments } from "../../../logic/Abstract/Attachment";
  import { findAllIdentities, type MailIdentity } from "../../../logic/Mail/MailIdentity";
  import { SpecialFolder } from "../../../logic/Mail/Folder";
  import { appGlobal } from "../../../logic/app";
  import { UserError, assert } from "../../../logic/util/util";
  import { insertImage } from "../../../frontend/Shared/Editor/InsertImage";
  import { WriteMailMustangApp, mailMustangApp } from "../../../frontend/Mail/MailMustangApp";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import type { RibbonLayout } from "../../Shared/Ribbon/RibbonGroup";
  import { removeInlineReply } from "./InlineReplies";
  import { inlineRibbon } from "../Selected";
  import { get } from "svelte/store";
  import { MessageActions } from "../MessageActions";
  import { goBack } from "../../../frontend/AppsBar/selectedApp";
  import { minorError, catchErrors, showError, showUserError } from "../../../frontend/Util/error";
  import { isTextField } from "../../Util/util";
  import { getOSName } from "../../../frontend/Util/util";
  import { getMyPrivateKey } from "../../../logic/Mail/Encryption/KeyUtils";
  import { hasUserText } from "./DraftContent";
  import ComposerRibbon from "./ComposerRibbon.svelte";
  import SelectNamesDialog, { RecipientField, openSelectNames } from "./SelectNamesDialog.svelte";
  import SaveChangesDialog from "./SaveChangesDialog.svelte";
  import SignaturesDialog, { openSignatures } from "./SignaturesDialog.svelte";
  import EditorToolDialogs from "../../Shared/Editor/EditorToolDialogs.svelte";
  import EmojiPane from "../../Shared/Editor/EmojiPane.svelte";
  import UndoRedoButtons from "../../Shared/Editor/UndoRedoButtons.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import MailAutocomplete from "./MailAutocomplete.svelte";
  import IdentitySelector from "./IdentitySelector.svelte";
  import EncryptionDetails from "./EncryptionDetails.svelte";
  import SMLComposer from "./SMLComposer.svelte";
  import AttachmentsUI from "../Message/AttachmentsUI.svelte";
  import FileDropTarget from "../../../frontend/Mail/Composer/Attachments/FileDropTarget.svelte";
  import HTMLEditor from "../../../frontend/Shared/Editor/HTMLEditor.svelte";
  import Spinner from "../../../frontend/Shared/Spinner.svelte";
  import SendIcon from "lucide-svelte/icons/send";
  import SaveIcon from "lucide-svelte/icons/save";
  import DiscardIcon from "lucide-svelte/icons/trash-2";
  import CloseIcon from "lucide-svelte/icons/x";
  import PopOutIcon from "lucide-svelte/icons/square-arrow-out-up-right";
  import LockIcon from "lucide-svelte/icons/lock";
  import SignIcon from "lucide-svelte/icons/signature";
  import { t } from "../../../l10n/l10n";
  import { onDestroy, tick } from "svelte";
  import type { Editor } from "@tiptap/core";

  export let mail: EMail;
  export let isInline = false;
  export let autofocus = true;

  let editor: Editor;
  $: to = mail.to;
  let fromIdentity: MailIdentity;
  /* <copied to="ShowFieldsGroup.svelte"> */
  let identities = findAllIdentities();
  $: hasSeveralIdentities = $identities.length > 1 || !!fromIdentity?.isCatchAll;
  /* </copied> */
  const spellcheck = getLocalStorage<boolean>("mail.send.spellcheck.enabled", false);
  const showFromSetting = getLocalStorage<boolean>("lookout.mail.compose.showFrom", true);
  const sendFormat = getLocalStorage<string>("mail.send.format", "html");
  const showBccSetting = getLocalStorage<boolean>("lookout.mail.compose.showBcc", false);
  let encryptionError: string | null = null;
  let showEmojis = false;
  $: isSelectNamesOpen = $openSelectNames?.mail == mail;
  let showSaveChanges = false;
  $: showSignatures = $openSignatures == mail;
  let openedTool: EditorTool | null = null;
  let ribbonLayout = getLocalStorage<RibbonLayout>("lookout.ribbon.layout", "classic");
  $: isChips = $ribbonLayout.value == "simplified";
  let toField: MailAutocomplete;
  let ccField: MailAutocomplete;
  let bccField: MailAutocomplete;

  // <copied from="../../../frontend/Mail/Composer/MailComposer.svelte">
  // HACK to reload the HTMLEditor to force it to load the new text
  // See <https://github.com/ueberdosis/tiptap/issues/4918>
  let lastMail = null;
  $: differentMailLoaded(mail);
  function differentMailLoaded(_dummy: any) {
    if (closing) {
      return;
    }
    if (mail == lastMail || !mail) {
      return;
    }
    lastMail = mail;

    fromIdentity = mail.identity
      ?? mail.folder?.account.identities.first
      ?? appGlobal.emailAccounts.first?.identities.first;
    assert(fromIdentity, "Composer: Need identity or account for email");
    // setAuthor() called

    if (mail.from?.emailAddress) {
      let recipients = [mail.from, ...mail.to.contents, ...mail.cc.contents, ...mail.bcc.contents];
      checkInvalidRecipients(recipients);
    }

    loadText()
      .catch(minorError);
  }

  let loading = false;
  async function loadText() {
    if (!mail.hasHTML) {
      return;
    }
    loading = true;
    await mail.loadBody();
    loading = false;
    if (!editor) {
      await tick();
    }
    editor.commands.setContent(mail.html);
    setCursorDefault();
  }

  function setCursorDefault() {
    if (mail.to.isEmpty || !autofocus) {
      return;
    }
    let quoteSetting = getLocalStorage("mail.send.quote", "below").value;
    let below = quoteSetting == "below";
    editor.commands.focus(below ? 'start' : 'end');
  }

  $: fromIdentity && setAuthor()
  function setAuthor() {
    mail.identity = fromIdentity;
    mail.folder ??= fromIdentity.account.getSpecialFolder(SpecialFolder.Sent)
      ?? fromIdentity.account.inbox;
    if (fromIdentity == mail.identity) {
      return; // don't overwrite concrete email address for catch-all identity
    }
    mail.from = fromIdentity.asPersonUID();
  }

  function checkInvalidRecipients(recipients: PersonUID[]) {
    const kNoReplyRegExp = /no[\-_t]*reply@|invalid$/;
    let invalidTo = recipients.find(person =>
      !person.emailAddress || kNoReplyRegExp.test(person.emailAddress));
    if (invalidTo) {
      let notification = showUserError(new UserError($t`The recipient ${invalidTo.emailAddress} does not accept email`));
      doOnClose.push(() => notification.remove());
    }
  }

  function onRecipientAdded(recipient: PersonUID) {
    // <copied from="../../../frontend/Mail/Composer/MailAutocomplete.svelte" onAddPerson()>
    // Get the certificate now, so that we can show whether we can encrypt
    recipient.fetchEncryptionKeys()
      .catch(showError);
    // </copied>
  }

  function onFilesDrop(event: CustomEvent) {
    addFilesAsAttachments(mail, event.detail.files as File[]);
  }

  async function onFileInlineDrop(event: CustomEvent) {
    let files = event.detail.files as File[];
    for (let file of files) {
      await insertImage(editor, file, mail);
    }
  }

  $: sendDisabledTooltip =
    !mail.subject ? $t`Please enter a subject` :
    $to.isEmpty ? $t`Please add some recipients` :
    encryptionError ??
    null;

  async function onSend() {
    try {
      await mail.compose.send(onClose);
    } catch (ex) {
      if (closing) { // Already closed. Re-open, to not lose the mail.
        mailMustangApp.writeMail(mail);
      }
      throw ex;
    }
  }

  let closing = false;
  let doOnClose: (() => void)[] = [];
  function onClose() {
    closing = true;
    for (let func of doOnClose) {
      func();
    }
    doOnClose = [];
    if (isInline) {
      removeInlineReply(mail);
      return;
    }

    let me = mailMustangApp.subApps.find(app => app instanceof WriteMailMustangApp && app.windowParams.mail == mail);
    mailMustangApp.subApps.remove(me);
    goBack();
  }

  $: bccList = mail.bcc;
  $: attachmentsList = mail.attachments;
  $: hasBCC = $bccList.hasItems;
  $: hasAttachments = $attachmentsList.hasItems;
  // </copied>
  $: showBCC = $showBccSetting.value || hasBCC;
  $: showFromRow = $showFromSetting.value && hasSeveralIdentities;

  $: privateKey = fromIdentity ? getMyPrivateKey(fromIdentity) ?? null : null;
  // <copied from="../../../frontend/Mail/Composer/EncryptionButtons.svelte">
  $: privateKey, fromIdentity && catchErrors(changedIdentity);
  function changedIdentity() {
    let extra = mail as any;
    if (privateKey) {
      if (!mail.signedByKeyID && privateKey.useToSign) {
        mail.signedByKeyID = privateKey.id;
        extra.signOnlyByDefault = true;
      }
      if (!mail.shouldEncrypt && privateKey.encryptByDefault) {
        mail.shouldEncrypt = true;
        extra.encryptOnlyByDefault = true;
      }
      if (mail.signedByKeyID && extra.signOnlyByDefault && !privateKey.useToSign) {
        mail.signedByKeyID = null;
        extra.signOnlyByDefault = false;
      }
      if (mail.shouldEncrypt && extra.encryptOnlyByDefault && !privateKey.encryptByDefault) {
        mail.shouldEncrypt = null;
        extra.encryptOnlyByDefault = false;
      }
    } else {
      assert(!mail.mustEncrypt, $t`This email must be encrypted`);
      mail.shouldEncrypt = false;
      mail.signedByKeyID = null;
    }
  }
  // </copied>

  $: if (isInline && !closing) {
    $inlineRibbon = { draft: mail, editor };
  }
  onDestroy(() => {
    if (get(inlineRibbon)?.draft == mail) {
      inlineRibbon.set(null);
    }
  });

  function onPopOut() {
    closing = true;
    MessageActions.popOut(mail);
  }

  async function onSendRequest() {
    if (sendDisabledTooltip) {
      throw new UserError(sendDisabledTooltip);
    }
    await onSend();
  }

  async function onSave() {
    await mail.compose.saveAsDraft();
  }

  async function onSaveAndClose() {
    await onSave();
    showSaveChanges = false;
    onClose();
  }

  async function onDiscard() {
    // <copied from="../../../frontend/Mail/Composer/CloseButton.svelte" onDelete()>
    onClose();
    await mail.compose.deleteDrafts();
    // </copied>
  }

  function onCloseRequest() {
    if (hasUserText(mail.html)) {
      showSaveChanges = true;
    } else {
      onClose();
    }
  }

  $: if ($openEditorTool?.mail == mail) {
    openedTool = $openEditorTool.tool;
    $openEditorTool = null;
  }

  $: if ($checkNamesOf == mail) {
    $checkNamesOf = null;
    catchErrors(onCheckNames);
  }
  async function onCheckNames() {
    let fields = [toField, ccField, bccField].filter(field => !!field);
    let errors: Error[] = [];
    for (let field of fields) {
      try {
        await field.checkNames();
      } catch (ex) {
        errors.push(ex);
      }
    }
    if (errors.length) {
      throw errors[0];
    }
  }

  function onEscape(event: KeyboardEvent) {
    // ProseMirror prevents the default of every Escape in the message body
    if (event.key != "Escape" || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey ||
        !isTextField(event.target) ||
        event.defaultPrevented && !(event.target as HTMLElement).closest("[contenteditable]:not([contenteditable='false'])") ||
        isSelectNamesOpen || showSaveChanges || showSignatures || openedTool) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onCloseRequest();
  }

  async function onKey(event: KeyboardEvent) {
    if (isSelectNamesOpen || showSaveChanges || showSignatures || openedTool) {
      return;
    }
    let isCtrl = event.ctrlKey || event.metaKey;
    // Ctrl+ (or Cmd+)
    if (isCtrl && !event.altKey && !event.shiftKey) {
      if (event.key == "Enter") {
        event.preventDefault();
        event.stopPropagation();
        await onSendRequest();
        return;
      } else if (event.code == "KeyS") {
        event.preventDefault();
        event.stopPropagation();
        await onSave();
        return;
      }
    }
    // Alt+ (Option+S types a character on macOS)
    if (event.altKey && !isCtrl && !event.shiftKey && getOSName() != "macintosh") {
      if (event.code == "KeyS") {
        event.preventDefault();
        event.stopPropagation();
        await onSendRequest();
        return;
      }
    }
    if (editor) {
      onKeyOnEditor(event);
    }
  }

  // <copied to="../../Calendar/EditEvent/EditEvent.svelte">
  function onKeyOnEditor(event: KeyboardEvent) {
    let isCtrl = event.ctrlKey || event.metaKey;
    // Ctrl+ (or Cmd+)
    if (isCtrl && !event.altKey && !event.shiftKey) {
      if (event.code == "KeyK") {
        event.preventDefault();
        event.stopPropagation();
        openedTool = EditorTool.Link;
        return;
      } else if (event.code == "KeyH") {
        event.preventDefault();
        event.stopPropagation();
        openedTool = EditorTool.Replace;
        return;
      }
    }
    // No modifier
    if (!isCtrl && !event.altKey && !event.shiftKey) {
      if (event.key == "F4") {
        event.preventDefault();
        event.stopPropagation();
        openedTool = EditorTool.Find;
        return;
      }
    }
  }
  // </copied>
</script>

<style>
  .composer-page {
    min-height: 0;
  }
  .composer {
    min-height: 0;
    margin: 0 8px 8px 8px;
    overflow: hidden;
  }
  .composer-page.inline {
    border-block-start: 1px solid var(--lo-divider);
  }
  .inline .composer {
    margin: 0;
  }
  .inline-buttons {
    flex-shrink: 0;
    justify-content: end;
    gap: 4px;
    padding: 4px 12px 0 20px;
  }
  .inline .header {
    padding-inline: 20px;
  }
  .inline .editor-scroll {
    padding-inline: 20px;
  }
  .composer :global(.container),
  .composer :global(.container > .content) {
    min-height: 0;
    min-width: 0;
  }
  .title-row {
    flex-shrink: 0;
    align-items: center;
    gap: 12px;
    padding: 10px 12px 6px 24px;
  }
  h1 {
    min-width: 0;
    margin: 0;
    font-size: var(--lo-font-size-large);
    font-weight: 600;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  h1 .kind {
    margin-inline-start: 8px;
    font-weight: normal;
    color: var(--lo-fg-secondary);
  }
  .title-buttons {
    flex-shrink: 0;
    align-items: center;
    gap: 4px;
  }
  .close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
  }
  .close:hover {
    background-color: var(--lo-danger);
    color: var(--lo-danger-fg);
  }
  .header {
    flex-shrink: 0;
    align-items: start;
    gap: 12px;
    padding: 8px 24px 12px 24px;
    border-block-end: 1px solid var(--lo-divider);
  }
  /* <copied to="../../Calendar/EditEvent/SendButton.svelte"> */
  .send {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex-shrink: 0;
    width: 64px;
    height: 76px;
    margin-block-start: 2px;
    border: none;
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-accent);
    color: var(--lo-accent-fg);
    font-size: var(--lo-font-size);
  }
  .send:hover {
    background-color: var(--lo-accent-hover);
  }
  .send:active {
    background-color: var(--lo-accent-pressed);
  }
  .send.disabled {
    opacity: 0.55;
  }
  /* </copied> */
  .fields {
    flex: 1 1 0;
    min-width: 0;
    grid-template-columns: 80px 1fr;
    align-items: center;
    column-gap: 12px;
    row-gap: 6px;
  }
  .fields :global(.field-button) {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-bg);
    color: var(--lo-fg);
    font-size: var(--lo-font-size);
  }
  .fields :global(.field-button:hover) {
    background-color: var(--lo-hover-bg);
    border-color: var(--lo-border-strong);
  }
  .field {
    min-width: 0;
    min-height: 32px;
    align-items: center;
    border-block-end: 1px solid var(--lo-input-border);
  }
  .field:focus-within {
    border-block-end-color: var(--lo-accent);
    box-shadow: 0 1px 0 0 var(--lo-accent);
  }
  .field > :global(*) {
    flex: 1 1 0;
    min-width: 0;
  }
  .field input {
    border: none;
    outline: none;
    background-color: transparent;
    color: var(--lo-fg);
  }
  .subject-label {
    justify-self: center;
    color: var(--lo-fg-secondary);
  }
  .subject input {
    height: 30px;
    padding: 0 2px;
    font: inherit;
  }
  .info-bar {
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
    margin: 8px 24px 0 24px;
    padding: 6px 12px;
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-accent-tint);
    color: var(--lo-fg);
    font-size: var(--lo-font-size-small);
  }
  .info-bar :global(svg) {
    color: var(--lo-accent-text);
  }
  .attachments {
    flex-shrink: 0;
    padding: 10px 24px;
    border-block-end: 1px solid var(--lo-divider);
  }
  .body {
    min-height: 0;
  }
  .editor-scroll {
    min-height: 0;
    overflow-y: auto;
    padding: 16px 24px;
  }
  .editor {
    min-height: 200px;
    font-size: 15px;
    line-height: 1.5;
  }
  .editor :global(.ProseMirror) {
    min-height: 200px;
  }
  .editor :global(.html-editor blockquote) {
    border-left-color: var(--lo-accent);
  }
  .loading {
    justify-content: center;
    padding: 16px;
  }
</style>
