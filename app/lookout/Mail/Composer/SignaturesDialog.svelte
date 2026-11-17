<Dialog title={$t`Signatures and Stationery`} on:close={onCancel} width="700px" height="640px"
  okLabel={$t`OK`} onOK={onOK}>
  <hbox class="tab-strip" role="tablist">
    <button type="button" class="tab selected" role="tab" aria-selected="true">{$t`E-mail Signature`}</button>
  </hbox>
  <vbox flex class="tab-page">
    <hbox class="account-row">
      <span>{$t`E-mail account`}</span>
      <ComboBox label={$t`E-mail account`} options={$accounts.contents.map(mailAccount => ({ value: mailAccount, label: mailAccount.name }))}
        bind:value={account} width="280px" />
    </hbox>
    <vbox class="section">
      <hbox class="caption">{$t`Select signature to edit`}</hbox>
      <vbox class="signature-list" role="listbox" aria-label={$t`Select signature to edit`}>
        {#each identities as identity (identity.id)}
          <button type="button" class="signature" role="option"
            aria-selected={identity == selected} class:selected={identity == selected}
            on:click={() => select(identity)}>
            <span class="name">{identity.emailAddress}</span>
            {#if identity.realname}
              <span class="realname lo-secondary">{identity.realname}</span>
            {/if}
            {#if !hasSignature(identity, edits)}
              <span class="empty lo-secondary">{$t`(none) *=> This identity has no signature`}</span>
            {/if}
          </button>
        {/each}
      </vbox>
    </vbox>
    <vbox flex class="section edit">
      <hbox class="caption">{$t`Edit signature`}</hbox>
      <hbox class="toolbar">
        <button type="button" class="tool" class:pressed={isActive("bold")} title={$t`Bold`} aria-label={$t`Bold`}
          disabled={!editor} on:click={() => run(chain => chain.toggleBold())}>
          <BoldIcon size={16} />
        </button>
        <button type="button" class="tool" class:pressed={isActive("italic")} title={$t`Italic`} aria-label={$t`Italic`}
          disabled={!editor} on:click={() => run(chain => chain.toggleItalic())}>
          <ItalicIcon size={16} />
        </button>
        <button type="button" class="tool" class:pressed={isActive("underline")} title={$t`Underline *=> Text formatting: underlined text`} aria-label={$t`Underline *=> Text formatting: underlined text`}
          disabled={!editor} on:click={() => run(chain => chain.toggleUnderline())}>
          <UnderlineIcon size={16} />
        </button>
        <hbox class="tool-separator" />
        <button type="button" class="tool" class:pressed={isActive("link")} title={$t`Hyperlink *=> Insert or edit a link in the text`} aria-label={$t`Hyperlink *=> Insert or edit a link in the text`}
          disabled={!editor} on:click={() => showLinkDialog = true}>
          <LinkIcon size={16} />
        </button>
      </hbox>
      <vbox flex class="editor">
        {#if selected}
          {#key selected}
            <HTMLEditor bind:html={edits[selected.id]} bind:editor />
          {/key}
        {/if}
      </vbox>
      <hbox class="save-row">
        <DialogButton label={$t`Save`} disabled={!isChanged(selected, edits) && $t`No changes`}
          onClick={() => save(selected)} />
      </hbox>
    </vbox>
  </vbox>
</Dialog>
{#if showLinkDialog && editor}
  <LinkDialog {editor} on:close={() => showLinkDialog = false} />
{/if}

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import type { MailIdentity } from "../../../logic/Mail/MailIdentity";
  import { appGlobal } from "../../../logic/app";
  import { SignatureEdits } from "./SignatureEdits";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import ComboBox from "../../Shared/Form/ComboBox.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import LinkDialog from "../../Shared/Editor/LinkDialog.svelte";
  import HTMLEditor from "../../../frontend/Shared/Editor/HTMLEditor.svelte";
  import BoldIcon from "lucide-svelte/icons/bold";
  import ItalicIcon from "lucide-svelte/icons/italic";
  import UnderlineIcon from "lucide-svelte/icons/underline";
  import LinkIcon from "lucide-svelte/icons/link";
  import type { ChainedCommands, Editor } from "@tiptap/core";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let identity: MailIdentity = null;

  const dispatch = createEventDispatcher<{ close: void }>();

  let accounts = appGlobal.emailAccounts;
  let account: MailAccount = identity?.account ?? appGlobal.emailAccounts.first;
  let signatureEdits = new SignatureEdits();
  let edits = signatureEdits.edits;
  let selected: MailIdentity = identity;
  let editor: Editor;
  let showLinkDialog = false;

  $: identities = account?.identities.contents ?? [];
  $: account, selectFirstIfNeeded();
  function selectFirstIfNeeded() {
    select(selected?.account == account ? selected : account?.identities.first ?? null);
  }

  function select(newSelected: MailIdentity) {
    signatureEdits.start(newSelected);
    edits = signatureEdits.edits;
    selected = newSelected;
  }

  function hasSignature(identity: MailIdentity, currentEdits: Record<string, string>): boolean {
    return SignatureEdits.hasText(currentEdits[identity.id] ?? identity.signatureHTML);
  }

  function isChanged(identity: MailIdentity, _currentEdits: Record<string, string>): boolean {
    return signatureEdits.isChanged(identity);
  }

  function isActive(mark: string): boolean {
    return !!editor?.isActive(mark);
  }

  function run(command: (chain: ChainedCommands) => ChainedCommands) {
    command(editor.chain().focus()).run();
  }

  async function save(identity: MailIdentity) {
    await signatureEdits.save(identity);
    edits = signatureEdits.edits;
  }

  async function onOK() {
    await signatureEdits.saveAll();
    dispatch("close");
  }

  function onCancel() {
    dispatch("close");
  }
</script>

<style>
  .tab-strip {
    border-block-end: 1px solid var(--lo-border);
  }
  .tab {
    padding: 6px 12px;
    border: none;
    border-block-end: 2px solid transparent;
    background: none;
    color: var(--lo-fg);
    font: inherit;
  }
  .tab.selected {
    border-block-end-color: var(--lo-accent);
    font-weight: 600;
  }
  .tab-page {
    gap: 12px;
    padding-block-start: 12px;
    min-height: 0;
  }
  .account-row {
    align-items: center;
    gap: 12px;
  }
  .account-row select {
    flex: 1 1 auto;
  }
  .section {
    gap: 4px;
    min-height: 0;
  }
  .caption {
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }
  .caption::after {
    content: "";
    flex: 1 1 auto;
    border-block-start: 1px solid var(--lo-divider);
  }
  .signature-list {
    height: 88px;
    overflow-y: auto;
    padding: 2px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
  }
  .signature {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    height: 26px;
    padding: 0 8px;
    border: none;
    border-radius: 2px;
    background: none;
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
  }
  .signature:hover {
    background-color: var(--lo-hover-bg);
  }
  .signature.selected {
    background-color: var(--lo-selected-bg);
  }
  .realname,
  .empty {
    font-size: var(--lo-font-size-small);
  }
  .toolbar {
    align-items: center;
    gap: 2px;
    padding: 2px;
  }
  .tool {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
  }
  .tool:hover:not(:disabled) {
    background-color: var(--lo-hover-bg);
  }
  .tool.pressed {
    background-color: var(--lo-selected-bg);
    border-color: var(--lo-border-strong);
  }
  .tool-separator {
    width: 1px;
    height: 20px;
    margin: 0 4px;
    background-color: var(--lo-divider);
  }
  .editor {
    min-height: 160px;
    overflow-y: auto;
    padding: 8px 12px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
  }
  .editor :global(.ProseMirror) {
    min-height: 140px;
    outline: none;
  }
  .save-row {
    margin-block-start: 4px;
  }
</style>
