<vbox class="reading-header">
  <hbox class="subject-row">
    <h2 class="subject" title={$message.subject}>{$message.subject || $t`(no subject)`}</h2>
  </hbox>
  <hbox class="sender-row">
    <PersonCircle name={personDisplayName($message.from)} picture={$message.from?.findPerson()?.picture}
      colorKey={$message.from?.emailAddress} size={40} title={personDisplayName($message.from)} />
    <vbox flex class="sender-info">
      <hbox class="from">
        <hbox class="sender-name">
          {#if $message.from}
            <RecipientsList recipients={new ArrayColl([$message.from])} withAddress />
          {/if}
        </hbox>
      </hbox>
      {#if $to.hasItems}
        <hbox class="recipients">
          <span class="recipients-label">{$t`To`}</span>
          <RecipientsList recipients={to} />
        </hbox>
      {/if}
      {#if $cc.hasItems}
        <hbox class="recipients">
          <span class="recipients-label">{$t`Cc`}</span>
          <RecipientsList recipients={cc} />
        </hbox>
      {/if}
      {#if $bcc.hasItems}
        <hbox class="recipients">
          <span class="recipients-label">{$t`Bcc`}</span>
          <RecipientsList recipients={bcc} />
        </hbox>
      {/if}
    </vbox>
    <vbox class="top-right">
      <hbox class="respond-group">
        <hbox class="button-group">
          <button class="respond" on:click={() => catchErrors(() => MessageActions.respond(message, message.compose.replyToAuthor()))}
            title={$t`Reply`} aria-label={$t`Reply`}>
            <ReplyIcon size={18} />
          </button>
          <button class="respond" on:click={() => catchErrors(() => MessageActions.respond(message, message.compose.replyAll()))}
            disabled={!($message.allRecipients().length > 1 && !($message.bcc.hasItems && !$message.outgoing))}
            title={$t`Reply All`} aria-label={$t`Reply All`}>
            <ReplyAllIcon size={18} />
          </button>
          <button class="respond" on:click={event => catchErrors(() => MessageActions.forward(message, event))}
            title={$t`Forward`} aria-label={$t`Forward`}>
            <ForwardIcon size={18} />
          </button>
        </hbox>
        <button class="more" bind:this={moreEl} on:click|stopPropagation={() => isMoreOpen = !isMoreOpen}
          title={$t`More actions`} aria-label={$t`More actions`} aria-haspopup="menu">
          <MoreIcon size={18} />
        </button>
      </hbox>
      <span class="date" title={$message.received ? $t`Received: ${getFullDateString($message.received)}` : null}>
        {getFullDateString($message.sent)}
      </span>
    </vbox>
  </hbox>
  {#if $tags.length}
    <hbox class="categories">
      {#each $tags as tag (tag)}
        <span class="category" style="--category-color: {tag.color};">
          {tag.name}
          <button class="remove-category" on:click={() => catchErrors(() => message.removeTag(tag))}
            title={$t`Remove category ${tag.name}`} aria-label={$t`Remove category ${tag.name}`}>
            <RemoveIcon size={12} />
          </button>
        </span>
      {/each}
    </hbox>
  {/if}
  {#if message.to.isEmpty || message.from.emailAddress == kDummyPerson.emailAddress}
    <!-- <copied from="../../../frontend/Mail/Message/MessageHeader.svelte"> -->
    {#await message.loadForDisplay() catch ex}
      <hbox class="error-bar" role="alert">
        <ErrorIcon size={16} />
        <span>{ex?.message ?? ex}</span>
      </hbox>
    {/await}
    <!-- </copied> -->
  {/if}
  <EncryptionButtons {message} bind:isExpanded={isEncryptionExpanded} />
</vbox>
<EncryptionDetails {message} bind:isExpanded={isEncryptionExpanded} />
<Menu bind:isMenuOpen={isMoreOpen} anchor={moreEl} placement="bottom-end">
  <MenuItem label={$t`Reply`} icon={ReplyIcon} onClick={() => MessageActions.respond(message, message.compose.replyToAuthor())} />
  <MenuItem label={$t`Reply All`} icon={ReplyAllIcon}
    disabled={!(message.allRecipients().length > 1 && !(message.bcc.hasItems && !message.outgoing)) && $t`There are no other recipients`}
    onClick={() => MessageActions.respond(message, message.compose.replyAll())} />
  <MenuItem label={$t`Forward`} icon={ForwardIcon} onClick={event => MessageActions.forward(message, event as MouseEvent)} />
  <MenuItem label={$t`Forward as Attachment`} icon={ForwardAttachmentIcon} onClick={async () => mailMustangApp.writeMail(await message.compose.forwardAsAttachment())} />
  <MenuItem label={$t`Redirect`} icon={RedirectIcon}
    tooltip={$t`Send this message to somebody else, who can reply to the original sender`}
    onClick={async () => mailMustangApp.writeMail(await message.compose.redirect())} />
  {#if $message.outgoing}
    <MenuItem label={$t`Edit as New`} icon={EditAsNewIcon} onClick={async () => mailMustangApp.writeMail(await message.compose.editAsNew())} />
  {/if}
  <MenuItem label={$t`New Topic to All`} icon={NewToAllIcon}
    tooltip={$t`Send a new, unrelated message to all recipients`}
    onClick={() => mailMustangApp.writeMail(message.compose.newToAll())} />
  <MenuDivider />
  <MenuItem label={$t`Delete`} icon={DeleteIcon} onClick={() => message.deleteMessage()} />
  <MenuItem label={$message.isRead ? $t`Mark as Unread` : $t`Mark as Read`} icon={$message.isRead ? UnreadIcon : ReadIcon}
    onClick={() => message.markRead(!message.isRead)} />
  <SubMenu label={$t`Follow Up *=> Flag the selected emails for follow-up`} icon={FlagIcon}>
    <FollowUpMenuItems messages={[message]} />
  </SubMenu>
  <SubMenu label={$t`Categorize *=> Assign a category to the selected emails`} icon={CategorizeIcon}>
    <CategorizeMenuItems messages={[message]} />
  </SubMenu>
  <SubMenu label={$t`Junk *=> Menu to mark the selected emails as junk or not junk`} icon={JunkIcon}>
    <JunkMenuItems messages={[message]} />
  </SubMenu>
  <MenuDivider />
  <MenuItem label={$t`Print`} icon={PrintIcon} onClick={() => { $printMessage = message; }} />
  <MenuItem label={$t`Save As…`} icon={SaveIcon} onClick={() => MessageActions.saveAs(message)} />
  <SubMenu label={$t`View *=> Choose how the email is displayed`} icon={SourceIcon}>
    <DisplayModeSwitcher />
  </SubMenu>
  <MenuItem label={$t`Message Properties…`} icon={PropertiesIcon}
    onClick={() => { isPropertiesOpen = true; }} />
</Menu>
{#if isPropertiesOpen}
  <MessagePropertiesDialog {message} on:close={() => isPropertiesOpen = false} />
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { kDummyPerson, personDisplayName } from "../../../logic/Abstract/PersonUID";
  import { MessageActions } from "../MessageActions";
  import MessagePropertiesDialog from "./MessagePropertiesDialog.svelte";
  import { getFullDateString } from "../3pane/MessageDates";
  import { derived } from "svelte/store";
  import PersonCircle from "../../Contacts/Person/PersonCircle.svelte";
  import SubMenu from "../../Shared/Menu/SubMenu.svelte";
  import FollowUpMenuItems from "./FollowUpMenuItems.svelte";
  import JunkMenuItems from "./JunkMenuItems.svelte";
  import CategorizeMenuItems from "./CategorizeMenuItems.svelte";
  import DisplayModeSwitcher from "./DisplayModeSwitcher.svelte";
  import RecipientsList from "./RecipientsList.svelte";
  import EncryptionButtons from "./EncryptionButtons.svelte";
  import EncryptionDetails from "./EncryptionDetails.svelte";
  import Menu from "../../Shared/Menu/Menu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ReplyAllIcon from "lucide-svelte/icons/reply-all";
  import ForwardIcon from "lucide-svelte/icons/forward";
  import ForwardAttachmentIcon from "lucide-svelte/icons/paperclip";
  import RedirectIcon from "lucide-svelte/icons/move-right";
  import EditAsNewIcon from "lucide-svelte/icons/iteration-ccw";
  import NewToAllIcon from "lucide-svelte/icons/plus";
  import MoreIcon from "lucide-svelte/icons/ellipsis";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import ReadIcon from "lucide-svelte/icons/mail-open";
  import UnreadIcon from "lucide-svelte/icons/mail";
  import FlagIcon from "lucide-svelte/icons/flag";
  import JunkIcon from "lucide-svelte/icons/shield-x";
  import CategorizeIcon from "lucide-svelte/icons/tag";
  import PrintIcon from "lucide-svelte/icons/printer";
  import { printMessage } from "./MessagePrint.svelte";
  import SaveIcon from "lucide-svelte/icons/save";
  import SourceIcon from "lucide-svelte/icons/code-xml";
  import PropertiesIcon from "lucide-svelte/icons/file-cog";
  import RemoveIcon from "lucide-svelte/icons/x";
  import ErrorIcon from "lucide-svelte/icons/circle-x";
  import { catchErrors } from "../../../frontend/Util/error";
  import { ArrayColl } from "svelte-collections";
  import { t } from "../../../l10n/l10n";
  import { mailMustangApp } from "../../../frontend/Mail/MailMustangApp";

  export let message: EMail;

  $: to = message.to;
  $: cc = message.cc;
  $: bcc = message.bcc;
  $: messageTags = message.tags;
  $: tags = derived($messageTags.contents, () => messageTags.contents);


  let moreEl: HTMLButtonElement;
  let isMoreOpen = false;
  let isPropertiesOpen = false;
  let isEncryptionExpanded = false;
</script>

<style>
  .reading-header {
    flex-shrink: 0;
    padding: 16px 20px 12px 20px;
    gap: 12px;
  }
  .subject {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 20px;
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .sender-row {
    align-items: start;
    gap: 12px;
  }
  .sender-info {
    min-width: 0;
    gap: 2px;
  }
  .from {
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .sender-name {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sender-name :global(.recipient-names) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sender-name :global(.name) {
    font-weight: 600;
  }
  .sender-name :global(.address) {
    font-weight: normal;
  }
  .recipients {
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    color: var(--lo-fg-secondary);
    font-size: 13px;
    line-height: 20px;
  }
  .recipients-label {
    flex-shrink: 0;
  }
  .error-bar {
    align-items: center;
    flex-shrink: 0;
    gap: 8px;
    margin-top: 6px;
    padding: 6px 12px;
    border-radius: var(--lo-radius-small);
    background-color: color-mix(in srgb, var(--lo-danger) 12%, var(--lo-pane-bg));
    border: 1px solid color-mix(in srgb, var(--lo-danger) 40%, transparent);
    color: var(--lo-fg);
    font-size: 13px;
  }
  .error-bar :global(svg) {
    flex-shrink: 0;
    color: var(--lo-danger);
  }
  .top-right {
    flex-shrink: 0;
    align-items: end;
    gap: 6px;
  }
  .respond-group {
    gap: 6px;
  }
  .button-group {
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
    overflow: hidden;
  }
  .respond,
  .more {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 32px;
    padding: 0;
    border: none;
    background: none;
    color: var(--lo-accent-text);
    cursor: pointer;
  }
  .respond + .respond {
    border-inline-start: 1px solid var(--lo-border);
  }
  .more {
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius-small);
    color: var(--lo-fg-secondary);
  }
  .respond:hover:not(:disabled),
  .more:hover {
    background-color: var(--lo-hover-bg);
  }
  .respond:disabled {
    color: var(--lo-fg-disabled);
    cursor: default;
  }
  .date {
    color: var(--lo-fg-secondary);
    font-size: 12px;
    white-space: nowrap;
  }
  .categories {
    flex-wrap: wrap;
    gap: 6px;
    padding-inline-start: 52px;
  }
  .category {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 2px 0 8px;
    border: 1px solid color-mix(in srgb, var(--category-color) 70%, var(--lo-fg));
    border-radius: 3px;
    background-color: color-mix(in srgb, var(--category-color) 22%, var(--lo-pane-bg));
    font-size: 12px;
    line-height: 20px;
  }
  .remove-category {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 2px;
    background: none;
    color: var(--lo-fg-secondary);
    cursor: pointer;
  }
  .remove-category:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
</style>
