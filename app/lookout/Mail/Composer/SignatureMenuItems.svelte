{#each signatures as signatureHTML}
  <MenuItem label={new MailBody(signatureHTML).textLine}
    selected={!!current?.isOwnSignature(signatureHTML)}
    tooltip={mail ? $t`Use this signature in this message` : null}
    disabled={!editor}
    onClick={() => onInsert(signatureHTML)} />
{/each}
{#if signatures.length}
  <MenuDivider />
{/if}
<MenuItem label={$t`Signatures… *=> Edit the email signatures`} onClick={onEditSignatures} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { findAllIdentities, type MailIdentity } from "../../../logic/Mail/MailIdentity";
  import { MailBody } from "../../../logic/Mail/MailBody";
  import { appGlobal } from "../../../logic/app";
  import { openAccountSettings } from "../../Settings/SettingsDialogs";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import type { Editor } from "@tiptap/core";
  import { t } from "../../../l10n/l10n";

  /** null: The signatures of all identities, e.g. in the calendar */
  export let identity: MailIdentity | null;
  export let editor: Editor;
  /** null: Inserts the signature at the cursor */
  export let mail: EMail | null = null;

  let identities = findAllIdentities();
  $: signatures = (identity ? [identity] : $identities.contents).flatMap(candidate => candidate.signatures.contents);
  /** The menu opens anew each time */
  let current = mail && editor ? new MailBody(editor.getHTML()) : null;

  function onInsert(signatureHTML: string) {
    if (mail) {
      editor.commands.editSignature(body => body.setOwnSignature(signatureHTML));
    } else {
      editor.chain().focus().insertContent(signatureHTML).run();
    }
  }

  function onEditSignatures() {
    openAccountSettings(identity?.account ?? appGlobal.emailAccounts.first, "mail-identity");
  }
</script>
