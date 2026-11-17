{#each withSignature as signatureIdentity (signatureIdentity.id)}
  {#if signatureIdentity == identity}
    <MenuItem label={signatureIdentity.emailAddress} selected
      disabled={$t`This signature is added at the end when you send`} />
  {:else}
    <MenuItem label={signatureIdentity.emailAddress}
      disabled={!editor}
      onClick={() => onInsert(signatureIdentity)} />
  {/if}
{/each}
{#if withSignature.length}
  <MenuDivider />
{/if}
<MenuItem label={$t`Signatures… *=> Edit the email signatures`} onClick={() => dispatch("editSignatures")} />

<script lang="ts">
  import { findAllIdentities, type MailIdentity } from "../../../logic/Mail/MailIdentity";
  import { SignatureEdits } from "./SignatureEdits";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import type { Editor } from "@tiptap/core";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let identity: MailIdentity;
  export let editor: Editor;
  const dispatch = createEventDispatcher<{ editSignatures: void }>();

  let identities = findAllIdentities();
  $: withSignature = $identities.contents.filter(candidate => SignatureEdits.hasText(candidate.signatureHTML));

  function onInsert(signatureIdentity: MailIdentity) {
    editor.chain().focus().insertContent(signatureIdentity.signatureHTML).run();
  }
</script>
