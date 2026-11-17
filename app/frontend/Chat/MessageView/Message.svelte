<!-- svelte-ignore a11y_no_static_element_interactions -->
<hbox flex
  class="message"
  class:incoming={!$message.outgoing}
  class:outgoing={$message.outgoing}
  class:followup
  deliveryStatus={$message instanceof ChatMessage ? $message.deliveryStatus : DeliveryStatus.Unknown}
  on:pointerenter={onHoverStart}
  on:pointerleave={onHoverEnd}
  >
  {#if !$message.outgoing}
    <vbox class="avatar"  from={author?.name}>
      {#if author?.picture && !followup}
        <PersonPicture person={author} size={32} />
      {/if}
    </vbox>
  {/if}
  <vbox class="right">
    {#if !(fastFollowup && hideHeaderFollowup)}
      <hbox class="meta font-smallest" class:singlechat={!isGroupChat}>
        {#if !$message.outgoing && !followup}
          <hbox class="from value">{author?.name}</hbox>
        {/if}
        <hbox flex>
          <slot name="above-center" />
        </hbox>
        <hbox class="time value">{getDateTimeString($message.sent)}</hbox>
      </hbox>
    {/if}
    {#if showActions}
      <vbox class="hover-popup-anchor">
        <vbox class="hover-above-msg">
          <ActionBar {message} />
        </vbox>
      </vbox>
    {/if}
    <Attachments message={$message} />
    {#if $message.rawText || $message.hasHTML}
      <vbox class="bubble">
        {#if $$slots.menu}
          <hbox class="menu" class:openMenuOnMessageHover>
            <slot name="menu" />
          </hbox>
        {/if}
        <slot name="inner-top" />
          <div class="text value font-normal">
            {@html sanitizeHTMLWithoutStyleTag($message.html || "")}
            <!-- TODO Security: Jail HTML into untrusted <iframe> for additional protection.
            <WebView title={$t`Text`} html={$message.html || ""} {headHTML} autoSize />
            -->
            <slot name="bubble" />
          </div>
        <slot name="inner-bottom" />
      </vbox>
    {/if}
    {#if $reactions.length > 0}
      <hbox class="reactions" class:cloak={showActions}>
        {#each [...$reactions.entries()] as [sender, emoji]}
          <hbox class="reaction" title={emoji + " " + sender?.name}>{emoji}</hbox>
        {/each}
      </hbox>
    {/if}
    {#if showActions}
      <vbox class="hover-popup-anchor" class:haveReaction={$reactions.length}>
        <vbox class="hover-after-msg">
          <ReactionBar {message} bind:isOpen={showActions} />
        </vbox>
      </vbox>
    {/if}
  </vbox>
</hbox>

<script lang="ts">
  import type { Message } from "../../../logic/Abstract/Message";
  import { ChatMessage, DeliveryStatus } from "../../../logic/Chat/ChatMessage";
  import { Group } from "../../../logic/Abstract/Group";
  import { Person } from "../../../logic/Abstract/Person";
  import cssContent from "../../Mail/Message/content.css?inline";
  import cssBody from "../../Mail/Message/content-body.css?inline";
  import cssFont from "../../asset/font/Karla.css?inline";
  import { ChatPersonUID } from "../../../logic/Chat/ChatPersonUID";
  import ReactionBar from "./ReactionBar.svelte";
  import ActionBar from "./ActionBar.svelte";
  import PersonPicture from "../../Contacts/Person/PersonPicture.svelte";
  import WebView from "../../Shared/WebView.svelte";
  import Attachments from "./Attachments.svelte";
  import { sanitizeHTMLWithoutStyleTag } from "../../../logic/util/convertHTML";
  import { getDateTimeString } from "../../../logic/util/date";

  export let message: Message;
  export let previousMessage: Message = null;
  export let hideHeaderFollowup = false;
  export let openMenuOnMessageHover = false;

  $: isGroupChat = ($message as ChatMessage).to?.contact instanceof Group;
  $: author = (($message instanceof ChatMessage && $message.from) || $message.contact) as ChatPersonUID | Person | Group;
  $: previousAuthor = (previousMessage instanceof ChatMessage && previousMessage.from) || previousMessage?.contact;
  $: followup = author == previousAuthor && // same author
    $message.outgoing == previousMessage?.outgoing;
  $: fastFollowup = followup &&
    $message.sent.getTime() - previousMessage.sent.getTime() < 5 * 60 * 1000; // < 5 mins apart
  $: reactions = $message.reactions;

  $: headHTML = `<style>\n${cssBody}\n${cssContent}\n</style>`;

  let showActions = false; // on hover (desktop) or long press (mobile)
  let hoverTimer: NodeJS.Timeout | null = null;
  function onHoverStart() {
    if (hoverTimer) {
      return;
    }
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      showActions = true;
    }, 300)
  }
  function onHoverEnd() {
    clearTimeout(hoverTimer);
    hoverTimer = null;
    showActions = false;
  }
</script>

<style>
  .message {
    margin: 16px 32px 0 20px;
    max-width: 75%;
  }
  .incoming {
    align-self: flex-start;
  }
  .outgoing {
    align-self: flex-end;
  }
  /** Speech bubble */
  .message .bubble {
    position: relative; /* arrows are relative to this */
    border-bottom-right-radius: 12px;
    border-bottom-left-radius: 12px;
    padding: 7px 15px;
  }
  .incoming .bubble {
    background-color: var(--chat-bubble-incoming-bg);
    color: var(--chat-bubble-incoming-fg);
    border-top-right-radius: 12px;
    box-shadow: 1px 1px 2px 0px rgba(0, 0, 0, 7%);
  }
  .outgoing .bubble {
    background-color: var(--chat-bubble-outgoing-bg);
    color: var(--chat-bubble-outgoing-fg);
    border-top-left-radius: 12px;
    box-shadow: 1px 1px 2px 0px rgba(0, 0, 0, 15%);
  }
  .message.followup {
    margin-block-start: 3px;
  }

  /** Speech bubble arrow */
  .message:not(.followup) .bubble::before {
    content: '';
    position: absolute; /* relative to .bubble position: relative */
    border-style: solid;
  }
  .incoming .bubble::before {
    top: 0;
    left: -10px;
    border-width: 10px 0 0 10px;
    border-color: var(--chat-bubble-incoming-bg) transparent transparent transparent;
  }
  .outgoing .bubble::before {
    top: 0;
    left: 100%;
    border-width: 10px 10px 0 0;
    border-color: var(--chat-bubble-outgoing-bg) transparent transparent transparent;
  }
  .incoming.followup .bubble {
    border-top-left-radius: 12px;
  }
  .outgoing.followup .bubble {
    border-top-right-radius: 12px;
  }

  .avatar {
    margin-block-start: 3px;
    margin-inline-end: 4px;
    min-width: 32px;
  }
  .meta {
    align-items: end;
    margin-block-end: 2px;
    color: #818181;
  }
  .meta.singlechat {
    color: #999999;
  }
  .incoming .meta {
    margin-inline-start: 14px;
  }
  .outgoing .meta {
    justify-content: end;
    margin-inline-end: 10px;
  }
  .from {
    margin-inline-end: 16px;
  }
  .from:not(.singlechat) {
    font-size: medium;
    font-weight: 500;
    color: var(--fg);
  }
  .text {
    overflow-wrap: anywhere;
    contain: paint; /* Prevent CSS on remote content from rendering outside the area */
  }
  .text > :global(p) {
    margin: 0;
  }

  .text :global(blockquote) {
    border-left: 3px solid grey;
    padding-inline-start: 16px;
    margin-inline-start: 0px;
  }
  .text :global(pre) {
    white-space: pre-wrap !important;
  }
  .text :global(*) {
    text-wrap: wrap !important;
    overflow-wrap: anywhere !important;
  }

  .reactions {
    z-index: 1;
    align-self: flex-end;
    margin-block-start: -6px;
    margin-inline-end: 16px;
    padding: 0px 4px;
    border: 2px solid transparent;
    border-radius: 20px;
    background-color: white;
    box-shadow: 1px 1px 2px 0px rgba(0, 0, 0, 10%);
  }
  .outgoing .reactions {
    background-color: white;
  }
  .hover-popup-anchor {
    position: relative;
    height: 0;
    width: 100%;
    overflow: visible;
  }
  .hover-above-msg,
  .hover-after-msg {
    position: absolute;
    z-index: 2;
    align-self: flex-end;
    margin-inline-end: 16px;
    min-width: max-content;
    padding: 0px 4px;
    border: 2px solid transparent;
    border-radius: 20px;
    background-color: white;
    box-shadow: 1px 1px 2px 0px rgba(0, 0, 0, 10%);
  }
  .hover-above-msg {
    bottom: 0px;
    right: 10px;
  }
  .hover-after-msg {
    top: 0px;
    right: 10px;
  }
  /** avoid that the following messages move oh hover */
  .reactions.cloak {
    visibility: hidden;
  }
  .hover-after-msg.haveReactions {
    margin-block-start: -24px;
  }

  .menu {
    display: none;
  }
  .message:hover .menu.openMenuOnMessageHover,
  .menu:hover,
  .message:has(.meta:hover) .menu {
    display: flex;
    position: absolute;
    height: 24px;
    max-height: 24px;
    top: -30px;
    right: 10%;
    align-items: center;
    justify-content: end;
    overflow: hidden;
    text-overflow: ellipsis;
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
    padding: 0px 4px;
    border: 2px solid transparent;
    border-radius: 20px;
    box-shadow: 1px 1px 2px 0px rgba(0, 0, 0, 10%);
    z-index: 1;
  }
  .menu > * {
    margin-inline-start: 8px;
  }
  .menu :global(svg) {
    stroke-width: 1.5px;
  }

  .outgoing[deliveryStatus=sending] {
    opacity: 70%;
  }
</style>
