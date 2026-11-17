{#if haveText}
  <ButtonMenu bind:isMenuOpen>
    <RoundButton
      slot="control"
      label={$t`Close and optionally save`}
      icon={CloseIcon}
      classes="plain" filled={false}
      onClick={onMenuToggle}
      />
    <MenuItem
      label={$t`Save`}
      icon={SaveIcon}
      onClick={onSave}
      />
    <MenuItem
      label={$t`Discard`}
      icon={TrashIcon}
      onClick={onDelete}
      />
  </ButtonMenu>
{:else}
  <Button
    label={$t`Discard`}
    icon={CloseIcon}
    onClick={onDelete}
    />
{/if}

<script context="module" lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";

  /** Whether the user wrote some text, apart from the quote */
  export function hasOwnText(mail: EMail): boolean {
    let doc = new DOMParser().parseFromString(mail.html, "text/html");
    for (let blockquote of doc.body.querySelectorAll("blockquote")) {
      blockquote.remove();
    }
    let text = doc.body.textContent.replace(/\s+/g, "");
    return text.length >= 100; // Ignore attribution line before quote. TODO Match more precisely
  }
</script>

<script lang="ts">
  import RoundButton from "../../Shared/RoundButton.svelte";
  import Button from "../../Shared/Button.svelte";
  import CloseIcon from "lucide-svelte/icons/x";
  import TrashIcon from "lucide-svelte/icons/trash-2";
  import SaveIcon from "lucide-svelte/icons/save";
  import { t } from "../../../l10n/l10n";
  import ButtonMenu from "../../Shared/Menu/ButtonMenu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import { createEventDispatcher } from 'svelte';
  const dispatchEvent = createEventDispatcher<{ close: void }>();

  export let mail: EMail;

  let isMenuOpen = false;
  function onMenuToggle(event: Event) {
    isMenuOpen = !isMenuOpen;
    checkDirty();
  }

  let haveText = true;
  async function onSave() {
    await mail.compose.saveAsDraft();
    dispatchEvent("close");
  }
  async function onDelete() {
    dispatchEvent("close");
    await mail.compose.deleteDrafts();
  }

  function checkDirty() {
    // If there's no text at all, simply close the window without offering to save
    if (!hasOwnText(mail)) {
      isMenuOpen = false;
      dispatchEvent("close");
    }
  }
</script>
