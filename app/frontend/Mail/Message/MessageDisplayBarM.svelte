<hbox class="buttons"
  on:swipeleft={onPreviousMessage}
  on:swiperight={onNextMessage}
  >
  <AppBarM>
    <!-- left -->
    <hbox class="spam">
      <Button
        icon={$message.isSpam ? NotSpamIcon : SpamIcon}
        iconSize="24px"
        iconOnly
        label={$message.isSpam ? $t`This email is *not* spam` : $t`Treat this email as spam: Move it to the Spam folder, and train the spam filter`}
        onClick={toggleSpam}
        disabled={!message}
        plain
        />
    </hbox>

    <!-- left middle -->
    <hbox class="trash">
      <Button
        icon={TrashIcon}
        iconSize="24px"
        iconOnly
        label={$t`Delete this message`}
        onClick={deleteMessage}
        disabled={!message}
        plain
        />
    </hbox>

    <AppMenuButton />

    <!-- right middle -->
    {#if message.isDraft || message.folder?.specialFolder == SpecialFolder.Drafts }
      <hbox class="draft">
        <Button
          icon={WriteIcon}
          iconSize="24px"
          iconOnly
          label={$t`Edit draft`}
          onClick={editDraft}
          plain
          />
      </hbox>
    {:else}
      <hbox class="move button" bind:this={popupAnchorE}>
        <Button
          icon={FolderActionsIcon}
          iconSize="24px"
          iconOnly
          label={$t`Move to folder, or add tag`}
          onClick={onPopupToggle}
          plain
          />
      </hbox>
    {/if}

    <!-- right -->
    <hbox class="menu button">
      <ButtonMenu bind:isMenuOpen>
        <MessageMenu bind:message {printE} />
        <DisplayModeSwitcher />
      </ButtonMenu>
    </hbox>
  </AppBarM>
</hbox>
<Popup bind:popupOpen popupAnchor={popupAnchorE} placement="bottom" boundaryElSel=".message-list-pane">
  <MessageMovePopup messages={new ArrayColl([message])} on:close={onPopupClose} />
</Popup>

<Print {message} bind:this={printE} />

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { mailMustangApp } from "../MailMustangApp";
  import { SpecialFolder } from "../../../logic/Mail/Folder";
  import { goTo } from "../../AppsBar/selectedApp";
  import MessageMenu from "./MessageMenu.svelte";
  import MessageMovePopup from "./MessageMovePopup.svelte";
  import Print from "./MessagePrint.svelte";
  import DisplayModeSwitcher from "./DisplayModeSwitcher.svelte";
  import AppBarM from "../../AppsBar/AppBarM.svelte";
  import ButtonMenu from "../../Shared/Menu/ButtonMenu.svelte";
  import AppMenuButton from "../../AppsBar/AppMenuM/AppMenuButton.svelte";
  import Popup from "../../Shared/Popup.svelte";
  import Button from "../../Shared/Button.svelte";
  import FolderIcon from "lucide-svelte/icons/folder";
  import ListIcon from "lucide-svelte/icons/list";
  import TrashIcon from "lucide-svelte/icons/trash-2";
  import SpamIcon from "lucide-svelte/icons/shield-x";
  import NotSpamIcon from "lucide-svelte/icons/shield-off";
  import WriteIcon from "lucide-svelte/icons/pencil";
  import FolderActionsIcon from "lucide-svelte/icons/folder-dot";
  import { URLPart } from "../../../logic/util/blob";
  import { ArrayColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";

  export let message: EMail;

  function goToAccounts() {
    goTo("/mail/", {});
  }
  function goToMsgList() {
    goTo(URLPart`/mail/folder/${message.folder.account.id}/${message.folder.id ?? "noid"}/message-list`, {
      account: message.folder.account,
      folder: message.folder,
    });
  }
  async function deleteMessage() {
    await message.deleteMessage();
    loadOther();
  }
  async function toggleSpam() {
    await message.treatSpam(!message.isSpam);
    loadOther();
  }
  async function editDraft() {
    await message.compose.editDraft();
    mailMustangApp.writeMail(message);
  }

  function loadOther() {
    goToMsgList();
  }
  function onNextMessage() {
    message = message.nextMessage(false);
  }
  function onPreviousMessage() {
    message = message.nextMessage(true);
  }

  let isMenuOpen = false;
  let printE: Print;

  // Folder Popup
  let popupAnchorE: HTMLElement;
  let popupOpen = false;
  function onPopupToggle(event) {
    popupOpen = !popupOpen;
  }
  function onPopupClose() {
    popupOpen = false;
  }
</script>

<style>
  .menu :global(.island) {
    color: black;
    justify-content: center;
  }
</style>
