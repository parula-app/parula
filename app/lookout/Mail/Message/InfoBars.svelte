{#if isDraft}
  <hbox class="info-bar">
    <DraftIcon size={16} />
    <span>{$t`This message hasn't been sent`}</span>
    <button class="link" on:click={() => catchErrors(() => MessageActions.openDraft(message))}>{$t`Edit`}</button>
  </hbox>
{/if}
{#if isJunk}
  <hbox class="info-bar warning">
    <JunkIcon size={16} />
    <span>{$t`This message was marked as junk. Be careful with links and attachments in it.`}</span>
    <button class="link" on:click={() => catchErrors(() => message.treatSpam(false))}>{$t`It's not junk`}</button>
  </hbox>
{/if}
{#if $message.isImportant}
  <hbox class="info-bar">
    <ImportantIcon size={16} class="important" />
    <span>{$t`This message was sent with High importance`}</span>
  </hbox>
{/if}
{#if $message.isForwarded}
  <hbox class="info-bar">
    <ForwardedIcon size={16} />
    <span>{$t`You forwarded this message`}</span>
  </hbox>
<!-- {:else if $message.isReplied && reply}
  <button type="button" class="info-bar clickable" title={$t`Open your reply`}
    on:click={() => catchErrors(() => openEMailMessage(reply))}>
    <RepliedIcon size={16} />
    <span>{reply.sent
      ? $t`You replied to this message on ${getFullDateString(reply.sent)}`
      : $t`You replied to this message`}</span>
  </button> -->
{:else if $message.isReplied}
  <!-- <hbox class="info-bar" title={isSearching ? null : $t`Your reply was not found in your folders`}> -->
  <hbox class="info-bar">
    <RepliedIcon size={16} />
    <span>{$t`You replied to this message`}</span>
  </hbox>
{/if}
{#if $contentRendering.value == DisplayMode.Plaintext || $contentRendering.value == DisplayMode.Source}
  <hbox class="info-bar">
    <PlainTextIcon size={16} />
    <span>{$contentRendering.value == DisplayMode.Source
      ? $t`You're viewing the source of this message`
      : $t`This message is shown as plain text`}</span>
    <button class="link" on:click={() => { $contentRendering.value = DisplayMode.HTML; }}>{$t`Display as HTML`}</button>
  </hbox>
{/if}
{#if $message.loadedBody && ($message.loadExternalImages || $contentRendering.value == DisplayMode.HTML) && hasExternalContent($message.rawHTMLDangerous)}
  <button type="button" class="info-bar clickable pictures" bind:this={picturesBar}
    aria-haspopup="menu" on:click|stopPropagation={() => { isPicturesMenuOpen = !isPicturesMenuOpen; }}>
    <svelte:component this={$message.loadExternalImages ? PicturesIcon : NoPicturesIcon} size={16} />
    <span>{$message.loadExternalImages
      ? $t`Pictures are downloaded for all messages from ${$message.from.emailAddress}. The sender can see when you read this message.`
      : $t`Click here to download pictures. To help protect your privacy, ${appName} prevented automatic download of some pictures in this message.`}</span>
  </button>
  <Menu bind:isMenuOpen={isPicturesMenuOpen} anchor={picturesBar} placement="bottom-start">
    <MenuItem label={$message.loadExternalImages ? $t`Stop Downloading Pictures` : $t`Download Pictures`} icon={DownloadIcon}
      onClick={() => onDownloadPictures(!$message.loadExternalImages)} />
  </Menu>
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { DisplayMode } from "../../../frontend/Mail/Message/MessageBody.svelte";
  import { MessageActions } from "../MessageActions";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  // import { getFullDateString } from "../3pane/MessageDates";
  // import { openEMailMessage } from "../../../frontend/Mail/open";
  import { appName } from "../../../logic/build";
  import Menu from "../../Shared/Menu/Menu.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import DownloadIcon from "lucide-svelte/icons/image-down";
  import DraftIcon from "lucide-svelte/icons/square-pen";
  import JunkIcon from "lucide-svelte/icons/shield-alert";
  import ImportantIcon from "lucide-svelte/icons/circle-alert";
  import RepliedIcon from "lucide-svelte/icons/reply";
  import ForwardedIcon from "lucide-svelte/icons/forward";
  import PicturesIcon from "lucide-svelte/icons/image";
  import NoPicturesIcon from "lucide-svelte/icons/image-off";
  import PlainTextIcon from "lucide-svelte/icons/file-text";
  import { catchErrors } from "../../../frontend/Util/error";
  import { t } from "../../../l10n/l10n";
  import { SpecialFolder } from "../../../logic/Mail/Folder";

  export let message: EMail;

  const contentRendering = getLocalStorage<string>("mail.contentRendering", "html");
  let picturesBar: HTMLButtonElement;
  let isPicturesMenuOpen = false;
  $: isDraft = $message && (message.isDraft || message.folder?.specialFolder == SpecialFolder.Drafts);
  $: isJunk = $message && MessageActions.isJunk([message]);

  // let reply: EMail | null = null;
  // let isSearching = false;
  // $: isReplied = $message.isReplied;
  // $: catchErrors(() => findReply(message, isReplied), minorError);
  // async function findReply(original: EMail, isReplied: boolean) {
  //   reply = null;
  //   if (!isReplied) {
  //     return;
  //   }
  //   isSearching = true;
  //   try {
  //     let found = await original.findMyReply();
  //     if (original == message) {
  //       reply = found;
  //     }
  //   } finally {
  //     if (original == message) {
  //       isSearching = false;
  //     }
  //   }
  // }

  function hasExternalContent(html: string | null | undefined): boolean {
    if (!html) {
      return false;
    }
    const kExternalReference = /<(img|image|video|audio|source|input|link|iframe|object|embed)\b[^>]*\s(src|srcset|href|poster|data)\s*=\s*["']?\s*(https?:)?\/\/|\sbackground\s*=\s*["']?\s*(https?:)?\/\/|url\(\s*["']?\s*(https?:)?\/\//i;
    return kExternalReference.test(html);
  }

  function onDownloadPictures(download: boolean) {
    message.setLoadExternalImagesFromSender(download);
    $contentRendering.value = download ? DisplayMode.HTMLWithExternal : DisplayMode.HTML;
  }
</script>

<style>
  /* <copied to="../../Calendar/Invitation/InvitationInMail.svelte"> */
  .info-bar {
    align-items: center;
    flex-shrink: 0;
    gap: 8px;
    padding: 6px 12px;
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-pane-alt-bg);
    border: 1px solid var(--lo-divider);
    color: var(--lo-fg);
    font-size: 13px;
  }
  .info-bar :global(svg) {
    flex-shrink: 0;
    color: var(--lo-fg-secondary);
  }
  .info-bar.warning :global(svg) {
    color: var(--lo-warning);
  }
  .link {
    flex-shrink: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--lo-accent-text);
    font: inherit;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  /* </copied> */
  .info-bar {
    margin: 0 20px 6px 20px;
  }
  .info-bar.clickable {
    display: flex;
    flex-direction: row;
    font-family: inherit;
    text-align: start;
    cursor: pointer;
  }
  .info-bar.pictures {
    padding-block: 3px;
    background-color: transparent;
    color: var(--lo-fg-secondary);
    font-size: 12px;
  }
  .info-bar.clickable:hover {
    background-color: var(--lo-hover-bg);
  }
  .info-bar :global(svg.important) {
    color: var(--lo-danger);
  }
</style>
