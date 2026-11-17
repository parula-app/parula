{#if identity.signatures.length > 1}
  <ButtonMenu bind:isMenuOpen boundaryElSel=".mail-composer-window">
    <Button
      label={$t`Signature`}
      icon={SignatureIcon}
      iconOnly
      onClick={onMenuToggle}
      selected={isMenuOpen}
      slot="control"
      />
    {#each signatures.each as signatureHTML}
      <MenuItem
        label={new MailBody(signatureHTML).textAsOneLine}
        selected={current.isOwnSignature(signatureHTML)}
        onClick={() => editor.commands.editSignature(body => body.setOwnSignature(signatureHTML))}
        />
    {/each}
    <MenuDivider />
    <MenuItem
      label={$t`Manage signatures…`}
      icon={SettingsIcon}
      onClick={() => openSettingsCategoryForAccount(identity.account, "mail-identity")}
      />
  </ButtonMenu>
{/if}

<script lang="ts">
  import type { MailIdentity } from "../../../logic/Mail/MailIdentity";
  import { MailBody } from "../../../logic/Mail/MailBody";
  import { openSettingsCategoryForAccount } from "../../Settings/Window/CategoriesUtils";
  import ButtonMenu from "../../Shared/Menu/ButtonMenu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import Button from "../../Shared/Button.svelte";
  import SignatureIcon from "lucide-svelte/icons/stamp";
  import SettingsIcon from "lucide-svelte/icons/settings";
  import type { ArrayColl } from "svelte-collections";
  import type { Editor } from "@tiptap/core";
  import { t } from "../../../l10n/l10n";

  export let identity: MailIdentity;
  export let editor: Editor;

  let isMenuOpen = false;
  let signatures: ArrayColl<string>;
  /** The mail in the editor, when the menu opened */
  let current: MailBody;

  function onMenuToggle() {
    signatures = identity.signatures;
    current = new MailBody(editor.getHTML());
    isMenuOpen = !isMenuOpen;
  }
</script>

