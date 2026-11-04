<Dialog title={isLink ? $t`Edit Hyperlink` : $t`Insert Hyperlink`} on:close={onClose} width="600px"
  okLabel={$t`OK`}
  okDisabled={!href && (linkTo == LinkTarget.Email ? $t`Please enter an email address` : $t`Please enter an address *=> Enter the web address of the link`)}
  onOK={onOK}>
  <hbox class="hyperlink">
    <vbox class="link-to" role="radiogroup" aria-label={$t`Link to *=> Kind of target of the link: web page or email address`}>
      <span class="link-to-label">{$t`Link to *=> Kind of target of the link: web page or email address`}</span>
      <button type="button" class="target" class:selected={linkTo == LinkTarget.Web}
        role="radio" aria-checked={linkTo == LinkTarget.Web}
        on:click={() => { linkTo = LinkTarget.Web; }}>
        <WebIcon size={24} strokeWidth={1.5} />
        <span>{$t`Existing File or Web Page`}</span>
      </button>
      <button type="button" class="target" class:selected={linkTo == LinkTarget.Email}
        role="radio" aria-checked={linkTo == LinkTarget.Email}
        on:click={() => { linkTo = LinkTarget.Email; }}>
        <EmailIcon size={24} strokeWidth={1.5} />
        <span>{$t`E-mail Address`}</span>
      </button>
    </vbox>
    <vbox flex class="fields">
      <FormGrid columns="max-content minmax(0, 1fr)">
        <span class="lo-form-label">{$t`Text to display`}</span>
        <TextField label={$t`Text to display`} bind:value={linkText}
          disabled={hasSelection && $t`The selected text becomes the link`} />
        {#if linkTo == LinkTarget.Web}
          <span class="lo-form-label">{$t`Address *=> Web address (URL) that the link points to`}</span>
          <TextField label={$t`Address *=> Web address (URL) that the link points to`} type="url" bind:value={webAddress} placeholder="https://" />
        {:else}
          <span class="lo-form-label">{$t`E-mail address`}</span>
          <TextField label={$t`E-mail address`} type="email" bind:value={emailAddress} />
          <span class="lo-form-label">{$t`Subject`}</span>
          <TextField label={$t`Subject`} bind:value={emailSubject} />
        {/if}
      </FormGrid>
    </vbox>
  </hbox>
  <svelte:fragment slot="buttons-start">
    {#if isLink}
      <DialogButton label={$t`Remove Link`} onClick={onRemove} />
    {/if}
  </svelte:fragment>
</Dialog>

<script lang="ts">
  import { LinkTarget, LinkAddress } from "./LinkAddress";
  import Dialog from "../Dialog/Dialog.svelte";
  import DialogButton from "../Dialog/DialogButton.svelte";
  import FormGrid from "../Form/FormGrid.svelte";
  import TextField from "../Form/TextField.svelte";
  import WebIcon from "lucide-svelte/icons/globe";
  import EmailIcon from "lucide-svelte/icons/mail";
  import type { Editor } from "@tiptap/core";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let editor: Editor;

  const dispatch = createEventDispatcher<{ close: void }>();

  let isLink = editor.isActive("link");
  let hasSelection = !editor.state.selection.empty;
  let existing = LinkAddress.parse(editor.getAttributes("link").href ?? "");
  let linkTo = existing.target;
  let webAddress = existing.target == LinkTarget.Web ? existing.address : "";
  let emailAddress = existing.target == LinkTarget.Email ? existing.address : "";
  let emailSubject = existing.subject;
  let linkText = hasSelection ? editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ") : "";

  $: href = linkTo == LinkTarget.Email
    ? LinkAddress.mailto(emailAddress, emailSubject)
    : webAddress.trim();

  function onOK() {
    if (hasSelection || isLink) {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    } else {
      editor.chain().focus().insertContent({
        type: "text",
        text: linkText || (linkTo == LinkTarget.Email ? emailAddress.trim() : href),
        marks: [{ type: "link", attrs: { href } }],
      }).run();
    }
  }

  function onRemove() {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    close();
  }

  function onClose() {
    editor.commands.focus();
    close();
  }

  function close() {
    dispatch("close");
  }
</script>

<style>
  .hyperlink {
    gap: 16px;
    min-height: 180px;
  }
  .link-to {
    flex: 0 0 120px;
    gap: 4px;
  }
  .link-to-label {
    margin-bottom: 2px;
  }
  .target {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 4px;
    border: 1px solid transparent;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg);
    font: inherit;
    font-size: var(--lo-font-size-small);
    text-align: center;
  }
  .target :global(svg) {
    color: var(--lo-accent-text);
  }
  .target:hover {
    background-color: var(--lo-hover-bg);
  }
  .target.selected {
    background-color: var(--lo-selected-bg);
    border-color: var(--lo-selected-hover-bg);
  }
  .fields {
    min-width: 0;
    padding-top: 22px;
  }
</style>
