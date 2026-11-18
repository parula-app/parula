<Splitter name="mail.vertical.folders" initialRightRatio={4}>
  <LeftPane {accounts} {folders}
    bind:selectedAccount bind:selectedFolder bind:selectedFolders bind:searchMessages
    bind:activeTab={$selectedSearchTab}
    slot="left" />
  <Splitter slot="right" name="mail.vertical.msgs" initialRightRatio={2}>
    <vbox flex class="message-list-pane" slot="left">
      <PaymentBar account={selectedAccount} showWhenNoAccount={false} />
      <AutoResponderBar account={selectedAccount} />
      <FolderHeader folder={selectedFolder} {searchMessages} />
      <VerticalMessageList {messages} bind:selectedMessage bind:selectedMessages />
      <FolderFooter folder={selectedFolder} bind:searchMessages />
    </vbox>
    <vbox flex class="message-display-pane" slot="right">
      {#if selectedMessage}
        <MessageDisplay message={selectedMessage} />
      {:else}
        <StartPage />
      {/if}
    </vbox>
  </Splitter>
</Splitter>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { EMail } from "../../../logic/Mail/EMail";
  import { selectedSearchTab } from "../Selected";
  import VerticalMessageList from "./VerticalMessageList.svelte";
  import LeftPane from "../LeftPane/LeftPane.svelte";
  import MessageDisplay from "../Message/MessageDisplay.svelte";
  import StartPage from "../StartPage.svelte";
  import FolderHeader from "../LeftPane/FolderHeader.svelte";
  import AutoResponderBar from "../AutoResponderBar.svelte";
  import FolderFooter from "../LeftPane/FolderFooter.svelte";
  // #if [PROPRIETARY]
  import PaymentBar from "../../Settings/License/Banner/PaymentBar.svelte";
  // #else
  import PaymentBar from "../../Shared/Empty.svelte";
  // #endif
  import Splitter from "../../Shared/Splitter.svelte";
  import type { ArrayColl, Collection } from 'svelte-collections';

  export let accounts: Collection<MailAccount>; /** in */
  export let messages: ArrayColl<EMail>; /** in */
  export let folders: Collection<Folder>; /** in */
  export let searchMessages: ArrayColl<EMail> | null; /** out */
  export let selectedAccount: MailAccount; /** in/out */
  export let selectedFolder: Folder; /** in/out */
  export let selectedMessage: EMail; /** in/out */
  export let selectedMessages: ArrayColl<EMail>; /** in/out */
  let selectedFolders: ArrayColl<Folder>;
</script>

<style>
  .message-list-pane,
  .message-display-pane {
    background-color: var(--main-bg);
    color: var(--main-fg);
  }
  .message-list-pane {
    box-shadow: 1px 0px 6px 0px rgba(0, 0, 0, 8%); /* Also on MessageList */
    z-index: 2;
  }
</style>
